import { Hono } from "npm:hono";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as kv from "./kv_store.tsx";
import {
  fetchAdsDailySnapshots,
  fetchLatestAdsDailySnapshotsBeforeOrOn,
  getLatestAdsSnapshotSyncAt,
  loadInternalAdAccounts,
  upsertAdsDailySnapshots,
  type AdsDailySnapshotRecord,
} from "./ads_snapshot_store.tsx";
import {
  clampNumber,
  diffInDaysInclusive,
  getMaxTimestamp,
  isSyncFresh,
  listDateChunks,
  parseBooleanFlag,
} from "./ads_snapshot_utils.tsx";
import {
  getRequesterAccessContext,
  hasEffectivePermission,
} from "./requester_access.ts";
import type { RequesterAccessContext } from "./requester_access.ts";
import type { PermissionKey } from "../../../src/app/data/permissions.ts";

const app = new Hono();

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseAuthKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const authSupabase = createClient(supabaseUrl, supabaseAuthKey);

const TIKTOK_API_VERSION = Deno.env.get("TIKTOK_API_VERSION")?.trim() || "v1.3";
const TIKTOK_BASE_URL = `https://business-api.tiktok.com/open_api/${TIKTOK_API_VERSION}`;
const TIKTOK_APP_ID = Deno.env.get("TIKTOK_APP_ID")?.trim() || "";
const TIKTOK_APP_SECRET = Deno.env.get("TIKTOK_APP_SECRET")?.trim() || "";
const TIKTOK_REDIRECT_URI =
  Deno.env.get("TIKTOK_REDIRECT_URI")?.trim() || "https://polesheadlamp-id.pages.dev/";
const TIKTOK_TOKEN_STORAGE_KEY = "tiktok_ads_oauth_token";
const TIKTOK_ADVERTISER_CACHE_KEY = "tiktok_ads_cached_advertisers";
const TIKTOK_BC_CACHE_KEY = "tiktok_ads_cached_business_centers";
const TIKTOK_INTEGRATION_CONFIG_PREFIX = "tiktok_ads_integration_config:";
const TIKTOK_SYNC_BATCH_SIZE = Math.min(
  10,
  Math.max(1, Number(Deno.env.get("TIKTOK_SYNC_BATCH_SIZE") || "4")),
);
const TIKTOK_SYNC_DATE_CHUNK_DAYS = Math.min(
  90,
  Math.max(1, Number(Deno.env.get("TIKTOK_SYNC_DATE_CHUNK_DAYS") || "30")),
);
const TIKTOK_PAGE_SIZE_MAX = 50;
const TIKTOK_REPORT_DIMENSIONS = ["advertiser_id"];
const TIKTOK_DAILY_REPORT_DIMENSIONS = ["advertiser_id", "stat_time_day"];
const TIKTOK_REPORT_METRICS = [
  "spend",
  "clicks",
  "impressions",
  "conversion",
  "cost_per_conversion",
];

type TikTokStoredToken = {
  appId: string;
  redirectUri: string;
  exchangedAt: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresInSeconds: number | null;
  refreshExpiresInSeconds: number | null;
  advertiserIds: string[];
  scope: string[];
  tokenType: string | null;
  rawData: Record<string, unknown>;
};

type TikTokBusinessCenterRecord = {
  bcId: string;
  bcName: string;
  raw: Record<string, unknown>;
};

type TikTokAdvertiserRecord = {
  advertiserId: string;
  advertiserName: string;
  currency: string | null;
  status: string | null;
  timezone: string | null;
  bcId: string | null;
  bcName: string | null;
  raw: {
    authorized: Record<string, unknown>;
    info: Record<string, unknown>;
  };
};

type TikTokAccountSnapshot = {
  advertiserId: string;
  advertiserName: string;
  businessCenterId: string | null;
  businessCenterName: string;
  currency: string;
  status: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  costPerConversion: number | null;
  dateStart: string;
  dateStop: string;
  error: string | null;
};

type TikTokIntegrationConfigRecord = {
  adAccountId: string;
  enabled: boolean;
  businessCenterId?: string;
  businessCenterName?: string;
  liveTikTokAdvertiserId?: string;
  liveTikTokAdvertiserName?: string;
  updatedAt?: string;
  updatedBy?: string;
};

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toOptionalNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => readString(item)).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [] as string[];
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function normalizeAdvertiserId(value?: unknown) {
  return readString(value).replace(/\D/g, "");
}

function normalizeBusinessCenterId(value?: unknown) {
  return readString(value).replace(/\D/g, "");
}

function normalizeLookupKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function formatTikTokBusinessCenterName(value?: unknown) {
  const name = readString(value);
  if (!name) return null;
  if (/^bm\b/i.test(name)) return name;
  return `BM ${name}`;
}

function computeExpiresAt(exchangedAt: string, expiresInSeconds: number | null) {
  if (!expiresInSeconds || expiresInSeconds <= 0) return null;
  const timestamp = new Date(exchangedAt).getTime() + expiresInSeconds * 1000;
  return new Date(timestamp).toISOString();
}

function normalizeTikTokTokenData(data: Record<string, unknown>) {
  const advertiserIds = dedupeStrings([
    ...readStringArray(data.advertiser_ids).map((value) => normalizeAdvertiserId(value)),
    ...readStringArray(data.advertiser_id).map((value) => normalizeAdvertiserId(value)),
  ]);
  const scope = dedupeStrings([
    ...readStringArray(data.scope),
    ...readStringArray(data.scopes),
  ]);

  return {
    appId: TIKTOK_APP_ID,
    redirectUri: TIKTOK_REDIRECT_URI,
    exchangedAt: new Date().toISOString(),
    accessToken: readString(data.access_token) || null,
    refreshToken: readString(data.refresh_token) || null,
    expiresInSeconds:
      toOptionalNumber(data.expires_in) ?? toOptionalNumber(data.access_token_expires_in),
    refreshExpiresInSeconds:
      toOptionalNumber(data.refresh_expires_in) ?? toOptionalNumber(data.refresh_token_expires_in),
    advertiserIds,
    scope,
    tokenType: readString(data.token_type) || null,
    rawData: data,
  } satisfies TikTokStoredToken;
}

function isValidDateParam(value?: string) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function ensureTikTokConfigured() {
  if (!TIKTOK_APP_ID) {
    throw new Error("TIKTOK_APP_ID belum diatur di server.");
  }
  if (!TIKTOK_APP_SECRET) {
    throw new Error("TIKTOK_APP_SECRET belum diatur di server.");
  }
  if (!TIKTOK_REDIRECT_URI) {
    throw new Error("TIKTOK_REDIRECT_URI belum diatur di server.");
  }
}

