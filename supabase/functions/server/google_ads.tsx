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

const GOOGLE_ADS_API_VERSION = Deno.env.get("GOOGLE_ADS_API_VERSION")?.trim() || "v22";
const GOOGLE_ADS_BASE_URL = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";
const GOOGLE_ADS_DEVELOPER_TOKEN = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN")?.trim() || "";
const GOOGLE_ADS_CLIENT_ID = Deno.env.get("GOOGLE_ADS_CLIENT_ID")?.trim() || "";
const GOOGLE_ADS_CLIENT_SECRET = Deno.env.get("GOOGLE_ADS_CLIENT_SECRET")?.trim() || "";
const GOOGLE_ADS_REFRESH_TOKEN = Deno.env.get("GOOGLE_ADS_REFRESH_TOKEN")?.trim() || "";
const GOOGLE_ADS_OAUTH_REDIRECT_URI =
  Deno.env.get("GOOGLE_ADS_OAUTH_REDIRECT_URI")?.trim() ||
  Deno.env.get("GOOGLE_ADS_REDIRECT_URI")?.trim() ||
  "http://127.0.0.1:53682/oauth2callback";
const GOOGLE_ADS_REFRESH_TOKEN_STORAGE_KEY = "google_ads_oauth_refresh_token";
const GOOGLE_ADS_LOGIN_CUSTOMER_ID = normalizeCustomerId(
  Deno.env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID")?.trim() || "",
);
const GOOGLE_ADS_CUSTOMER_IDS = parseCustomerIdList(
  Deno.env.get("GOOGLE_ADS_CUSTOMER_IDS")?.trim() || "",
);
const GOOGLE_ADS_SYNC_BATCH_SIZE = Math.min(
  5,
  Math.max(1, Number(Deno.env.get("GOOGLE_ADS_SYNC_BATCH_SIZE") || "2")),
);
const GOOGLE_ADS_DATE_CHUNK_DAYS = Math.min(
  730,
  Math.max(31, Number(Deno.env.get("GOOGLE_ADS_DATE_CHUNK_DAYS") || "365")),
);

type GoogleAdsCustomerMetadata = {
  customerId: string;
  customerName: string;
  currencyCode: string;
  timeZone: string | null;
  status: string;
  isManager: boolean;
};