function buildTikTokAuthorizeUrl(state?: string) {
  const url = new URL("https://business-api.tiktok.com/portal/auth");
  if (TIKTOK_APP_ID) {
    url.searchParams.set("app_id", TIKTOK_APP_ID);
  }
  url.searchParams.set("state", state?.trim() || "polesheadlamp-tiktok-auth");
  if (TIKTOK_REDIRECT_URI) {
    url.searchParams.set("redirect_uri", TIKTOK_REDIRECT_URI);
  }
  return url.toString();
}

async function readJsonBody(c: any) {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

async function requireAuthenticatedUser(c: any) {
  const clientTokenHeader = c.req.header("x-client-token");
  const authHeader = c.req.header("Authorization");
  const token = clientTokenHeader?.trim()
    ? clientTokenHeader.trim()
    : authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : "";

  if (!token) {
    return null;
  }

  const { data, error } = await authSupabase.auth.getUser(token);
  if (error || !data?.user) {
    return null;
  }

  return data.user;
}

function canManageAdsOAuthRole(role: unknown) {
  const normalized = readString(role).toLowerCase();
  return normalized === "owner" || normalized === "super admin" || normalized === "super_admin";
}

async function requireAdsOAuthManager(c: any) {
  const user = await requireAuthenticatedUser(c);
  if (!user) {
    return { error: c.json({ error: "Unauthorized" }, 401) };
  }

  const { data: profile } = await authSupabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!canManageAdsOAuthRole(profile?.role || user.user_metadata?.role)) {
    return { error: c.json({ error: "Forbidden: hanya Owner/Super Admin yang dapat reconnect TikTok Ads." }, 403) };
  }

  return { user };
}

type AdsPermissionAccess =
  | { ok: true; requester: RequesterAccessContext }
  | { ok: false; error: Response };

const ADS_VIEW_PERMISSIONS: PermissionKey[] = [
  "monitoring.marketing.view",
  "ads.view_daily",
  "ads.view_analytics",
  "dashboard.view_advertiser",
  "dashboard.view_cs",
  "dashboard.view_owner",
];
const ADS_MANAGE_PERMISSIONS: PermissionKey[] = ["ads.manage"];

function isTrustedServiceRoleRequest(c: any) {
  const expected = readString(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const provided = readString(
    c.req.header("x-service-role-key") ||
      c.req.header("x-supabase-service-role-key") ||
      c.req.header("x-scheduler-secret"),
  );

  return Boolean(expected && provided && provided === expected);
}

async function requireAnyAdsPermission(
  c: any,
  permissions: readonly PermissionKey[],
): Promise<AdsPermissionAccess> {
  const requester = await getRequesterAccessContext(c.req.raw.headers);
  if (!requester) {
    return { ok: false, error: c.json({ error: "Unauthorized" }, 401) };
  }

  if (!permissions.some((permission) => hasEffectivePermission(requester, permission))) {
    return { ok: false, error: c.json({ error: "Forbidden" }, 403) };
  }

  return { ok: true, requester };
}

function appendQueryValue(params: URLSearchParams, key: string, value: unknown) {
  if (typeof value === "undefined" || value === null || value === "") return;

  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    params.set(key, JSON.stringify(value));
    return;
  }

  if (typeof value === "boolean") {
    params.set(key, value ? "true" : "false");
    return;
  }

  params.set(key, String(value));
}

async function fetchTikTokJson(
  path: string,
  options?: {
    method?: "GET" | "POST";
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
    accessToken?: string | null;
  },
) {
  const url = new URL(`${TIKTOK_BASE_URL}${path}`);
  const query = options?.query || {};
  for (const [key, value] of Object.entries(query)) {
    appendQueryValue(url.searchParams, key, value);
  }

  const headers = new Headers({
    "Content-Type": "application/json",
  });
  if (options?.accessToken) {
    headers.set("Access-Token", options.accessToken);
  }

  const response = await fetch(url.toString(), {
    method: options?.method || "GET",
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readString(payload?.message) || `TikTok API error (${response.status})`);
  }

  if (typeof payload?.code !== "undefined" && Number(payload.code) !== 0) {
    throw new Error(readString(payload?.message) || "TikTok API mengembalikan error.");
  }

  return payload as Record<string, unknown>;
}

async function getStoredTikTokToken() {
  const token = await kv.get(TIKTOK_TOKEN_STORAGE_KEY);
  return (token || null) as TikTokStoredToken | null;
}

async function storeTikTokToken(token: TikTokStoredToken) {
  await kv.set(TIKTOK_TOKEN_STORAGE_KEY, token);
}

async function requireStoredTikTokToken() {
  const token = await getStoredTikTokToken();
  if (!token?.accessToken) {
    throw new Error(
      "Token TikTok belum tersedia di server. Jalankan exchange-code setelah advertiser authorize.",
    );
  }
  return token;
}

function extractListFromTikTokData(data: unknown) {
  if (!data || typeof data !== "object") return [] as Record<string, unknown>[];
  const record = data as Record<string, unknown>;

  if (Array.isArray(record.list)) return record.list as Record<string, unknown>[];
  if (Array.isArray(record.bc_list)) return record.bc_list as Record<string, unknown>[];
  if (Array.isArray(record.asset_list)) return record.asset_list as Record<string, unknown>[];
  if (Array.isArray(record.advertiser_info_list)) {
    return record.advertiser_info_list as Record<string, unknown>[];
  }

  for (const [key, value] of Object.entries(record)) {
    if (key.endsWith("_list") && Array.isArray(value)) {
      return value as Record<string, unknown>[];
    }
  }

  return [] as Record<string, unknown>[];
}

function extractAdvertiserIds(data: unknown) {
  if (!data || typeof data !== "object") return [] as string[];
  const record = data as Record<string, unknown>;

  return dedupeStrings([
    ...readStringArray(record.advertiser_ids).map((value) => normalizeAdvertiserId(value)),
    ...extractListFromTikTokData(data).map((item) =>
      normalizeAdvertiserId(item.advertiser_id) || normalizeAdvertiserId(item.id)
    ),
  ]);
}

function getRecordValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof record[key] !== "undefined") {
      return record[key];
    }
  }

  return undefined;
}

function getRecordNumber(record: Record<string, unknown>, keys: string[]) {
  const value = getRecordValue(record, keys);
  return toOptionalNumber(value);
}

function getRecordString(record: Record<string, unknown>, keys: string[]) {
  const value = getRecordValue(record, keys);
  return readString(value);
}

function isActiveTikTokStatus(status: string | null) {
  const normalized = readString(status).toUpperCase();
  return ["ACTIVE", "ENABLE", "ENABLED", "NORMAL"].includes(normalized);
}

function buildBusinessCenterMap(rows: TikTokBusinessCenterRecord[]) {
  const map = new Map<string, TikTokBusinessCenterRecord>();

  for (const row of rows) {
    if (!row.bcId) continue;
    map.set(row.bcId, row);
  }

  return map;
}

function normalizeTikTokAccountSnapshot(
  advertiser: TikTokAdvertiserRecord,
  row: Record<string, unknown> | null,
  from: string,
  to: string,
  error?: string | null,
): TikTokAccountSnapshot {
  const dimensions =
    row?.dimensions && typeof row.dimensions === "object"
      ? (row.dimensions as Record<string, unknown>)
      : {};
  const metrics =
    row?.metrics && typeof row.metrics === "object"
      ? (row.metrics as Record<string, unknown>)
      : {};
  const source = row || {};
  const spend =
    getRecordNumber(metrics, ["spend", "cost"]) ??
    getRecordNumber(source, ["spend", "cost"]) ??
    0;
  const clicks =
    getRecordNumber(metrics, ["clicks", "click_cnt", "click"]) ??
    getRecordNumber(source, ["clicks", "click_cnt", "click"]) ??
    0;
  const impressions =
    getRecordNumber(metrics, ["impressions", "show_cnt", "show"]) ??
    getRecordNumber(source, ["impressions", "show_cnt", "show"]) ??
    0;
  const conversions =
    getRecordNumber(metrics, ["conversion", "conversions", "convert_cnt", "results"]) ??
    getRecordNumber(source, ["conversion", "conversions", "convert_cnt", "results"]) ??
    0;
  const ctr =
    getRecordNumber(metrics, ["ctr"]) ??
    getRecordNumber(source, ["ctr"]) ??
    (impressions > 0 ? (clicks / impressions) * 100 : null);
  const cpc =
    getRecordNumber(metrics, ["cpc"]) ??
    getRecordNumber(source, ["cpc"]) ??
    (clicks > 0 ? spend / clicks : null);
  const cpm =
    getRecordNumber(metrics, ["cpm"]) ??
    getRecordNumber(source, ["cpm"]) ??
    (impressions > 0 ? (spend / impressions) * 1000 : null);
  const costPerConversion =
    getRecordNumber(metrics, ["cost_per_conversion", "cost_per_result"]) ??
    getRecordNumber(source, ["cost_per_conversion", "cost_per_result"]) ??
    (conversions > 0 ? spend / conversions : null);

  return {
    advertiserId:
      normalizeAdvertiserId(dimensions.advertiser_id) ||
      normalizeAdvertiserId(source.advertiser_id) ||
      advertiser.advertiserId,
    advertiserName:
      getRecordString(dimensions, ["advertiser_name"]) ||
      getRecordString(source, ["advertiser_name", "advertiser"]) ||
      advertiser.advertiserName,
    businessCenterId: advertiser.bcId,
    businessCenterName: advertiser.bcName || "TikTok Business Center Belum Dipetakan",
    currency: advertiser.currency || "IDR",
    status: advertiser.status || "UNKNOWN",
    spend,
    clicks,
    impressions,
    conversions,
    ctr,
    cpc,
    cpm,
    costPerConversion,
    dateStart: from,
    dateStop: to,
    error: error || null,
  };
}

function normalizeTikTokSnapshotDate(value: unknown, fallback: string) {
  const raw = readString(value);
  if (!raw) return fallback;

  const dateCandidate = raw.slice(0, 10);
  return isValidDateParam(dateCandidate) ? dateCandidate : fallback;
}

function listTikTokDatesInRange(from: string, to: string) {
  return listDateChunks(from, to, 1).map((chunk) => chunk.from);
}

async function readTikTokIntegrationConfigs() {
  return (await kv.getByPrefix(TIKTOK_INTEGRATION_CONFIG_PREFIX)) as TikTokIntegrationConfigRecord[];
}

async function fetchBusinessCenters(token: TikTokStoredToken) {
  const rows: TikTokBusinessCenterRecord[] = [];

  for (let page = 1; page <= 50; page += 1) {
    const payload = await fetchTikTokJson("/bc/get/", {
      query: {
        page,
        page_size: TIKTOK_PAGE_SIZE_MAX,
      },
      accessToken: token.accessToken,
    });

    const pageRows = extractListFromTikTokData(payload.data).map((item) => ({
      bcId: normalizeBusinessCenterId(item.bc_id) || normalizeBusinessCenterId(item.id),
      bcName: readString(item.bc_name) || readString(item.name),
      raw: item,
    }));

    rows.push(...pageRows.filter((row) => row.bcId));
    if (pageRows.length < TIKTOK_PAGE_SIZE_MAX) {
      break;
    }
  }

  const dedupedRows = Array.from(
    new Map(rows.map((row) => [row.bcId, row])).values(),
  ).sort((left, right) => left.bcName.localeCompare(right.bcName));

  await kv.set(TIKTOK_BC_CACHE_KEY, {
    fetchedAt: new Date().toISOString(),
    businessCenters: dedupedRows,
  });

  return dedupedRows;
}

async function fetchAuthorizedAdvertisers(
  token: TikTokStoredToken,
  options?: { businessCenters?: TikTokBusinessCenterRecord[] },
) {
  ensureTikTokConfigured();

  const oauthPayload = await fetchTikTokJson("/oauth2/advertiser/get/", {
    query: {
      app_id: TIKTOK_APP_ID,
      secret: TIKTOK_APP_SECRET,
    },
    accessToken: token.accessToken,
  });

  const oauthData = (oauthPayload.data || {}) as Record<string, unknown>;
  const authorizedList = extractListFromTikTokData(oauthData);
  const advertiserIds = dedupeStrings([
    ...token.advertiserIds,
    ...extractAdvertiserIds(oauthData),
  ]);

  const infoList: Record<string, unknown>[] = [];
  for (const advertiserIdChunk of chunkArray(advertiserIds, 20)) {
    if (advertiserIdChunk.length === 0) continue;

    try {
      const advertiserInfoPayload = await fetchTikTokJson("/advertiser/info/", {
        query: {
          advertiser_ids: advertiserIdChunk,
        },
        accessToken: token.accessToken,
      });
      infoList.push(...extractListFromTikTokData(advertiserInfoPayload.data));
    } catch (error) {
      console.warn("TikTok advertiser info chunk gagal:", error);
    }
  }

  const infoByAdvertiserId = new Map<string, Record<string, unknown>>();
  for (const item of infoList) {
    const advertiserId = normalizeAdvertiserId(item.advertiser_id) || normalizeAdvertiserId(item.id);
    if (advertiserId) {
      infoByAdvertiserId.set(advertiserId, item);
    }
  }

  const businessCenterMap = buildBusinessCenterMap(
    options?.businessCenters || (await fetchBusinessCenters(token)),
  );

  const advertisers = advertiserIds
    .map((advertiserId) => {
      const authorizedRecord =
        authorizedList.find(
          (item) =>
            (normalizeAdvertiserId(item.advertiser_id) || normalizeAdvertiserId(item.id)) ===
            advertiserId,
        ) || {};
      const infoRecord = infoByAdvertiserId.get(advertiserId) || {};
      const ownerBusinessCenterId =
        normalizeBusinessCenterId(infoRecord.owner_bc_id) ||
        normalizeBusinessCenterId(authorizedRecord.owner_bc_id) ||
        null;
      const bcId =
        normalizeBusinessCenterId(infoRecord.bc_id) ||
        normalizeBusinessCenterId(authorizedRecord.bc_id) ||
        ownerBusinessCenterId ||
        null;
      const bcName = bcId
        ? businessCenterMap.get(bcId)?.bcName ||
          formatTikTokBusinessCenterName(infoRecord.owner_bc_name) ||
          formatTikTokBusinessCenterName(infoRecord.company) ||
          formatTikTokBusinessCenterName(authorizedRecord.company) ||
          bcId
        : null;

      return {
        advertiserId,
        advertiserName:
          readString(infoRecord.advertiser_name) ||
          readString(infoRecord.name) ||
          readString(authorizedRecord.advertiser_name) ||
          readString(authorizedRecord.name) ||
          advertiserId,
        currency:
          readString(infoRecord.currency) || readString(authorizedRecord.currency) || null,
        status: readString(infoRecord.status) || readString(authorizedRecord.status) || null,
        timezone:
          readString(infoRecord.timezone) || readString(authorizedRecord.timezone) || null,
        bcId,
        bcName,
        raw: {
          authorized: authorizedRecord,
          info: infoRecord,
        },
      } satisfies TikTokAdvertiserRecord;
    })
    .sort((left, right) => left.advertiserName.localeCompare(right.advertiserName));

  await kv.set(TIKTOK_ADVERTISER_CACHE_KEY, {
    fetchedAt: new Date().toISOString(),
    advertisers,
  });

  return advertisers;
}