type GoogleAdsAccountSnapshot = GoogleAdsCustomerMetadata & {
  managerCustomerId: string | null;
  managerCustomerName: string;
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

type GoogleAdsDiscoveredCustomer = GoogleAdsCustomerMetadata & {
  accessMode: "direct" | "manager";
  requestLoginCustomerId: string | null;
  managerCustomerId: string | null;
  managerCustomerName: string;
};

type GoogleAdsIntegrationConfigRecord = {
  adAccountId: string;
  enabled: boolean;
  managerCustomerId?: string;
  managerCustomerName?: string;
  liveGoogleCustomerId?: string;
  liveGoogleCustomerName?: string;
};

type GoogleAdsStoredRefreshToken = {
  refreshToken: string;
  exchangedAt: string;
  updatedBy?: string;
  redirectUri?: string;
  refreshTokenExpiresInSeconds?: number | null;
};

function isNonNull<T>(value: T | null): value is T {
  return value !== null;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function normalizeCustomerId(value?: string | null) {
  const digits = (value || "").replace(/\D/g, "");
  return digits || "";
}

function parseCustomerIdList(rawValue: string) {
  const seen = new Set<string>();
  const rows: string[] = [];

  for (const value of rawValue.split(",")) {
    const normalized = normalizeCustomerId(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    rows.push(normalized);
  }

  return rows;
}

function isValidDateParam(value?: string) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function microsToCurrency(value: unknown) {
  return toNumber(value) / 1_000_000;
}

function isEnabledGoogleStatus(status?: string | null) {
  return String(status || "").toUpperCase() === "ENABLED";
}

function extractGoogleAdsErrorMessage(payload: any, status: number) {
  const root = Array.isArray(payload) ? payload[0] : payload;
  const firstGoogleAdsError = root?.error?.details?.[0]?.errors?.[0];

  return (
    firstGoogleAdsError?.message ||
    root?.error?.message ||
    root?.message ||
    `Google Ads API error (${status})`
  );
}

function buildGoogleAdsHeaders(accessToken: string, loginCustomerId?: string | null) {
  const headers = new Headers({
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "developer-token": GOOGLE_ADS_DEVELOPER_TOKEN,
  });

  if (loginCustomerId) {
    headers.set("login-customer-id", loginCustomerId);
  }

  return headers;
}

function ensureGoogleAdsClientConfigured() {
  if (!GOOGLE_ADS_DEVELOPER_TOKEN) {
    throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN belum diatur di server.");
  }
  if (!GOOGLE_ADS_CLIENT_ID) {
    throw new Error("GOOGLE_ADS_CLIENT_ID belum diatur di server.");
  }
  if (!GOOGLE_ADS_CLIENT_SECRET) {
    throw new Error("GOOGLE_ADS_CLIENT_SECRET belum diatur di server.");
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

type AuthenticatedUser = NonNullable<Awaited<ReturnType<typeof requireAuthenticatedUser>>>;

type AdsOAuthManagerAccess =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; error: Response };

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

async function requireAdsOAuthManager(c: any): Promise<AdsOAuthManagerAccess> {
  const user = await requireAuthenticatedUser(c);
  if (!user) {
    return { ok: false, error: c.json({ error: "Unauthorized" }, 401) };
  }

  const { data: profile } = await authSupabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!canManageAdsOAuthRole(profile?.role || user.user_metadata?.role)) {
    return { ok: false, error: c.json({ error: "Forbidden: hanya Owner/Super Admin yang dapat reconnect Google Ads." }, 403) };
  }

  return { ok: true, user };
}

async function readStoredGoogleAdsRefreshToken() {
  const value = await kv.get(GOOGLE_ADS_REFRESH_TOKEN_STORAGE_KEY);

  if (typeof value === "string" && value.trim()) {
    return {
      refreshToken: value.trim(),
      exchangedAt: "",
    } satisfies GoogleAdsStoredRefreshToken;
  }

  if (value && typeof value === "object") {
    const refreshToken = readString((value as { refreshToken?: unknown }).refreshToken);
    if (refreshToken) {
      return {
        refreshToken,
        exchangedAt: readString((value as { exchangedAt?: unknown }).exchangedAt),
        updatedBy: readString((value as { updatedBy?: unknown }).updatedBy) || undefined,
        redirectUri: readString((value as { redirectUri?: unknown }).redirectUri) || undefined,
        refreshTokenExpiresInSeconds:
          toNumber((value as { refreshTokenExpiresInSeconds?: unknown }).refreshTokenExpiresInSeconds) || null,
      } satisfies GoogleAdsStoredRefreshToken;
    }
  }

  return null;
}

async function resolveGoogleAdsRefreshToken() {
  const storedToken = await readStoredGoogleAdsRefreshToken();
  const refreshToken = storedToken?.refreshToken || GOOGLE_ADS_REFRESH_TOKEN;

  if (!refreshToken) {
    throw new Error("GOOGLE_ADS_REFRESH_TOKEN belum diatur di server.");
  }

  return {
    refreshToken,
    source: storedToken?.refreshToken ? "kv" : "env",
    storedToken,
  };
}

async function isGoogleAdsRefreshTokenConfigured() {
  const storedToken = await readStoredGoogleAdsRefreshToken();
  return Boolean(storedToken?.refreshToken || GOOGLE_ADS_REFRESH_TOKEN);
}

function getGoogleAdsOAuthRedirectUri(value?: unknown) {
  return readString(value) || GOOGLE_ADS_OAUTH_REDIRECT_URI;
}

function buildGoogleAdsAuthorizeUrl({ redirectUri, state }: { redirectUri: string; state?: string }) {
  ensureGoogleAdsClientConfigured();

  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", GOOGLE_ADS_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_ADS_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state || "polesheadlamp-google-ads-auth");
  return url.toString();
}

async function fetchGoogleAccessToken() {
  ensureGoogleAdsClientConfigured();
  const resolvedRefreshToken = await resolveGoogleAdsRefreshToken();

  const body = new URLSearchParams({
    client_id: GOOGLE_ADS_CLIENT_ID,
    client_secret: GOOGLE_ADS_CLIENT_SECRET,
    refresh_token: resolvedRefreshToken.refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    const googleError = [payload?.error, payload?.error_description]
      .filter(Boolean)
      .join(": ");
    throw new Error(googleError || `Google OAuth refresh gagal (${response.status})`);
  }

  return {
    accessToken: String(payload.access_token),
    expiresIn: toNumber(payload.expires_in),
    refreshTokenSource: resolvedRefreshToken.source,
    storedRefreshTokenExchangedAt: resolvedRefreshToken.storedToken?.exchangedAt || null,
  };
}

async function fetchGoogleAdsJson(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(extractGoogleAdsErrorMessage(payload, response.status));
  }

  return payload;
}

async function listAccessibleCustomerIds(accessToken: string) {
  const payload = await fetchGoogleAdsJson(
    `${GOOGLE_ADS_BASE_URL}/customers:listAccessibleCustomers`,
    {
      method: "GET",
      headers: buildGoogleAdsHeaders(accessToken, null),
    },
  );

  const resourceNames = Array.isArray(payload?.resourceNames)
    ? payload.resourceNames
    : [];

  return resourceNames
    .map((resourceName: string) =>
      normalizeCustomerId(String(resourceName).split("/").pop() || ""),
    )
    .filter(Boolean);
}

async function searchGoogleAds(
  accessToken: string,
  customerId: string,
  query: string,
  options?: {
    loginCustomerId?: string | null;
  },
) {
  const payload = await fetchGoogleAdsJson(
    `${GOOGLE_ADS_BASE_URL}/customers/${customerId}/googleAds:searchStream`,
    {
      method: "POST",
      headers: buildGoogleAdsHeaders(accessToken, options?.loginCustomerId || null),
      body: JSON.stringify({ query }),
    },
  );

  const batches = Array.isArray(payload) ? payload : [payload];
  const rows: any[] = [];

  for (const batch of batches) {
    if (Array.isArray(batch?.results)) {
      rows.push(...batch.results);
    }
  }

  return rows;
}

async function fetchCustomerMetadata(
  accessToken: string,
  customerId: string,
  options?: {
    loginCustomerId?: string | null;
  },
): Promise<GoogleAdsCustomerMetadata> {
  const rows = await searchGoogleAds(
    accessToken,
    customerId,
    `
      SELECT
        customer.id,
        customer.descriptive_name,
        customer.currency_code,
        customer.time_zone,
        customer.manager,
        customer.status
      FROM customer
      LIMIT 1
    `,
    options,
  );

  const row = rows[0];
  if (!row?.customer?.id) {
    throw new Error(`Metadata customer ${customerId} tidak ditemukan.`);
  }

  return {
    customerId: normalizeCustomerId(row.customer.id),
    customerName: row.customer.descriptiveName || customerId,
    currencyCode: row.customer.currencyCode || "IDR",
    timeZone: row.customer.timeZone || null,
    status: row.customer.status || "UNKNOWN",
    isManager: Boolean(row.customer.manager),
  };
}

async function listManagerDiscoveredCustomers(
  accessToken: string,
  managerCustomerId: string,
): Promise<GoogleAdsDiscoveredCustomer[]> {
  const rows = await searchGoogleAds(
    accessToken,
    managerCustomerId,
    `
      SELECT
        customer_client.client_customer,
        customer_client.descriptive_name,
        customer_client.currency_code,
        customer_client.time_zone,
        customer_client.level,
        customer_client.manager,
        customer_client.status
      FROM customer_client
      WHERE customer_client.level <= 1
    `,
    {
      loginCustomerId: managerCustomerId,
    },
  );

  const managerRow = rows.find((row) => String(row?.customerClient?.level || "") === "0");
  const managerName =
    managerRow?.customerClient?.descriptiveName || GOOGLE_ADS_LOGIN_CUSTOMER_ID || "Google Ads MCC";

  const mappedCustomers: Array<GoogleAdsDiscoveredCustomer | null> = rows
    .map((row) => {
      const customerClient = row?.customerClient;
      const customerId = normalizeCustomerId(
        String(customerClient?.clientCustomer || "").split("/").pop() || "",
      );

      if (!customerId) return null;

      const isManager = Boolean(customerClient?.manager);
      const isTopManager = customerId === managerCustomerId;
      const customerName = customerClient?.descriptiveName || customerId;

      return {
        customerId,
        customerName,
        currencyCode: customerClient?.currencyCode || "IDR",
        timeZone: customerClient?.timeZone || null,
        status: customerClient?.status || "UNKNOWN",
        isManager,
        accessMode: "manager" as const,
        requestLoginCustomerId: isTopManager ? null : managerCustomerId,
        managerCustomerId: isTopManager ? customerId : managerCustomerId,
        managerCustomerName: isTopManager ? customerName : managerName,
      } satisfies GoogleAdsDiscoveredCustomer;
    });

  return mappedCustomers.filter(isNonNull);
}

async function discoverGoogleAdsCustomers(accessToken: string) {
  const directAccessibleCustomerIds = await listAccessibleCustomerIds(accessToken);
  const discoveredByCustomerId = new Map<string, GoogleAdsDiscoveredCustomer>();

  const directCustomers = await Promise.all(
    directAccessibleCustomerIds.map(async (customerId: string) => {
      const metadata = await fetchCustomerMetadata(accessToken, customerId, {
        loginCustomerId: null,
      }).catch(() => null);

      if (!metadata) return null;

      return {
        ...metadata,
        accessMode: "direct" as const,
        requestLoginCustomerId: null,
        managerCustomerId: null,
        managerCustomerName: "Google Ads Direct Access",
      } satisfies GoogleAdsDiscoveredCustomer;
    }),
  );

  for (const customer of directCustomers) {
    if (!customer) continue;
    discoveredByCustomerId.set(customer.customerId, customer);
  }

  let managerHierarchyCount = 0;
  if (GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    const managerCustomers = await listManagerDiscoveredCustomers(
      accessToken,
      GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    ).catch(() => []);

    managerHierarchyCount = managerCustomers.length;
    for (const customer of managerCustomers) {
      const existing = discoveredByCustomerId.get(customer.customerId);
      discoveredByCustomerId.set(customer.customerId, {
        ...(existing || customer),
        ...customer,
      });
    }
  }

  let customers = Array.from(discoveredByCustomerId.values());
  if (GOOGLE_ADS_CUSTOMER_IDS.length > 0) {
    customers = customers.filter((customer) => GOOGLE_ADS_CUSTOMER_IDS.includes(customer.customerId));
  }

  return {
    directAccessibleCustomerIds,
    customers,
    managerHierarchyCount,
  };
}

async function fetchCustomerSnapshot(
  accessToken: string,
  customer: GoogleAdsDiscoveredCustomer,
  from: string,
  to: string,
): Promise<GoogleAdsAccountSnapshot> {
  const metricsQuery = `
    SELECT
      customer.id,
      customer.descriptive_name,
      customer.currency_code,
      customer.time_zone,
      customer.manager,
      customer.status,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions
    FROM customer
    WHERE segments.date BETWEEN '${from}' AND '${to}'
    LIMIT 1
  `;

  try {
    const rows = await searchGoogleAds(accessToken, customer.customerId, metricsQuery, {
      loginCustomerId: customer.requestLoginCustomerId,
    });
    const row = rows[0];
    const metadata = row?.customer?.id
      ? {
          customerId: normalizeCustomerId(row.customer.id),
          customerName: row.customer.descriptiveName || customer.customerId,
          currencyCode: row.customer.currencyCode || "IDR",
          timeZone: row.customer.timeZone || null,
          status: row.customer.status || "UNKNOWN",
          isManager: Boolean(row.customer.manager),
        }
      : customer;

    const spend = microsToCurrency(row?.metrics?.costMicros);
    const clicks = toNumber(row?.metrics?.clicks);
    const impressions = toNumber(row?.metrics?.impressions);
    const conversions = toNumber(row?.metrics?.conversions);
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : null;
    const cpc = clicks > 0 ? spend / clicks : null;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : null;
    const costPerConversion = conversions > 0 ? spend / conversions : null;

    return {
      ...metadata,
      managerCustomerId: customer.managerCustomerId,
      managerCustomerName: customer.managerCustomerName,
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
      error: null,
    };
  } catch (error) {
    return {
      ...customer,
      managerCustomerId: customer.managerCustomerId,
      managerCustomerName: customer.managerCustomerName,
      spend: 0,
      clicks: 0,
      impressions: 0,
      conversions: 0,
      ctr: null,
      cpc: null,
      cpm: null,
      costPerConversion: null,
      dateStart: from,
      dateStop: to,
      error: error instanceof Error ? error.message : "Google Ads snapshot gagal dimuat.",
    };
  }
}

async function fetchCustomerDailySnapshots(
  accessToken: string,
  customer: GoogleAdsDiscoveredCustomer,
  from: string,
  to: string,
) {
  const rows = await searchGoogleAds(
    accessToken,
    customer.customerId,
    `
      SELECT
        customer.id,
        customer.descriptive_name,
        customer.currency_code,
        customer.time_zone,
        customer.manager,
        customer.status,
        segments.date,
        metrics.cost_micros,
        metrics.clicks,
        metrics.impressions,
        metrics.conversions
      FROM customer
      WHERE segments.date BETWEEN '${from}' AND '${to}'
    `,
    {
      loginCustomerId: customer.requestLoginCustomerId,
    },
  );

  const dailySnapshots: Array<AdsDailySnapshotRecord | null> = rows
    .map((row) => {
      const snapshotDate = row?.segments?.date;
      if (!snapshotDate) return null;

      const spend = microsToCurrency(row?.metrics?.costMicros);
      const clicks = toNumber(row?.metrics?.clicks);
      const impressions = toNumber(row?.metrics?.impressions);
      const conversions = toNumber(row?.metrics?.conversions);
      const ctr = impressions > 0 ? (clicks / impressions) * 100 : null;
      const cpc = clicks > 0 ? spend / clicks : null;
      const cpm = impressions > 0 ? (spend / impressions) * 1000 : null;
      const costPerConversion = conversions > 0 ? spend / conversions : null;

      return {
        platformKey: "google",
        snapshotDate,
        externalAccountId: customer.customerId,
        externalAccountName:
          row?.customer?.descriptiveName ||
          customer.customerName ||
          customer.customerId,
        externalGroupId: customer.managerCustomerId || customer.customerId,
        externalGroupName: customer.managerCustomerName || customer.customerName,
        externalAccountStatus: row?.customer?.status || customer.status || "UNKNOWN",
        currencyCode: row?.customer?.currencyCode || customer.currencyCode || "IDR",
        spend,
        clicks,
        impressions,
        reach: 0,
        conversions,
        ctr,
        cpc,
        cpm,
        costPerConversion,
        error: null,
      } satisfies AdsDailySnapshotRecord;
    });

  return dailySnapshots.filter(isNonNull);
}

async function loadGoogleIntegrationConfigMap() {
  const configs = (await kv.getByPrefix(
    "google_ads_integration_config:",
  )) as GoogleAdsIntegrationConfigRecord[];
  const mapped = new Map<string, GoogleAdsIntegrationConfigRecord>();

  for (const config of configs) {
    const customerId = normalizeCustomerId(config?.liveGoogleCustomerId || "");
    if (!customerId || !config?.adAccountId) continue;
    mapped.set(customerId, config);
  }

  return mapped;
}

async function loadGoogleIntegrationConfigs() {
  return (await kv.getByPrefix(
    "google_ads_integration_config:",
  )) as GoogleAdsIntegrationConfigRecord[];
}

export async function syncGoogleAdsSnapshotRange(params: {
  from: string;
  to: string;
  requestedCustomerId?: string;
  requestedManagerId?: string;
  force?: boolean;
  minFreshMinutes?: number;
}) {
  const latestSyncedAt = await getLatestAdsSnapshotSyncAt({
    platformKey: "google",
    from: params.from,
    to: params.to,
  });

  if (
    !params.force &&
    isSyncFresh(latestSyncedAt, params.minFreshMinutes || 0)
  ) {
    const rows = await fetchAdsDailySnapshots({
      platformKey: "google",
      from: params.from,
      to: params.to,
      externalAccountIds: params.requestedCustomerId ? [params.requestedCustomerId] : undefined,
      externalGroupId: params.requestedManagerId || null,
    });

    return {
      rows,
      latestSyncedAt: latestSyncedAt || getMaxTimestamp(rows),
      upsertedCount: 0,
      servedFrom: "database-fresh",
      skippedSync: true,
    };
  }

  const token = await fetchGoogleAccessToken();
  const discovery = await discoverGoogleAdsCustomers(token.accessToken);
  const [internalAccounts, integrationConfigByCustomerId, integrationConfigs] =
    await Promise.all([
      loadInternalAdAccounts(),
      loadGoogleIntegrationConfigMap(),
      loadGoogleIntegrationConfigs(),
    ]);
  const internalAccountById = new Map(
    internalAccounts.map((account) => [account.id, account]),
  );
  const enabledConfiguredCustomerIds = new Set(
    integrationConfigs
      .filter((config) => config.enabled)
      .map((config) => normalizeCustomerId(config.liveGoogleCustomerId || ""))
      .filter(Boolean),
  );
  const discoveredTargetCustomers = params.requestedCustomerId
    ? discovery.customers.filter(
        (customer) => customer.customerId === params.requestedCustomerId,
      )
    : enabledConfiguredCustomerIds.size > 0
    ? discovery.customers.filter((customer) =>
        enabledConfiguredCustomerIds.has(customer.customerId)
      )
    : discovery.customers;
  const scopedCustomers = discoveredTargetCustomers.filter((customer) => {
    if (customer.isManager || !isEnabledGoogleStatus(customer.status)) return false;
    if (params.requestedManagerId && customer.managerCustomerId !== params.requestedManagerId) {
      return false;
    }
    return true;
  });

  let upsertedCount = 0;
  for (const chunk of listDateChunks(params.from, params.to, GOOGLE_ADS_DATE_CHUNK_DAYS)) {
    const chunkRecords: AdsDailySnapshotRecord[] = [];

    for (const customerBatch of chunkArray(scopedCustomers, GOOGLE_ADS_SYNC_BATCH_SIZE)) {
      const batchRecords = (
        await Promise.all(
          customerBatch.map(async (customer) => {
            const dailyRecords = await fetchCustomerDailySnapshots(
              token.accessToken,
              customer,
              chunk.from,
              chunk.to,
            );

            return dailyRecords.map((record) => {
              const integrationConfig = integrationConfigByCustomerId.get(record.externalAccountId);
              const internalAccount = integrationConfig?.adAccountId
                ? internalAccountById.get(integrationConfig.adAccountId)
                : null;

              const mappedRecord: AdsDailySnapshotRecord = {
                ...record,
                platformKey: "google",
                internalAdAccountId: integrationConfig?.adAccountId || null,
                advertiserId: internalAccount?.advertiserId || null,
                platformId: internalAccount?.platformId || null,
              };

              return mappedRecord;
            });
          }),
        )
      ).flat();

      chunkRecords.push(...batchRecords);
    }

    if (chunkRecords.length === 0) continue;
    const chunkResult = await upsertAdsDailySnapshots(chunkRecords);
    upsertedCount += chunkResult.upsertedCount;
  }

  const rows = await fetchAdsDailySnapshots({
    platformKey: "google",
    from: params.from,
    to: params.to,
    externalAccountIds: params.requestedCustomerId ? [params.requestedCustomerId] : undefined,
    externalGroupId: params.requestedManagerId || null,
  });

  return {
    rows,
    latestSyncedAt: getMaxTimestamp(rows),
    upsertedCount,
    servedFrom: "google-live",
    skippedSync: false,
  };
}

async function readJsonBody(c: any) {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

app.get("/authorize-url", async (c) => {
  try {
    const access = await requireAdsOAuthManager(c);
    if (!access.ok) return access.error;

    const redirectUri = getGoogleAdsOAuthRedirectUri(c.req.query("redirectUri"));

    return c.json({
      ok: true,
      authorizeUrl: buildGoogleAdsAuthorizeUrl({
        redirectUri,
        state: readString(c.req.query("state")) || undefined,
      }),
      configured: {
        developerToken: Boolean(GOOGLE_ADS_DEVELOPER_TOKEN),
        clientId: Boolean(GOOGLE_ADS_CLIENT_ID),
        clientSecret: Boolean(GOOGLE_ADS_CLIENT_SECRET),
        redirectUri,
      },
    });
  } catch (error) {
    return c.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Gagal membuat Google Ads authorization URL.",
      },
      500,
    );
  }
});

app.post("/exchange-code", async (c) => {
  try {
    const access = await requireAdsOAuthManager(c);
    if (!access.ok) return access.error;

    ensureGoogleAdsClientConfigured();
    const body = await readJsonBody(c);
    const code =
      readString(body?.code) ||
      readString(body?.authCode) ||
      readString(c.req.query("code")) ||
      readString(c.req.query("authCode"));
    const redirectUri = getGoogleAdsOAuthRedirectUri(body?.redirectUri || c.req.query("redirectUri"));

    if (!code) {
      return c.json({ error: "code/authCode wajib diisi." }, 400);
    }

    const tokenBody = new URLSearchParams({
      client_id: GOOGLE_ADS_CLIENT_ID,
      client_secret: GOOGLE_ADS_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });

    const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenBody.toString(),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.refresh_token) {
      const googleError = [payload?.error, payload?.error_description]
        .filter(Boolean)
        .join(": ");
      throw new Error(
        googleError ||
          "Google tidak mengembalikan refresh_token. Ulangi authorize dan pastikan prompt consent tampil.",
      );
    }

    const storedToken = {
      refreshToken: String(payload.refresh_token),
      exchangedAt: new Date().toISOString(),
      updatedBy: access.user.id,
      redirectUri,
      refreshTokenExpiresInSeconds: toNumber(payload.refresh_token_expires_in) || null,
    } satisfies GoogleAdsStoredRefreshToken;

    await kv.set(GOOGLE_ADS_REFRESH_TOKEN_STORAGE_KEY, storedToken);

    let healthCheck: Record<string, unknown> | null = null;
    try {
      const token = await fetchGoogleAccessToken();
      const discovery = await discoverGoogleAdsCustomers(token.accessToken);
      healthCheck = {
        expiresInSeconds: token.expiresIn,
        accessibleCustomerCount: discovery.directAccessibleCustomerIds.length,
        discoveredCustomerCount: discovery.customers.length,
      };
    } catch (error) {
      healthCheck = {
        error: error instanceof Error ? error.message : "Token tersimpan, tetapi health check gagal.",
      };
    }

    return c.json({
      ok: true,
      exchangedAt: storedToken.exchangedAt,
      refreshTokenSource: "kv",
      token: {
        refreshTokenAvailable: true,
        refreshTokenExpiresInSeconds: storedToken.refreshTokenExpiresInSeconds,
      },
      healthCheck,
    });
  } catch (error) {
    return c.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Google Ads exchange-code gagal.",
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

    const storedRefreshToken = await readStoredGoogleAdsRefreshToken();
    const configured = {
      developerToken: Boolean(GOOGLE_ADS_DEVELOPER_TOKEN),
      clientId: Boolean(GOOGLE_ADS_CLIENT_ID),
      clientSecret: Boolean(GOOGLE_ADS_CLIENT_SECRET),
      refreshToken: Boolean(storedRefreshToken?.refreshToken || GOOGLE_ADS_REFRESH_TOKEN),
      loginCustomerId: GOOGLE_ADS_LOGIN_CUSTOMER_ID || null,
      scopedCustomerIds: GOOGLE_ADS_CUSTOMER_IDS,
    };

    const token = await fetchGoogleAccessToken();
    const discovery = await discoverGoogleAdsCustomers(token.accessToken);
    const enabledDiscoveredCustomers = discovery.customers.filter(
      (customer) => !customer.isManager && isEnabledGoogleStatus(customer.status),
    );

    return c.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      apiVersion: GOOGLE_ADS_API_VERSION,
      configured,
      accessibleCustomerCount: discovery.directAccessibleCustomerIds.length,
      accessibleCustomerIds: discovery.directAccessibleCustomerIds,
      metadata: {
        source: "server",
        refreshTokenSource: token.refreshTokenSource,
        storedRefreshTokenExchangedAt: token.storedRefreshTokenExchangedAt,
        expiresInSeconds: token.expiresIn,
        discoveredCustomerCount: discovery.customers.length,
        enabledDiscoveredCustomerCount: enabledDiscoveredCustomers.length,
        managerHierarchyCount: discovery.managerHierarchyCount,
        discoveredCustomerIds: discovery.customers.map((customer) => customer.customerId),
      },
    });
  } catch (error) {
    const refreshTokenConfigured = await isGoogleAdsRefreshTokenConfigured().catch(() => Boolean(GOOGLE_ADS_REFRESH_TOKEN));
    return c.json(
      {
        ok: false,
        checkedAt: new Date().toISOString(),
        apiVersion: GOOGLE_ADS_API_VERSION,
        error: error instanceof Error ? error.message : "Google Ads token health gagal.",
        configured: {
          developerToken: Boolean(GOOGLE_ADS_DEVELOPER_TOKEN),
          clientId: Boolean(GOOGLE_ADS_CLIENT_ID),
          clientSecret: Boolean(GOOGLE_ADS_CLIENT_SECRET),
          refreshToken: refreshTokenConfigured,
          loginCustomerId: GOOGLE_ADS_LOGIN_CUSTOMER_ID || null,
          scopedCustomerIds: GOOGLE_ADS_CUSTOMER_IDS,
        },
        metadata: {
          source: "server",
        },
      },
      500,
    );
  }
});