async function resolveTikTokAdvertiserSelection(params?: {
  requestedAdvertiserId?: string;
  requestedBusinessCenterId?: string;
  includeAll?: boolean;
}) {
  const token = await requireStoredTikTokToken();
  const [businessCenters, allAdvertisers, configs] = await Promise.all([
    fetchBusinessCenters(token),
    fetchAuthorizedAdvertisers(token),
    readTikTokIntegrationConfigs(),
  ]);

  const requestedAdvertiserId = normalizeAdvertiserId(params?.requestedAdvertiserId);
  const requestedBusinessCenterId = normalizeBusinessCenterId(params?.requestedBusinessCenterId);
  const configuredAdvertiserIds = dedupeStrings(
    configs
      .filter((config) => config.enabled && config.liveTikTokAdvertiserId)
      .map((config) => normalizeAdvertiserId(config.liveTikTokAdvertiserId)),
  );

  let targetAdvertisers = allAdvertisers;

  if (requestedAdvertiserId) {
    targetAdvertisers = targetAdvertisers.filter(
      (advertiser) => advertiser.advertiserId === requestedAdvertiserId,
    );
  } else if (requestedBusinessCenterId) {
    targetAdvertisers = targetAdvertisers.filter(
      (advertiser) => advertiser.bcId === requestedBusinessCenterId,
    );
  } else if (!params?.includeAll && configuredAdvertiserIds.length > 0) {
    targetAdvertisers = targetAdvertisers.filter((advertiser) =>
      configuredAdvertiserIds.includes(advertiser.advertiserId),
    );
  } else if (!params?.includeAll && configuredAdvertiserIds.length === 0) {
    targetAdvertisers = [];
  }

  return {
    token,
    businessCenters,
    allAdvertisers,
    configs,
    targetAdvertisers,
  };
}

async function fetchBusinessCenterAssets(
  token: TikTokStoredToken,
  params: {
    bcId: string;
    assetType: string;
    childBcId?: string;
    page?: number;
    pageSize?: number;
  },
) {
  const payload = await fetchTikTokJson("/bc/asset/get/", {
    query: {
      bc_id: params.bcId,
      asset_type: params.assetType,
      child_bc_id: params.childBcId,
      page: params.page || 1,
      page_size: Math.max(1, Math.min(TIKTOK_PAGE_SIZE_MAX, params.pageSize || TIKTOK_PAGE_SIZE_MAX)),
    },
    accessToken: token.accessToken,
  });

  return extractListFromTikTokData(payload.data);
}

async function fetchTikTokAdvertiserReportSnapshot(
  token: TikTokStoredToken,
  advertiser: TikTokAdvertiserRecord,
  from: string,
  to: string,
) {
  try {
    const payload = await fetchTikTokJson("/report/integrated/get/", {
      query: {
        advertiser_id: advertiser.advertiserId,
        service_type: "AUCTION",
        report_type: "BASIC",
        data_level: "AUCTION_ADVERTISER",
        dimensions: TIKTOK_REPORT_DIMENSIONS,
        metrics: TIKTOK_REPORT_METRICS,
        start_date: from,
        end_date: to,
        page: 1,
        page_size: 1000,
      },
      accessToken: token.accessToken,
    });

    const rows = extractListFromTikTokData(payload.data);
    const matchedRow =
      rows.find((row) => {
        const dimensions =
          row?.dimensions && typeof row.dimensions === "object"
            ? (row.dimensions as Record<string, unknown>)
            : {};
        return (
          normalizeAdvertiserId(dimensions.advertiser_id) === advertiser.advertiserId ||
          normalizeAdvertiserId(row.advertiser_id) === advertiser.advertiserId
        );
      }) || rows[0] || null;

    return normalizeTikTokAccountSnapshot(advertiser, matchedRow, from, to, null);
  } catch (error) {
    return normalizeTikTokAccountSnapshot(
      advertiser,
      null,
      from,
      to,
      error instanceof Error ? error.message : "TikTok report integrated gagal.",
    );
  }
}

async function fetchTikTokAdvertiserDailySnapshots(
  token: TikTokStoredToken,
  advertiser: TikTokAdvertiserRecord,
  from: string,
  to: string,
) {
  try {
    const payload = await fetchTikTokJson("/report/integrated/get/", {
      query: {
        advertiser_id: advertiser.advertiserId,
        service_type: "AUCTION",
        report_type: "BASIC",
        data_level: "AUCTION_ADVERTISER",
        dimensions: TIKTOK_DAILY_REPORT_DIMENSIONS,
        metrics: TIKTOK_REPORT_METRICS,
        start_date: from,
        end_date: to,
        page: 1,
        page_size: 1000,
      },
      accessToken: token.accessToken,
    });

    const rows = extractListFromTikTokData(payload.data);
    return rows.map((row) => {
      const dimensions =
        row?.dimensions && typeof row.dimensions === "object"
          ? (row.dimensions as Record<string, unknown>)
          : {};
      const snapshotDate = normalizeTikTokSnapshotDate(dimensions.stat_time_day, from);
      const snapshot = normalizeTikTokAccountSnapshot(advertiser, row, snapshotDate, snapshotDate, null);

      return {
        ...snapshot,
        dateStart: snapshotDate,
        dateStop: snapshotDate,
      };
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "TikTok report harian gagal dimuat.";

    return listTikTokDatesInRange(from, to).map((snapshotDate) => ({
      advertiserId: advertiser.advertiserId,
      advertiserName: advertiser.advertiserName,
      businessCenterId: advertiser.bcId,
      businessCenterName: advertiser.bcName || "TikTok Business Center Belum Dipetakan",
      currency: advertiser.currency || "IDR",
      status: advertiser.status || "UNKNOWN",
      spend: 0,
      clicks: 0,
      impressions: 0,
      conversions: 0,
      ctr: null,
      cpc: null,
      cpm: null,
      costPerConversion: null,
      dateStart: snapshotDate,
      dateStop: snapshotDate,
      error: message,
    } satisfies TikTokAccountSnapshot));
  }
}

async function buildTikTokLiveBreakdown(params: {
  from: string;
  to: string;
  requestedAdvertiserId?: string;
  requestedBusinessCenterId?: string;
  includeAll?: boolean;
}) {
  const { token, businessCenters, allAdvertisers, targetAdvertisers } =
    await resolveTikTokAdvertiserSelection({
      requestedAdvertiserId: params.requestedAdvertiserId,
      requestedBusinessCenterId: params.requestedBusinessCenterId,
      includeAll: params.includeAll,
    });

  const snapshots: TikTokAccountSnapshot[] = [];
  for (const advertiserChunk of chunkArray(targetAdvertisers, TIKTOK_SYNC_BATCH_SIZE)) {
    const chunkSnapshots = await Promise.all(
      advertiserChunk.map((advertiser) =>
        fetchTikTokAdvertiserReportSnapshot(token, advertiser, params.from, params.to),
      ),
    );
    snapshots.push(...chunkSnapshots);
  }

  const businessCenterMap = buildBusinessCenterMap(businessCenters);
  const groupsMap = new Map<
    string,
    {
      id: string;
      name: string;
      advertiserCount: number;
      spend: number;
      clicks: number;
      impressions: number;
      conversions: number;
    }
  >();

  for (const snapshot of snapshots) {
    const groupId = snapshot.businessCenterId || "tiktok-bc-unmapped";
    const groupName =
      snapshot.businessCenterId
        ? businessCenterMap.get(snapshot.businessCenterId)?.bcName || snapshot.businessCenterName
        : "TikTok Business Center Belum Dipetakan";
    const current = groupsMap.get(groupId) || {
      id: groupId,
      name: groupName,
      advertiserCount: 0,
      spend: 0,
      clicks: 0,
      impressions: 0,
      conversions: 0,
    };

    current.advertiserCount += 1;
    current.spend += snapshot.spend;
    current.clicks += snapshot.clicks;
    current.impressions += snapshot.impressions;
    current.conversions += snapshot.conversions;
    groupsMap.set(groupId, current);
  }

  const businessCenterGroups = Array.from(groupsMap.values()).sort((left, right) => {
    if (right.spend !== left.spend) return right.spend - left.spend;
    return left.name.localeCompare(right.name);
  });

  return {
    businessCenters,
    advertisers: allAdvertisers,
    targetAdvertisers,
    accountSnapshots: snapshots.sort((left, right) => {
      if (right.spend !== left.spend) return right.spend - left.spend;
      return left.advertiserName.localeCompare(right.advertiserName);
    }),
    businessCenterGroups,
  };
}

export async function syncTikTokSnapshotRange(params: {
  from: string;
  to: string;
  requestedAdvertiserId?: string;
  requestedBusinessCenterId?: string;
  force?: boolean;
  minFreshMinutes?: number;
}) {
  const { from, to } = params;
  const minFreshMinutes = params.minFreshMinutes ?? 10;
  const force = params.force ?? false;

  const latestSyncedAt = await getLatestAdsSnapshotSyncAt({
    platformKey: "tiktok",
    from,
    to,
  });

  if (!force && isSyncFresh(latestSyncedAt, minFreshMinutes)) {
    let rows = await fetchAdsDailySnapshots({
      platformKey: "tiktok",
      from,
      to,
      externalAccountIds: params.requestedAdvertiserId ? [params.requestedAdvertiserId] : undefined,
      externalGroupId: params.requestedBusinessCenterId || null,
    });

    return {
      rows,
      upsertedCount: 0,
      latestSyncedAt,
      servedFrom: "snapshot-db",
      skippedSync: true,
    };
  }

  const { token, configs, targetAdvertisers } = await resolveTikTokAdvertiserSelection({
    requestedAdvertiserId: params.requestedAdvertiserId,
    requestedBusinessCenterId: params.requestedBusinessCenterId,
    includeAll: false,
  });

  if (
    !params.requestedAdvertiserId &&
    !params.requestedBusinessCenterId &&
    targetAdvertisers.length === 0
  ) {
    const rows = await fetchAdsDailySnapshots({
      platformKey: "tiktok",
      from,
      to,
    });

    return {
      rows,
      upsertedCount: 0,
      latestSyncedAt: getMaxTimestamp(rows),
      servedFrom: "snapshot-db",
      skippedSync: true,
    };
  }

  const internalAccounts = await loadInternalAdAccounts();
  const internalAccountById = new Map(internalAccounts.map((account) => [account.id, account]));
  const configByAdvertiserId = new Map(
    configs
      .filter((config) => config.liveTikTokAdvertiserId)
      .map((config) => [normalizeAdvertiserId(config.liveTikTokAdvertiserId), config]),
  );
  const allRecords: AdsDailySnapshotRecord[] = [];

  for (const chunk of listDateChunks(from, to, TIKTOK_SYNC_DATE_CHUNK_DAYS)) {
    for (const advertiserChunk of chunkArray(targetAdvertisers, TIKTOK_SYNC_BATCH_SIZE)) {
      const chunkSnapshots = await Promise.all(
        advertiserChunk.map((advertiser) =>
          fetchTikTokAdvertiserDailySnapshots(token, advertiser, chunk.from, chunk.to),
        ),
      );

      for (const advertiserSnapshots of chunkSnapshots) {
        for (const account of advertiserSnapshots) {
          const matchedConfig = configByAdvertiserId.get(account.advertiserId);
          const matchedInternalAccount = matchedConfig?.adAccountId
            ? internalAccountById.get(matchedConfig.adAccountId)
            : undefined;

          allRecords.push({
            platformKey: "tiktok",
            snapshotDate: account.dateStart,
            internalAdAccountId: matchedInternalAccount?.id || null,
            advertiserId: matchedInternalAccount?.advertiserId || null,
            platformId: matchedInternalAccount?.platformId || null,
            externalAccountId: account.advertiserId,
            externalAccountName: account.advertiserName,
            externalGroupId: account.businessCenterId || null,
            externalGroupName: account.businessCenterName || null,
            externalAccountStatus: account.status || null,
            currencyCode: account.currency || null,
            spend: account.spend,
            clicks: account.clicks,
            impressions: account.impressions,
            reach: 0,
            conversions: account.conversions,
            ctr: account.ctr,
            cpc: account.cpc,
            cpm: account.cpm,
            costPerConversion: account.costPerConversion,
            error: account.error || null,
            syncedAt: new Date().toISOString(),
          });
        }
      }
    }
  }

  const upsertResult = await upsertAdsDailySnapshots(allRecords);
  let rows = await fetchAdsDailySnapshots({
    platformKey: "tiktok",
    from,
    to,
    externalAccountIds: params.requestedAdvertiserId ? [params.requestedAdvertiserId] : undefined,
    externalGroupId: params.requestedBusinessCenterId || null,
  });

  return {
    rows,
    upsertedCount: upsertResult.upsertedCount,
    latestSyncedAt: getMaxTimestamp(rows),
    servedFrom: "live-sync",
    skippedSync: false,
  };
}

app.get("/authorize-url", async (c) => {
  try {
    const access = await requireAdsOAuthManager(c);
    if (access.error) return access.error;

    return c.json({
      ok: true,
      authorizeUrl: buildTikTokAuthorizeUrl(c.req.query("state") || undefined),
      configured: {
        appId: Boolean(TIKTOK_APP_ID),
        appSecret: Boolean(TIKTOK_APP_SECRET),
        redirectUri: TIKTOK_REDIRECT_URI || null,
      },
    });
  } catch (error) {
    return c.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Gagal membuat TikTok authorization URL.",
      },
      500,
    );
  }
});