app.get("/live-breakdown", async (c) => {
  try {
    const access = await requireAnyAdsPermission(c, ADS_VIEW_PERMISSIONS);
    if (!access.ok) return access.error;

    const from = c.req.query("from");
    const to = c.req.query("to");
    const requestedCustomerId = normalizeCustomerId(c.req.query("customerId"));
    const requestedManagerId = normalizeCustomerId(c.req.query("managerId"));

    if (!isValidDateParam(from) || !isValidDateParam(to)) {
      return c.json({ error: "Parameter from/to wajib format YYYY-MM-DD." }, 400);
    }

    const token = await fetchGoogleAccessToken();
    const discovery = await discoverGoogleAdsCustomers(token.accessToken);
    const scopedCustomers = (requestedCustomerId
      ? discovery.customers.filter((customer) => customer.customerId === requestedCustomerId)
      : discovery.customers
    ).filter((customer) =>
      requestedManagerId ? customer.managerCustomerId === requestedManagerId : true,
    );

    const accountSnapshots = (
      await Promise.all(
        scopedCustomers
          .filter((customer) => !customer.isManager && isEnabledGoogleStatus(customer.status))
          .map((customer) =>
            fetchCustomerSnapshot(token.accessToken, customer, from!, to!),
          ),
      )
    )
      .filter((account) =>
        requestedManagerId ? account.managerCustomerId === requestedManagerId : true,
      )
      .sort((left, right) => {
        if (right.spend !== left.spend) return right.spend - left.spend;
        return left.customerName.localeCompare(right.customerName);
      });

    const managerMap = new Map<
      string,
      {
        id: string;
        name: string;
        accountCount: number;
        spend: number;
        clicks: number;
        impressions: number;
        conversions: number;
      }
    >();

    for (const account of accountSnapshots) {
      const managerId = account.managerCustomerId || account.customerId;
      const managerName = account.managerCustomerName || account.customerName;
      const current = managerMap.get(managerId) || {
        id: managerId,
        name: managerName,
        accountCount: 0,
        spend: 0,
        clicks: 0,
        impressions: 0,
        conversions: 0,
      };

      current.accountCount += 1;
      current.spend += account.spend;
      current.clicks += account.clicks;
      current.impressions += account.impressions;
      current.conversions += account.conversions;
      managerMap.set(managerId, current);
    }

    const managers = Array.from(managerMap.values()).sort((left, right) => {
      if (right.spend !== left.spend) return right.spend - left.spend;
      return left.name.localeCompare(right.name);
    });

    const summary = accountSnapshots.reduce(
      (acc, account) => {
        acc.accountCount += 1;
        acc.managerCount = managers.length;
        acc.spend += account.spend;
        acc.clicks += account.clicks;
        acc.impressions += account.impressions;
        acc.conversions += account.conversions;
        return acc;
      },
      {
        managerCount: managers.length,
        accountCount: 0,
        spend: 0,
        clicks: 0,
        impressions: 0,
        conversions: 0,
      },
    );

    return c.json({
      source: "google-ads-live",
      generatedAt: new Date().toISOString(),
      requestedBy: access.requester.authUser.id,
      range: {
        from,
        to,
      },
      managers,
      accounts: accountSnapshots,
      summary,
      metadata: {
        apiVersion: GOOGLE_ADS_API_VERSION,
        loginCustomerId: GOOGLE_ADS_LOGIN_CUSTOMER_ID || null,
        accessibleCustomerCount: discovery.directAccessibleCustomerIds.length,
        discoveredCustomerCount: discovery.customers.length,
        managerHierarchyCount: discovery.managerHierarchyCount,
      },
    });
  } catch (error) {
    console.error("Google Ads live breakdown error:", error);
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Google Ads live breakdown gagal dimuat.",
      },
      500,
    );
  }
});