app.post("/exchange-code", async (c) => {
  try {
    const access = await requireAdsOAuthManager(c);
    if (access.error) return access.error;

    ensureTikTokConfigured();
    const body = await readJsonBody(c);
    const authCode =
      readString(body?.authCode) ||
      readString(body?.code) ||
      readString(c.req.query("authCode")) ||
      readString(c.req.query("code"));

    if (!authCode) {
      return c.json({ error: "authCode/code wajib diisi." }, 400);
    }

    const tokenPayload = await fetchTikTokJson("/oauth2/access_token/", {
      method: "POST",
      body: {
        app_id: TIKTOK_APP_ID,
        secret: TIKTOK_APP_SECRET,
        auth_code: authCode,
      },
    });

    const tokenData = (tokenPayload.data || {}) as Record<string, unknown>;
    const storedToken = normalizeTikTokTokenData(tokenData);
    await storeTikTokToken(storedToken);

    let advertisers: TikTokAdvertiserRecord[] = [];
    let advertiserError: string | null = null;
    try {
      advertisers = await fetchAuthorizedAdvertisers(storedToken);
    } catch (error) {
      advertiserError =
        error instanceof Error ? error.message : "Gagal membaca advertiser TikTok.";
    }

    return c.json({
      ok: true,
      exchangedAt: storedToken.exchangedAt,
      token: {
        accessTokenAvailable: Boolean(storedToken.accessToken),
        refreshTokenAvailable: Boolean(storedToken.refreshToken),
        advertiserIds: storedToken.advertiserIds,
        scope: storedToken.scope,
        expiresInSeconds: storedToken.expiresInSeconds,
        refreshExpiresInSeconds: storedToken.refreshExpiresInSeconds,
        expiresAt: computeExpiresAt(storedToken.exchangedAt, storedToken.expiresInSeconds),
      },
      advertisers,
      advertiserError,
    });
  } catch (error) {
    return c.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "TikTok exchange-code gagal.",
      },
      500,
    );
  }
});

app.get("/token-health", async (c) => {
  try {
    const access = await requireAnyAdsPermission(c, [
      ...ADS_VIEW_PERMISSIONS,
      ...ADS_MANAGE_PERMISSIONS,
    ]);
    if (!access.ok) return access.error;

    const token = await getStoredTikTokToken();
    const advertiserCache = await kv.get(TIKTOK_ADVERTISER_CACHE_KEY);
    const bcCache = await kv.get(TIKTOK_BC_CACHE_KEY);

    return c.json({
      ok: Boolean(token?.accessToken),
      checkedAt: new Date().toISOString(),
      apiVersion: TIKTOK_API_VERSION,
      configured: {
        appId: Boolean(TIKTOK_APP_ID),
        appSecret: Boolean(TIKTOK_APP_SECRET),
        redirectUri: TIKTOK_REDIRECT_URI || null,
      },
      token: token
        ? {
            appId: token.appId,
            exchangedAt: token.exchangedAt,
            accessTokenAvailable: Boolean(token.accessToken),
            refreshTokenAvailable: Boolean(token.refreshToken),
            advertiserIds: token.advertiserIds,
            scope: token.scope,
            expiresInSeconds: token.expiresInSeconds,
            refreshExpiresInSeconds: token.refreshExpiresInSeconds,
            expiresAt: computeExpiresAt(token.exchangedAt, token.expiresInSeconds),
          }
        : null,
      cached: {
        advertiserCount: Array.isArray(advertiserCache?.advertisers)
          ? advertiserCache.advertisers.length
          : 0,
        advertiserFetchedAt: readString(advertiserCache?.fetchedAt) || null,
        businessCenterCount: Array.isArray(bcCache?.businessCenters)
          ? bcCache.businessCenters.length
          : 0,
        businessCenterFetchedAt: readString(bcCache?.fetchedAt) || null,
      },
    });
  } catch (error) {
    return c.json(
      {
        ok: false,
        checkedAt: new Date().toISOString(),
        apiVersion: TIKTOK_API_VERSION,
        error: error instanceof Error ? error.message : "TikTok token health gagal.",
        configured: {
          appId: Boolean(TIKTOK_APP_ID),
          appSecret: Boolean(TIKTOK_APP_SECRET),
          redirectUri: TIKTOK_REDIRECT_URI || null,
        },
      },
      500,
    );
  }
});

app.get("/advertisers", async (c) => {
  try {
    const access = await requireAnyAdsPermission(c, ADS_VIEW_PERMISSIONS);
    if (!access.ok) return access.error;

    const token = await requireStoredTikTokToken();
    const businessCenters = await fetchBusinessCenters(token);
    const advertisers = await fetchAuthorizedAdvertisers(token, { businessCenters });

    return c.json({
      source: "tiktok-authorized-advertisers",
      fetchedAt: new Date().toISOString(),
      advertisers,
    });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Gagal mengambil advertiser TikTok.",
      },
      500,
    );
  }
});

app.get("/business-centers", async (c) => {
  try {
    const access = await requireAnyAdsPermission(c, ADS_VIEW_PERMISSIONS);
    if (!access.ok) return access.error;

    const token = await requireStoredTikTokToken();
    const businessCenters = await fetchBusinessCenters(token);
    return c.json({
      source: "tiktok-business-centers",
      fetchedAt: new Date().toISOString(),
      businessCenters,
    });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Gagal mengambil Business Center TikTok.",
      },
      500,
    );
  }
});

app.get("/business-centers/:bcId/assets", async (c) => {
  try {
    const access = await requireAnyAdsPermission(c, ADS_VIEW_PERMISSIONS);
    if (!access.ok) return access.error;

    const bcId = normalizeBusinessCenterId(c.req.param("bcId"));
    const assetType = readString(c.req.query("assetType")) || "ADVERTISER";
    const childBcId = normalizeBusinessCenterId(c.req.query("childBcId")) || undefined;
    const page = Math.max(1, toNumber(c.req.query("page")) || 1);
    const pageSize = Math.max(1, Math.min(TIKTOK_PAGE_SIZE_MAX, toNumber(c.req.query("pageSize")) || TIKTOK_PAGE_SIZE_MAX));

    if (!bcId) {
      return c.json({ error: "bcId wajib diisi." }, 400);
    }

    const token = await requireStoredTikTokToken();
    const assets = await fetchBusinessCenterAssets(token, {
      bcId,
      assetType,
      childBcId,
      page,
      pageSize,
    });

    return c.json({
      source: "tiktok-business-center-assets",
      fetchedAt: new Date().toISOString(),
      bcId,
      assetType,
      assets,
    });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Gagal mengambil asset TikTok Business Center.",
      },
      500,
    );
  }
});

app.get("/live-breakdown", async (c) => {
  try {
    const access = await requireAnyAdsPermission(c, ADS_VIEW_PERMISSIONS);
    if (!access.ok) return access.error;

    const from = readString(c.req.query("from"));
    const to = readString(c.req.query("to"));
    const requestedAdvertiserId = normalizeAdvertiserId(c.req.query("advertiserId"));
    const requestedBusinessCenterId = normalizeBusinessCenterId(c.req.query("businessCenterId"));
    const includeAll = parseBooleanFlag(c.req.query("includeAll"), false);

    if (!isValidDateParam(from) || !isValidDateParam(to)) {
      return c.json({ error: "Parameter from/to wajib format YYYY-MM-DD." }, 400);
    }

    const payload = await buildTikTokLiveBreakdown({
      from,
      to,
      requestedAdvertiserId,
      requestedBusinessCenterId,
      includeAll,
    });

    const summary = payload.accountSnapshots.reduce(
      (acc, account) => {
        acc.businessCenterCount = payload.businessCenterGroups.length;
        acc.accountCount += 1;
        acc.spend += account.spend;
        acc.clicks += account.clicks;
        acc.impressions += account.impressions;
        acc.conversions += account.conversions;
        return acc;
      },
      {
        businessCenterCount: payload.businessCenterGroups.length,
        accountCount: 0,
        spend: 0,
        clicks: 0,
        impressions: 0,
        conversions: 0,
      },
    );

    return c.json({
      source: "tiktok-ads-live",
      generatedAt: new Date().toISOString(),
      requestedBy: access.requester.authUser.id,
      range: { from, to },
      businessCenters: payload.businessCenterGroups,
      accounts: payload.accountSnapshots,
      summary,
      metadata: {
        apiVersion: TIKTOK_API_VERSION,
        advertiserCount: payload.advertisers.length,
        targetAdvertiserCount: payload.targetAdvertisers.length,
        businessCenterCount: payload.businessCenters.length,
      },
    });
  } catch (error) {
    console.error("TikTok Ads live breakdown error:", error);
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "TikTok Ads live breakdown gagal dimuat.",
      },
      500,
    );
  }
});

app.get("/snapshots", async (c) => {
  try {
    const access = await requireAnyAdsPermission(c, ADS_VIEW_PERMISSIONS);
    if (!access.ok) return access.error;

    const from = readString(c.req.query("from"));
    const to = readString(c.req.query("to"));
    const requestedAdvertiserId = normalizeAdvertiserId(c.req.query("advertiserId"));
    const requestedBusinessCenterId = normalizeBusinessCenterId(c.req.query("businessCenterId"));
    const includeLastKnown = parseBooleanFlag(c.req.query("includeLastKnown"), false);

    if (!isValidDateParam(from) || !isValidDateParam(to)) {
      return c.json({ error: "Parameter from/to wajib format YYYY-MM-DD." }, 400);
    }

    let rows = await fetchAdsDailySnapshots({
      platformKey: "tiktok",
      from,
      to,
      externalAccountIds: requestedAdvertiserId ? [requestedAdvertiserId] : undefined,
      externalGroupId: requestedBusinessCenterId || null,
    });

    let servedFrom = "tiktok-ads-snapshot-db";
    let fallbackSnapshotDate: string | null = null;

    if (includeLastKnown) {
      const existingAccountIds = new Set(rows.map((row) => normalizeAdvertiserId(row.externalAccountId)).filter(Boolean));
      let fallbackAdvertiserIds = requestedAdvertiserId ? [requestedAdvertiserId] : [];

      if (!requestedAdvertiserId) {
        try {
          const configs = await readTikTokIntegrationConfigs();
          fallbackAdvertiserIds = configs
            .filter(
              (config) =>
                config.enabled &&
                config.liveTikTokAdvertiserId &&
                (!requestedBusinessCenterId ||
                  normalizeBusinessCenterId(config.businessCenterId || "") === requestedBusinessCenterId),
            )
            .map((config) => normalizeAdvertiserId(config.liveTikTokAdvertiserId || ""))
            .filter((advertiserId) => advertiserId && !existingAccountIds.has(advertiserId));
        } catch (configError) {
          console.warn(
            "TikTok snapshot config lookup failed; using latest stored snapshots without config filter.",
            configError instanceof Error ? configError.message : configError,
          );
        }
      }

      const fallbackRows =
        fallbackAdvertiserIds.length > 0 || rows.length === 0
          ? await fetchLatestAdsDailySnapshotsBeforeOrOn({
              platformKey: "tiktok",
              onOrBefore: to,
              externalAccountIds: fallbackAdvertiserIds.length > 0 ? fallbackAdvertiserIds : undefined,
              externalGroupId: requestedBusinessCenterId || null,
            })
          : [];

      const mergedAccountIds = new Set(rows.map((row) => normalizeAdvertiserId(row.externalAccountId)).filter(Boolean));
      const missingFallbackRows = fallbackRows.filter((row) => {
        const advertiserId = normalizeAdvertiserId(row.externalAccountId);
        if (!advertiserId || mergedAccountIds.has(advertiserId)) return false;
        mergedAccountIds.add(advertiserId);
        return true;
      });

      rows = [...rows, ...missingFallbackRows];
      servedFrom = missingFallbackRows.length > 0 ? "tiktok-ads-snapshot-db-with-latest-known" : servedFrom;
      fallbackSnapshotDate = missingFallbackRows[0]?.snapshotDate || null;
    }

    return c.json({
      source: servedFrom,
      range: { from, to },
      rows,
      metadata: {
        rowCount: rows.length,
        lastSyncedAt: getMaxTimestamp(rows),
        servedFrom,
        fallbackSnapshotDate,
      },
    });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Gagal mengambil snapshot TikTok Ads dari database.",
      },
      500,
    );
  }
});