app.get("/snapshots", async (c) => {
  try {
    const access = await requireAnyAdsPermission(c, ADS_VIEW_PERMISSIONS);
    if (!access.ok) return access.error;

    const from = c.req.query("from");
    const to = c.req.query("to");
    const requestedCustomerId = normalizeCustomerId(c.req.query("customerId"));
    const requestedManagerId = normalizeCustomerId(c.req.query("managerId"));
    const includeLastKnown = parseBooleanFlag(c.req.query("includeLastKnown"), false);

    if (!isValidDateParam(from) || !isValidDateParam(to)) {
      return c.json({ error: "Parameter from/to wajib format YYYY-MM-DD." }, 400);
    }

    let rows = await fetchAdsDailySnapshots({
      platformKey: "google",
      from: from!,
      to: to!,
      externalAccountIds: requestedCustomerId ? [requestedCustomerId] : undefined,
      externalGroupId: requestedManagerId || null,
    });

    let servedFrom = "google-ads-snapshot-db";
    let fallbackSnapshotDate: string | null = null;

    if (rows.length === 0 && includeLastKnown) {
      let fallbackCustomerIds = requestedCustomerId ? [requestedCustomerId] : [];

      if (!requestedCustomerId) {
        try {
          const configs = await loadGoogleIntegrationConfigs();
          fallbackCustomerIds = configs
            .filter(
              (config) =>
                config.enabled &&
                config.liveGoogleCustomerId &&
                (!requestedManagerId || normalizeCustomerId(config.managerCustomerId || "") === requestedManagerId),
            )
            .map((config) => normalizeCustomerId(config.liveGoogleCustomerId || ""))
            .filter(Boolean);
        } catch (configError) {
          console.warn(
            "Google Ads snapshot config lookup failed; using latest stored snapshots without config filter.",
            configError instanceof Error ? configError.message : configError,
          );
        }
      }

      rows = await fetchLatestAdsDailySnapshotsBeforeOrOn({
        platformKey: "google",
        onOrBefore: to!,
        externalAccountIds: fallbackCustomerIds.length > 0 ? fallbackCustomerIds : undefined,
        externalGroupId: requestedManagerId || null,
      });
      servedFrom = rows.length > 0 ? "database-latest-known" : servedFrom;
      fallbackSnapshotDate = rows.length > 0 ? rows[0]?.snapshotDate || null : null;
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
            : "Gagal mengambil snapshot Google Ads dari database.",
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
    const from = typeof body?.from === "string" ? body.from : c.req.query("from");
    const to = typeof body?.to === "string" ? body.to : c.req.query("to");
    const requestedCustomerId = normalizeCustomerId(
      typeof body?.customerId === "string" ? body.customerId : c.req.query("customerId"),
    );
    const requestedManagerId = normalizeCustomerId(
      typeof body?.managerId === "string" ? body.managerId : c.req.query("managerId"),
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

    if (diffInDaysInclusive(from!, to!) > 730) {
      return c.json({ error: "Rentang sync maksimal 730 hari per request." }, 400);
    }

    const result = await syncGoogleAdsSnapshotRange({
      from: from!,
      to: to!,
      requestedCustomerId,
      requestedManagerId,
      force,
      minFreshMinutes,
    });

    let rows = result.rows;
    if (requestedCustomerId) {
      rows = rows.filter((row) => row.externalAccountId === requestedCustomerId);
    }
    if (requestedManagerId) {
      rows = rows.filter((row) => row.externalGroupId === requestedManagerId);
    }

    return c.json({
      source: "google-ads-snapshot-sync",
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
            : "Sinkronisasi snapshot Google Ads gagal.",
      },
      500,
    );
  }
});

app.get("/integration-configs", async (c) => {
  try {
    const access = await requireAnyAdsPermission(c, ADS_VIEW_PERMISSIONS);
    if (!access.ok) return access.error;

    const configs = await kv.getByPrefix("google_ads_integration_config:");
    return c.json({ configs });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Gagal mengambil config integrasi Google Ads.",
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
      managerCustomerId:
        typeof body?.managerCustomerId === "string" && body.managerCustomerId.trim()
          ? normalizeCustomerId(body.managerCustomerId)
          : undefined,
      managerCustomerName:
        typeof body?.managerCustomerName === "string" && body.managerCustomerName.trim()
          ? body.managerCustomerName.trim()
          : undefined,
      liveGoogleCustomerId:
        typeof body?.liveGoogleCustomerId === "string" && body.liveGoogleCustomerId.trim()
          ? normalizeCustomerId(body.liveGoogleCustomerId)
          : undefined,
      liveGoogleCustomerName:
        typeof body?.liveGoogleCustomerName === "string" && body.liveGoogleCustomerName.trim()
          ? body.liveGoogleCustomerName.trim()
          : undefined,
      updatedAt: new Date().toISOString(),
      updatedBy: access.requester.authUser.id,
    };

    await kv.set(`google_ads_integration_config:${adAccountId}`, config);
    return c.json({ success: true, config });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Gagal menyimpan config integrasi Google Ads.",
      },
      500,
    );
  }
});

export default app;