app.post("/sync-snapshots", async (c) => {
  try {
    if (!isTrustedServiceRoleRequest(c)) {
      const access = await requireAnyAdsPermission(c, ADS_MANAGE_PERMISSIONS);
      if (!access.ok) return access.error;
    }

    const body = await readJsonBody(c);
    const from = typeof body?.from === "string" ? body.from : readString(c.req.query("from"));
    const to = typeof body?.to === "string" ? body.to : readString(c.req.query("to"));
    const requestedAdvertiserId = normalizeAdvertiserId(
      typeof body?.advertiserId === "string" ? body.advertiserId : c.req.query("advertiserId"),
    );
    const requestedBusinessCenterId = normalizeBusinessCenterId(
      typeof body?.businessCenterId === "string"
        ? body.businessCenterId
        : c.req.query("businessCenterId"),
    );
    const force = parseBooleanFlag(
      typeof body?.force !== "undefined" ? body.force : c.req.query("force"),
      false,
    );
    const minFreshMinutes = clampNumber(
      typeof body?.minFreshMinutes !== "undefined"
        ? body.minFreshMinutes
        : c.req.query("minFreshMinutes"),
      10,
      0,
      240,
    );

    if (!isValidDateParam(from) || !isValidDateParam(to)) {
      return c.json({ error: "Parameter from/to wajib format YYYY-MM-DD." }, 400);
    }

    if (diffInDaysInclusive(from, to) > 180) {
      return c.json({ error: "Rentang sync maksimal 180 hari per request." }, 400);
    }

    const result = await syncTikTokSnapshotRange({
      from,
      to,
      requestedAdvertiserId,
      requestedBusinessCenterId,
      force,
      minFreshMinutes,
    });

    let rows = result.rows;
    if (requestedAdvertiserId) {
      rows = rows.filter((row) => row.externalAccountId === requestedAdvertiserId);
    }
    if (requestedBusinessCenterId) {
      rows = rows.filter((row) => row.externalGroupId === requestedBusinessCenterId);
    }

    return c.json({
      source: "tiktok-ads-snapshot-sync",
      range: { from, to },
      rows,
      metadata: {
        rowCount: rows.length,
        upsertedCount: result.upsertedCount,
        servedFrom: result.servedFrom,
        skippedSync: result.skippedSync,
        lastSyncedAt: result.latestSyncedAt,
      },
    });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Sinkronisasi snapshot TikTok Ads gagal.",
      },
      500,
    );
  }
});

app.get("/integration-configs", async (c) => {
  try {
    const access = await requireAnyAdsPermission(c, ADS_VIEW_PERMISSIONS);
    if (!access.ok) return access.error;

    const configs = await readTikTokIntegrationConfigs();
    return c.json({ configs });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Gagal mengambil config integrasi TikTok Ads.",
      },
      500,
    );
  }
});

app.post("/integration-configs/:adAccountId", async (c) => {
  try {
    const access = await requireAnyAdsPermission(c, ADS_MANAGE_PERMISSIONS);
    if (!access.ok) return access.error;

    const adAccountId = c.req.param("adAccountId");
    const body = await c.req.json();
    const config = {
      adAccountId,
      enabled: Boolean(body?.enabled),
      businessCenterId:
        typeof body?.businessCenterId === "string" && body.businessCenterId.trim()
          ? normalizeBusinessCenterId(body.businessCenterId)
          : undefined,
      businessCenterName:
        typeof body?.businessCenterName === "string" && body.businessCenterName.trim()
          ? body.businessCenterName.trim()
          : undefined,
      liveTikTokAdvertiserId:
        typeof body?.liveTikTokAdvertiserId === "string" && body.liveTikTokAdvertiserId.trim()
          ? normalizeAdvertiserId(body.liveTikTokAdvertiserId)
          : undefined,
      liveTikTokAdvertiserName:
        typeof body?.liveTikTokAdvertiserName === "string" && body.liveTikTokAdvertiserName.trim()
          ? body.liveTikTokAdvertiserName.trim()
          : undefined,
      updatedAt: new Date().toISOString(),
      updatedBy: access.requester.authUser.id,
    } satisfies TikTokIntegrationConfigRecord;

    await kv.set(`${TIKTOK_INTEGRATION_CONFIG_PREFIX}${adAccountId}`, config);
    return c.json({ success: true, config });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Gagal menyimpan config integrasi TikTok Ads.",
      },
      500,
    );
  }
});

app.get("/report-integrated", async (c) => {
  try {
    const access = await requireAnyAdsPermission(c, ADS_VIEW_PERMISSIONS);
    if (!access.ok) return access.error;

    const advertiserId = normalizeAdvertiserId(c.req.query("advertiserId"));
    const from = readString(c.req.query("from"));
    const to = readString(c.req.query("to"));
    const dataLevel = readString(c.req.query("dataLevel")) || "AUCTION_ADVERTISER";
    const reportType = readString(c.req.query("reportType")) || "BASIC";
    const metrics = dedupeStrings([
      ...readStringArray(c.req.query("metrics")),
      ...readStringArray(c.req.queries("metrics")),
    ]);
    const dimensions = dedupeStrings([
      ...readStringArray(c.req.query("dimensions")),
      ...readStringArray(c.req.queries("dimensions")),
    ]);

    if (!advertiserId) {
      return c.json({ error: "advertiserId wajib diisi." }, 400);
    }
    if (!isValidDateParam(from) || !isValidDateParam(to)) {
      return c.json({ error: "Parameter from/to wajib format YYYY-MM-DD." }, 400);
    }

    const token = await requireStoredTikTokToken();
    const payload = await fetchTikTokJson("/report/integrated/get/", {
      query: {
        advertiser_id: advertiserId,
        service_type: "AUCTION",
        report_type: reportType,
        data_level: dataLevel,
        start_date: from,
        end_date: to,
        metrics: metrics.length > 0 ? metrics : TIKTOK_REPORT_METRICS,
        dimensions: dimensions.length > 0 ? dimensions : TIKTOK_REPORT_DIMENSIONS,
        page: 1,
        page_size: 1000,
      },
      accessToken: token.accessToken,
    });

    return c.json({
      source: "tiktok-report-integrated",
      fetchedAt: new Date().toISOString(),
      requestedBy: access.requester.authUser.id,
      advertiserId,
      range: { from, to },
      reportType,
      dataLevel,
      rows: extractListFromTikTokData(payload.data),
      rawData: payload.data || {},
    });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Gagal mengambil report integrated TikTok.",
      },
      500,
    );
  }
});

export default app;
