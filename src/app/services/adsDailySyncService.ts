import { supabase } from '@/lib/supabaseClient';
import type {
  AdAccount,
  AdAccountAssignment,
  AdAccountOwnerAssignment,
  DailyAd,
  Platform,
  User,
} from '@/app/pages/master-data/data';
import {
  fetchAdsIntegrationConfigs,
  syncMetaSnapshotDataset,
  type AdsIntegrationConfig,
  type MetaSnapshotRow,
} from '@/app/services/liveAdsService';
import {
  fetchGoogleAdsIntegrationConfigs,
  syncGoogleAdsSnapshotDataset,
  type GoogleAdsIntegrationConfig,
  type GoogleAdsSnapshotRow,
} from '@/app/services/googleAdsLiveService';
import {
  fetchTikTokAdsIntegrationConfigs,
  syncTikTokAdsSnapshotDataset,
  type TikTokAdsIntegrationConfig,
  type TikTokAdsSnapshotRow,
} from '@/app/services/tiktokAdsLiveService';
import {
  fetchAdAccountApiMappings,
  type AdAccountApiMapping,
} from '@/app/services/adApiIntegrationService';
import { buildMakeServerUrl } from '@/app/services/internal/functionsBaseUrl';
import { fetchWithTimeout } from '@/app/services/internal/fetchWithTimeout';
import { getSessionBackedEdgeHeaders } from '@/app/services/internal/sessionClientHeaders';

export type AdsProviderKey = 'meta' | 'google' | 'tiktok';
export type AdsDailySyncMode = 'insert-missing' | 'update-existing';

export type AdsDailySyncProviderStatus = {
  key: AdsProviderKey;
  label: string;
  state: 'loading' | 'success' | 'empty' | 'error';
  count: number;
  message: string;
};

export type AdsDailySyncPreviewRow = {
  id: string;
  date: string;
  platformId: string;
  adAccountId: string;
  advertiserId: string;
  csId?: string;
  subChannelId?: string;
  amountSpent: number;
  leadsDashboard: number;
  ppnAmount: number;
  feeAmount: number;
  sourceLabel: string;
  accountName: string;
  advertiserName: string;
  status: 'new' | 'update' | 'skip' | 'unmapped';
  reason: string;
  existing?: DailyAd;
};

export type AdsDailySyncContext = {
  dailyAds: DailyAd[];
  platforms: Platform[];
  adAccounts: AdAccount[];
  adAccountAssignments: AdAccountAssignment[];
  adAccountOwnerAssignments: AdAccountOwnerAssignment[];
  users: User[];
};

export type AdsDailySyncFilters = {
  platformId?: string;
  advertiserId?: string;
  csId?: string;
  adAccountId?: string;
  mode?: AdsDailySyncMode;
  preserveEdited?: boolean;
  mappedOnly?: boolean;
};

export type AdsDailySyncPreviewResult = {
  rows: AdsDailySyncPreviewRow[];
  providerStatuses: AdsDailySyncProviderStatus[];
  errors: string[];
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  unmappedCount: number;
};

export type AdsDailySyncCommitResult = {
  inserted: number;
  updated: number;
};

export type AdsDailySyncRunKind = 'preview' | 'commit';

export type AdsDailySyncHistoryItem = {
  id: string;
  createdAt: string;
  kind: AdsDailySyncRunKind;
  actorId?: string;
  actorName?: string;
  actorRole?: string;
  range: { from: string; to: string };
  filters: {
    platformId?: string;
    advertiserId?: string;
    csId?: string;
    mode?: AdsDailySyncMode;
    preserveEdited?: boolean;
  };
  counts: {
    inserted: number;
    updated: number;
    newRows: number;
    updateRows: number;
    skippedRows: number;
    unmappedRows: number;
  };
  spend: number;
  providerStatuses: AdsDailySyncProviderStatus[];
  errors: string[];
};

export type RecordAdsDailySyncRunInput = Omit<AdsDailySyncHistoryItem, 'id' | 'createdAt'> & {
  id?: string;
  createdAt?: string;
};

export type AdsDailySyncRunResult = AdsDailySyncPreviewResult & {
  inserted: number;
  updated: number;
  actionableCount: number;
  busy?: boolean;
  message?: string;
};

type AdsSnapshotRow = MetaSnapshotRow | GoogleAdsSnapshotRow | TikTokAdsSnapshotRow;

type IntegrationConfigs = {
  meta: AdsIntegrationConfig[];
  google: GoogleAdsIntegrationConfig[];
  tiktok: TikTokAdsIntegrationConfig[];
  mappings: AdAccountApiMapping[];
};

type ProviderBuildResult = {
  rows: AdsDailySyncPreviewRow[];
  ignoredZeroActivityCount: number;
  ignoredInactiveAccountCount: number;
  diagnosticMessage?: string;
};

type DailyAdDbRow = {
  id: string;
  date: string;
  advertiser_id: string;
  platform_id: string;
  sub_channel_id?: string | null;
  ad_account_id: string;
  cs_id?: string | null;
  amount_spent?: number | string | null;
  leads_dashboard?: number | string | null;
  ppn_amount?: number | string | null;
  fee_amount?: number | string | null;
  edit_count?: number | string | null;
};

type AdsDailySyncRunDbRow = {
  id: string;
  created_at?: string | null;
  finished_at?: string | null;
  status?: string | null;
  run_kind?: string | null;
  actor_id?: string | null;
  actor_name?: string | null;
  actor_role?: string | null;
  range_from?: string | null;
  range_to?: string | null;
  platform_id?: string | null;
  advertiser_id?: string | null;
  cs_id?: string | null;
  mode?: string | null;
  preserve_edited?: boolean | null;
  inserted_count?: number | string | null;
  updated_count?: number | string | null;
  new_count?: number | string | null;
  update_count?: number | string | null;
  skipped_count?: number | string | null;
  unmapped_count?: number | string | null;
  spend?: number | string | null;
  provider_statuses?: unknown;
  errors?: unknown;
};

const providerLabels: Record<AdsProviderKey, string> = {
  meta: 'Meta',
  google: 'Google Ads',
  tiktok: 'TikTok Ads',
};

const defaultFilters: Required<Pick<AdsDailySyncFilters, 'mode' | 'preserveEdited' | 'mappedOnly'>> = {
  mode: 'update-existing',
  preserveEdited: true,
  mappedOnly: true,
};

const PROVIDER_PREVIEW_TIMEOUT_MS: Record<AdsProviderKey, number> = {
  meta: 100_000,
  google: 100_000,
  tiktok: 100_000,
};

const ADS_DAILY_SYNC_HISTORY_STORAGE_KEY = 'rhi.dailyAds.syncHistory.v1';
const ADS_DAILY_SYNC_HISTORY_LIMIT = 20;
export const ADS_DAILY_SYNC_HISTORY_UPDATED_EVENT = 'rhi:ads-sync-history-updated';

export type AdsDailySyncUpdateHistory = {
  recent: AdsDailySyncHistoryItem[];
  lastUpdate: AdsDailySyncHistoryItem | null;
  source: 'database' | 'local';
};

export const hasAdsSyncDataChanges = (item: AdsDailySyncHistoryItem) =>
  item.kind === 'commit' && (item.counts.inserted > 0 || item.counts.updated > 0);

export const formatAdsSyncHistoryTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return `${new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date)} WIB`;
};

export const getAdsSyncHistoryOutcome = (item: AdsDailySyncHistoryItem) => {
  const hasError = item.errors.length > 0 || item.providerStatuses.some((provider) => provider.state === 'error');
  if (item.kind === 'preview') return hasError ? 'Preview bermasalah' : 'Preview';
  if (hasError) return hasAdsSyncDataChanges(item) ? 'Tersimpan sebagian' : 'Sinkron bermasalah';
  if (hasAdsSyncDataChanges(item)) return 'Data tersimpan';
  if (item.providerStatuses.length === 0) return 'Tidak ada konektor';
  return 'Tanpa perubahan';
};

const createClientId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `sync-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const safeHistoryNumber = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const isAdsProviderKey = (value: unknown): value is AdsProviderKey =>
  value === 'meta' || value === 'google' || value === 'tiktok';

const isProviderStatusState = (value: unknown): value is AdsDailySyncProviderStatus['state'] =>
  value === 'loading' || value === 'success' || value === 'empty' || value === 'error';

const normalizeProviderStatusesFromDb = (value: unknown): AdsDailySyncProviderStatus[] => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): AdsDailySyncProviderStatus[] => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    if (!isAdsProviderKey(row.key)) return [];

    return [{
      key: row.key,
      label: typeof row.label === 'string' ? row.label : row.key,
      state: isProviderStatusState(row.state) ? row.state : 'empty',
      count: safeHistoryNumber(row.count),
      message: typeof row.message === 'string' ? row.message : '',
    }];
  });
};

const normalizeHistoryErrorsFromDb = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : [];

const normalizeHistoryModeFromDb = (value: unknown): AdsDailySyncMode | undefined =>
  value === 'insert-missing' || value === 'update-existing' ? value : undefined;

const mapSyncRunFromDbRow = (row: AdsDailySyncRunDbRow): AdsDailySyncHistoryItem => ({
  id: String(row.id),
  createdAt: row.finished_at || row.created_at || new Date().toISOString(),
  kind: row.run_kind === 'commit' ? 'commit' : 'preview',
  actorId: row.actor_id || undefined,
  actorName: row.actor_name || undefined,
  actorRole: row.actor_role || undefined,
  range: {
    from: row.range_from || '',
    to: row.range_to || row.range_from || '',
  },
  filters: {
    platformId: row.platform_id || undefined,
    advertiserId: row.advertiser_id || undefined,
    csId: row.cs_id || undefined,
    mode: normalizeHistoryModeFromDb(row.mode),
    preserveEdited: typeof row.preserve_edited === 'boolean' ? row.preserve_edited : undefined,
  },
  counts: {
    inserted: safeHistoryNumber(row.inserted_count),
    updated: safeHistoryNumber(row.updated_count),
    newRows: safeHistoryNumber(row.new_count),
    updateRows: safeHistoryNumber(row.update_count),
    skippedRows: safeHistoryNumber(row.skipped_count),
    unmappedRows: safeHistoryNumber(row.unmapped_count),
  },
  spend: safeHistoryNumber(row.spend),
  providerStatuses: normalizeProviderStatusesFromDb(row.provider_statuses),
  errors: normalizeHistoryErrorsFromDb(row.errors),
});

const readLocalSyncHistory = (): AdsDailySyncHistoryItem[] => {
  if (typeof window === 'undefined') return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(ADS_DAILY_SYNC_HISTORY_STORAGE_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed
          .filter((item): item is AdsDailySyncHistoryItem => Boolean(
            item?.id && item?.createdAt && item?.range && item?.counts &&
            Array.isArray(item?.providerStatuses) && Array.isArray(item?.errors),
          ))
          .slice(0, ADS_DAILY_SYNC_HISTORY_LIMIT)
      : [];
  } catch {
    return [];
  }
};

const writeLocalSyncHistory = (rows: AdsDailySyncHistoryItem[]) => {
  if (typeof window === 'undefined') return;

  try {
    const sortedRows = [...rows]
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, ADS_DAILY_SYNC_HISTORY_LIMIT);
    window.localStorage.setItem(ADS_DAILY_SYNC_HISTORY_STORAGE_KEY, JSON.stringify(sortedRows));
  } catch {
    // Local history is a resilience cache only; DB writes remain the source of truth.
  }
};

const upsertLocalSyncHistory = (item: AdsDailySyncHistoryItem) => {
  const rowsById = new Map(readLocalSyncHistory().map((row) => [row.id, row]));
  rowsById.set(item.id, item);
  writeLocalSyncHistory([...rowsById.values()]);
};

const buildSyncHistoryItem = (input: RecordAdsDailySyncRunInput): AdsDailySyncHistoryItem => ({
  id: input.id || createClientId(),
  createdAt: input.createdAt || new Date().toISOString(),
  kind: input.kind,
  actorId: input.actorId,
  actorName: input.actorName,
  actorRole: input.actorRole,
  range: input.range,
  filters: input.filters,
  counts: {
    inserted: safeHistoryNumber(input.counts.inserted),
    updated: safeHistoryNumber(input.counts.updated),
    newRows: safeHistoryNumber(input.counts.newRows),
    updateRows: safeHistoryNumber(input.counts.updateRows),
    skippedRows: safeHistoryNumber(input.counts.skippedRows),
    unmappedRows: safeHistoryNumber(input.counts.unmappedRows),
  },
  spend: safeHistoryNumber(input.spend),
  providerStatuses: input.providerStatuses,
  errors: input.errors,
});

const mapSyncHistoryItemToDbRow = (item: AdsDailySyncHistoryItem) => ({
  id: item.id,
  created_at: item.createdAt,
  run_kind: item.kind,
  actor_id: item.actorId || null,
  actor_name: item.actorName || null,
  actor_role: item.actorRole || null,
  range_from: item.range.from,
  range_to: item.range.to,
  platform_id: item.filters.platformId || null,
  advertiser_id: item.filters.advertiserId || null,
  cs_id: item.filters.csId || null,
  mode: item.filters.mode || null,
  preserve_edited: item.filters.preserveEdited ?? null,
  inserted_count: item.counts.inserted,
  updated_count: item.counts.updated,
  new_count: item.counts.newRows,
  update_count: item.counts.updateRows,
  skipped_count: item.counts.skippedRows,
  unmapped_count: item.counts.unmappedRows,
  spend: item.spend,
  provider_statuses: item.providerStatuses,
  errors: item.errors,
});

const normalizeLookupKey = (value: unknown) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^act_/, '')
    .replace(/\s+/g, ' ');

const normalizeExternalAccountId = (value: unknown) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^act_/, '')
    .replace(/[^a-z0-9]/g, '');

const normalizeFlexibleLookupKey = (value: unknown) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^act_/, '')
    .replace(/[^a-z0-9]+/g, '');

const buildFlexibleLookupKeys = (value: unknown) => {
  const rawValue = String(value || '');
  const keys = new Set<string>();
  const add = (candidate: string) => {
    const key = normalizeFlexibleLookupKey(candidate);
    if (key) keys.add(key);
  };

  add(rawValue);
  add(rawValue.replace(/\b(akun|account|ads?|iklan|meta|facebook|fb|tiktok|tik\s*tok|snack\s*video|google)\b/gi, ' '));
  add(rawValue.replace(/\b(cv|pt)\b/gi, ' '));
  add(rawValue.replace(/\s+\d+\s*$/g, ' '));
  add(rawValue.replace(/\b(cv|pt)\b/gi, ' ').replace(/\s+\d+\s*$/g, ' '));

  return [...keys];
};

const getTrailingNumberKey = (value: unknown) =>
  String(value || '').match(/(\d+)\s*$/)?.[1] || '';

const normalizeProviderName = (value: unknown) =>
  String(value || '').toLowerCase().replace(/\s+/g, '');

export const getAdsProviderKeyByPlatformName = (name: unknown): AdsProviderKey | null => {
  const normalized = normalizeProviderName(name);
  if (normalized.includes('google')) return 'google';
  if (normalized.includes('tiktok')) return 'tiktok';
  if (normalized.includes('meta') || normalized.includes('facebook') || normalized.includes('instagram')) return 'meta';
  return null;
};

const getDailyAdKey = (row: Pick<DailyAd, 'date' | 'adAccountId'>) =>
  `${row.date}|${row.adAccountId}`;

const mapDailyAdFromDbRow = (row: DailyAdDbRow): DailyAd => ({
  id: row.id,
  date: row.date,
  advertiserId: row.advertiser_id,
  platformId: row.platform_id,
  subChannelId: row.sub_channel_id || undefined,
  adAccountId: row.ad_account_id,
  csId: row.cs_id || undefined,
  amountSpent: Number(row.amount_spent) || 0,
  leadsDashboard: Number(row.leads_dashboard) || 0,
  ppnAmount: Number(row.ppn_amount) || 0,
  feeAmount: Number(row.fee_amount) || 0,
  editCount: Number(row.edit_count) || 0,
});

const mergeDailyAdsByBusinessKey = (left: DailyAd[], right: DailyAd[]) => {
  const rowsByKey = new Map<string, DailyAd>();
  [...left, ...right].forEach((row) => {
    if (!row.date || !row.adAccountId) return;
    rowsByKey.set(getDailyAdKey(row), row);
  });
  return [...rowsByKey.values()];
};

async function fetchDailyAdsForRange(range: { from: string; to: string }): Promise<DailyAd[]> {
  const rows: DailyAd[] = [];
  const pageSize = 1000;
  let page = 0;

  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('daily_ads')
      .select('*')
      .gte('date', range.from)
      .lte('date', range.to)
      .order('date', { ascending: false })
      .range(from, to);

    if (error) throw new Error(error.message);
    const pageRows = data || [];
    rows.push(...pageRows.map(mapDailyAdFromDbRow));
    if (pageRows.length < pageSize) break;
    page += 1;
  }

  return rows;
}

const getUserName = (users: User[], id?: string) =>
  users.find((user) => user.id === id)?.name || 'Tidak diketahui';

const resolveAssignmentForDate = (
  assignments: AdAccountAssignment[],
  adAccountId: string,
  date: string,
) => assignments
  .filter((assignment) =>
    assignment.adAccountId === adAccountId &&
    assignment.status === 'active' &&
    assignment.startDate <= date &&
    (!assignment.endDate || assignment.endDate >= date)
  )
  .sort((left, right) => right.startDate.localeCompare(left.startDate))[0];

const resolveOwnerForDate = (
  ownerAssignments: AdAccountOwnerAssignment[],
  adAccountId: string,
  date: string,
  fallbackAdvertiserId: string,
) => ownerAssignments
  .filter((assignment) =>
    assignment.adAccountId === adAccountId &&
    assignment.status === 'active' &&
    assignment.startDate <= date &&
    (!assignment.endDate || assignment.endDate >= date)
  )
  .sort((left, right) => right.startDate.localeCompare(left.startDate))[0]?.advertiserId || fallbackAdvertiserId;

const getErrorMessage = (provider: AdsProviderKey, reason: unknown) => {
  const rawMessage = reason instanceof Error ? reason.message : String(reason || 'Sinkronisasi API gagal.');
  if (provider === 'google' && /invalid_grant/i.test(rawMessage)) {
    return 'Token OAuth Google Ads ditolak. Reconnect Google Ads di Master Data Akun Iklan.';
  }
  return rawMessage;
};

const withProviderTimeout = async <T,>(provider: AdsProviderKey, request: Promise<T>): Promise<T> => {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(new Error(`${providerLabels[provider]} terlalu lama merespons. Coba refresh lagi atau cek koneksi API provider.`));
    }, PROVIDER_PREVIEW_TIMEOUT_MS[provider]);
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId) globalThis.clearTimeout(timeoutId);
  }
};

const isProviderTimeoutError = (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason || '');
  return /terlalu lama merespons/i.test(message);
};

const getEmptyMessage = (provider: AdsProviderKey, enabledConfigCount: number) => {
  if (enabledConfigCount === 0) {
    return `Belum ada akun ${providerLabels[provider]} aktif yang dipetakan ke Master Data Akun Iklan.`;
  }
  return `${enabledConfigCount} akun terpetakan, tetapi tidak ada snapshot pada periode/filter ini.`;
};

type ExternalAccountTarget = {
  accountId: string;
  accountName?: string;
  groupId?: string;
  groupName?: string;
};

const uniqueExternalAccountTargets = (values: ExternalAccountTarget[]) => {
  const seen = new Set<string>();
  const result: ExternalAccountTarget[] = [];

  values.forEach((value) => {
    const raw = String(value.accountId || '').trim();
    const key = normalizeExternalAccountId(raw);
    if (!raw || !key || seen.has(key)) return;
    seen.add(key);
    result.push({
      accountId: raw,
      accountName: value.accountName?.trim() || undefined,
      groupId: value.groupId?.trim() || undefined,
      groupName: value.groupName?.trim() || undefined,
    });
  });

  return result;
};

const getSnapshotMergeIdentity = (row: AdsSnapshotRow, index: number) => {
  const externalId = normalizeExternalAccountId(row.externalAccountId);
  if (externalId) return `external:${externalId}`;

  const internalId = String(row.internalAdAccountId || '').trim();
  if (internalId) return `internal:${internalId}`;

  const externalName = normalizeFlexibleLookupKey(row.externalAccountName);
  if (externalName) {
    const groupKey =
      normalizeExternalAccountId(row.externalGroupId) ||
      normalizeFlexibleLookupKey(row.externalGroupName) ||
      'no-group';
    return `name:${groupKey}:${externalName}`;
  }

  return `row:${String(row.id || index)}`;
};

const mergeSnapshotRowsByBusinessKey = (rows: AdsSnapshotRow[]) => {
  const merged = new Map<string, AdsSnapshotRow>();
  rows.forEach((row, index) => {
    const key = `${row.platformKey}|${row.snapshotDate}|${getSnapshotMergeIdentity(row, index)}`;
    if (!key) return;
    merged.set(key, row);
  });
  return [...merged.values()];
};

export async function loadAdsDailySyncIntegrationConfigs(): Promise<IntegrationConfigs> {
  const [meta, google, tiktok, mappings] = await Promise.allSettled([
    fetchAdsIntegrationConfigs(),
    fetchGoogleAdsIntegrationConfigs(),
    fetchTikTokAdsIntegrationConfigs(),
    fetchAdAccountApiMappings(),
  ]);

  return {
    meta: meta.status === 'fulfilled' ? meta.value : [],
    google: google.status === 'fulfilled' ? google.value : [],
    tiktok: tiktok.status === 'fulfilled' ? tiktok.value : [],
    mappings: mappings.status === 'fulfilled' ? mappings.value : [],
  };
}

export async function fetchRecentAdsDailySyncRuns(limit = 5): Promise<AdsDailySyncHistoryItem[]> {
  const localRows = readLocalSyncHistory().slice(0, limit);

  try {
    const { data, error } = await supabase
      .from('daily_ads_sync_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    const remoteRows = (data || []).map(mapSyncRunFromDbRow);
    if (remoteRows.length > 0) {
      writeLocalSyncHistory(remoteRows);
      return remoteRows;
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[adsDailySync] falling back to local sync history', error);
    }
  }

  return localRows;
}

export async function fetchAdsDailySyncUpdateHistory(): Promise<AdsDailySyncUpdateHistory> {
  try {
    // A completed no-op run still means the provider data was checked successfully.
    const [recent, lastUpdate] = await Promise.all([
      supabase.from('daily_ads_sync_runs').select('*')
        .order('created_at', { ascending: false }).limit(5),
      supabase.from('daily_ads_sync_runs').select('*')
        .eq('run_kind', 'commit').in('status', ['succeeded', 'partial'])
        .order('finished_at', { ascending: false }).limit(1),
    ]);
    if (recent.error) throw recent.error;
    if (lastUpdate.error) throw lastUpdate.error;
    const recentRows = (recent.data || []).map(mapSyncRunFromDbRow);
    const lastUpdateRow = lastUpdate.data?.[0] ? mapSyncRunFromDbRow(lastUpdate.data[0]) : null;
    writeLocalSyncHistory(lastUpdateRow ? [...recentRows.filter((row) => row.id !== lastUpdateRow.id), lastUpdateRow] : recentRows);
    return { recent: recentRows, lastUpdate: lastUpdateRow, source: 'database' };
  } catch {
    const localRows = readLocalSyncHistory();
    return {
      recent: localRows.slice(0, 5),
      lastUpdate: localRows.find(hasAdsSyncDataChanges) || null,
      source: 'local',
    };
  }
}

export async function recordAdsDailySyncRun(input: RecordAdsDailySyncRunInput): Promise<AdsDailySyncHistoryItem> {
  const item = buildSyncHistoryItem(input);
  upsertLocalSyncHistory(item);

  if (item.kind === 'preview') {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(ADS_DAILY_SYNC_HISTORY_UPDATED_EVENT));
    }
    return item;
  }

  try {
    const { data, error } = await supabase
      .from('daily_ads_sync_runs')
      .insert(mapSyncHistoryItemToDbRow(item))
      .select('*')
      .single();

    if (error) throw error;
    const savedItem = data ? mapSyncRunFromDbRow(data) : item;
    upsertLocalSyncHistory(savedItem);
    return savedItem;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[adsDailySync] sync history DB write skipped', error);
    }
    return item;
  } finally {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(ADS_DAILY_SYNC_HISTORY_UPDATED_EVENT));
    }
  }
}

const resolveAdAccountFromSnapshot = (
  snapshot: AdsSnapshotRow,
  candidateAdAccounts: AdAccount[],
  platforms: Platform[],
  configs: IntegrationConfigs,
) => {
  if (snapshot.internalAdAccountId) {
    const account = candidateAdAccounts.find((item) => item.id === snapshot.internalAdAccountId);
    if (account) return account;
  }

  const platformKey = snapshot.platformKey;
  const externalAccountId = normalizeExternalAccountId(snapshot.externalAccountId);
  const externalAccountName = normalizeLookupKey(snapshot.externalAccountName);
  const externalNameKeys = buildFlexibleLookupKeys(snapshot.externalAccountName);

  const activeMapping = configs.mappings.find((mapping) =>
    mapping.status === 'active' &&
    mapping.platformKey === platformKey &&
    normalizeExternalAccountId(mapping.externalAccountId) === externalAccountId
  );
  if (activeMapping) {
    const mappedAccount = candidateAdAccounts.find((item) => item.id === activeMapping.internalAdAccountId);
    if (mappedAccount) return mappedAccount;
  }

  const integrationAccountId =
    platformKey === 'meta'
      ? configs.meta.find((config) =>
          config.enabled && (
            normalizeExternalAccountId(config.liveMetaAccountId) === externalAccountId ||
            normalizeLookupKey(config.liveMetaAccountName) === externalAccountName ||
            buildFlexibleLookupKeys(config.liveMetaAccountName).some((key) => externalNameKeys.includes(key))
          )
        )?.adAccountId
      : platformKey === 'google'
        ? configs.google.find((config) =>
            config.enabled && (
              normalizeExternalAccountId(config.liveGoogleCustomerId) === externalAccountId ||
              normalizeLookupKey(config.liveGoogleCustomerName) === externalAccountName ||
              buildFlexibleLookupKeys(config.liveGoogleCustomerName).some((key) => externalNameKeys.includes(key))
            )
          )?.adAccountId
        : configs.tiktok.find((config) =>
            config.enabled && (
              normalizeExternalAccountId(config.liveTikTokAdvertiserId) === externalAccountId ||
              normalizeLookupKey(config.liveTikTokAdvertiserName) === externalAccountName ||
              buildFlexibleLookupKeys(config.liveTikTokAdvertiserName).some((key) => externalNameKeys.includes(key))
            )
          )?.adAccountId;

  if (integrationAccountId) {
    const account = candidateAdAccounts.find((item) => item.id === integrationAccountId);
    if (account) return account;
  }

  const platformCandidates = platforms
    .filter((platform) => getAdsProviderKeyByPlatformName(platform.name) === platformKey)
    .map((platform) => platform.id);
  const accountIdKey = normalizeLookupKey(snapshot.externalAccountId);
  const snapshotNumberKey = getTrailingNumberKey(snapshot.externalAccountName);
  const internalByUniqueNumber = new Map<string, AdAccount>();
  const duplicateNumberKeys = new Set<string>();

  for (const account of candidateAdAccounts.filter((item) => platformCandidates.includes(item.platformId))) {
    const numberKey = getTrailingNumberKey(account.accountName);
    if (!numberKey) continue;
    if (internalByUniqueNumber.has(numberKey)) {
      internalByUniqueNumber.delete(numberKey);
      duplicateNumberKeys.add(numberKey);
      continue;
    }
    if (!duplicateNumberKeys.has(numberKey)) {
      internalByUniqueNumber.set(numberKey, account);
    }
  }

  return candidateAdAccounts.find((account) => {
    if (!platformCandidates.includes(account.platformId)) return false;
    const internalNameKey = normalizeLookupKey(account.accountName);
    const internalFlexibleKeys = buildFlexibleLookupKeys(account.accountName);
    return (
      internalNameKey === externalAccountName ||
      internalNameKey === accountIdKey ||
      internalFlexibleKeys.some((key) => externalNameKeys.includes(key))
    );
  }) || (snapshotNumberKey ? internalByUniqueNumber.get(snapshotNumberKey) : undefined);
};

const buildPreviewRowsForProvider = ({
  snapshotRows,
  sourceLabel,
  context,
  configs,
  filters,
  range,
}: {
  snapshotRows: AdsSnapshotRow[];
  sourceLabel: string;
  context: AdsDailySyncContext;
  configs: IntegrationConfigs;
  filters: Required<Pick<AdsDailySyncFilters, 'mode' | 'preserveEdited' | 'mappedOnly'>> & AdsDailySyncFilters;
  range: { from: string; to: string };
}): ProviderBuildResult => {
  const existingByKey = new Map(context.dailyAds.map((row) => [getDailyAdKey(row), row]));
  const activeAccounts = context.adAccounts.filter((account) => account.status === 'active');
  const inactiveAccounts = context.adAccounts.filter((account) => account.status !== 'active');
  let ignoredZeroActivityCount = 0;
  let ignoredInactiveAccountCount = 0;

  const rows = snapshotRows.flatMap<AdsDailySyncPreviewRow>((snapshot) => {
    if (snapshot.snapshotDate < range.from || snapshot.snapshotDate > range.to) {
      return [];
    }

    const spend = Number(snapshot.spend) || 0;
    const leads = Math.round(Number(snapshot.conversions) || 0);
    if (spend <= 0 && leads <= 0) {
      ignoredZeroActivityCount += 1;
      return [];
    }

    const account = resolveAdAccountFromSnapshot(snapshot, activeAccounts, context.platforms, configs);
    if (!account) {
      const inactiveAccount = resolveAdAccountFromSnapshot(snapshot, inactiveAccounts, context.platforms, configs);
      if (inactiveAccount) {
        ignoredInactiveAccountCount += 1;
        return [];
      }
    }

    if (!account) {
      return [{
        id: `${sourceLabel}:${snapshot.snapshotDate}:${snapshot.externalAccountId}`,
        date: snapshot.snapshotDate,
        platformId: snapshot.platformId || '',
        adAccountId: snapshot.internalAdAccountId || '',
        advertiserId: snapshot.advertiserId || '',
        amountSpent: spend,
        leadsDashboard: leads,
        ppnAmount: 0,
        feeAmount: 0,
        sourceLabel,
        accountName: snapshot.externalAccountName,
        advertiserName: 'Belum dipetakan',
        status: 'unmapped',
        reason: 'Akun live belum dipasangkan ke akun internal.',
      }];
    }

    if (filters.platformId && filters.platformId !== 'all' && account.platformId !== filters.platformId) return [];
    if (filters.adAccountId && filters.adAccountId !== 'all' && account.id !== filters.adAccountId) return [];

    const advertiserId = resolveOwnerForDate(
      context.adAccountOwnerAssignments,
      account.id,
      snapshot.snapshotDate,
      account.advertiserId,
    );
    const assignment = resolveAssignmentForDate(
      context.adAccountAssignments,
      account.id,
      snapshot.snapshotDate,
    );

    if (filters.advertiserId && filters.advertiserId !== 'all' && advertiserId !== filters.advertiserId) return [];
    if (filters.csId && filters.csId !== 'all' && assignment?.csId !== filters.csId) return [];

    const existing = existingByKey.get(getDailyAdKey({ date: snapshot.snapshotDate, adAccountId: account.id }));
    const ppnAmount = Math.round(spend * ((account.ppn || 0) / 100));
    const feeAmount = Math.round(spend * ((account.fee || 0) / 100));
    let status: AdsDailySyncPreviewRow['status'] = existing ? 'skip' : 'new';
    let reason = existing ? 'Sudah ada di laporan harian.' : 'Siap ditambahkan.';

    if (existing && filters.mode === 'update-existing') {
      if (filters.preserveEdited && (existing.editCount || 0) > 0) {
        status = 'skip';
        reason = 'Data pernah dikoreksi manual, tidak ditimpa.';
      } else {
        status = 'update';
        reason = 'Akan update data operasional dari snapshot API.';
      }
    }

    return [{
      id: `${sourceLabel}:${snapshot.snapshotDate}:${snapshot.externalAccountId}`,
      date: snapshot.snapshotDate,
      platformId: account.platformId,
      adAccountId: account.id,
      advertiserId,
      csId: assignment?.csId || undefined,
      subChannelId: assignment?.subChannelId || undefined,
      amountSpent: spend,
      leadsDashboard: leads,
      ppnAmount,
      feeAmount,
      sourceLabel,
      accountName: account.accountName,
      advertiserName: getUserName(context.users, advertiserId),
      status,
      reason,
      existing,
    }];
  });

  return { rows, ignoredZeroActivityCount, ignoredInactiveAccountCount };
};

const buildExistingDailyAdPreviewRows = (
  dailyAds: DailyAd[],
  context: AdsDailySyncContext,
  filters: AdsDailySyncFilters,
): AdsDailySyncPreviewRow[] => {
  const accountById = new Map(context.adAccounts.map((account) => [account.id, account]));
  const userNameById = new Map(context.users.map((user) => [user.id, user.name]));
  const rowsByKey = new Map<string, DailyAd>();

  dailyAds.forEach((row) => {
    if (!row.date || !row.adAccountId) return;
    rowsByKey.set(getDailyAdKey(row), row);
  });

  return [...rowsByKey.values()]
    .filter((row) => {
      const account = accountById.get(row.adAccountId);
      if (!account || account.status !== 'active') return false;
      if (filters.platformId && filters.platformId !== 'all' && row.platformId !== filters.platformId) return false;
      if (filters.advertiserId && filters.advertiserId !== 'all' && row.advertiserId !== filters.advertiserId) return false;
      if (filters.csId && filters.csId !== 'all' && row.csId !== filters.csId) return false;
      if (filters.adAccountId && filters.adAccountId !== 'all' && row.adAccountId !== filters.adAccountId) return false;
      return true;
    })
    .map((row) => {
      const account = accountById.get(row.adAccountId);
      return {
        id: `daily_ads:${row.date}:${row.adAccountId}`,
        date: row.date,
        platformId: row.platformId,
        adAccountId: row.adAccountId,
        advertiserId: row.advertiserId,
        csId: row.csId || undefined,
        subChannelId: row.subChannelId || undefined,
        amountSpent: Number(row.amountSpent) || 0,
        leadsDashboard: Number(row.leadsDashboard) || 0,
        ppnAmount: Number(row.ppnAmount) || 0,
        feeAmount: Number(row.feeAmount) || 0,
        sourceLabel: 'Database',
        accountName: account?.accountName || 'Akun tidak ditemukan',
        advertiserName: userNameById.get(row.advertiserId) || 'Tidak diketahui',
        status: 'skip' as const,
        reason: 'Sudah tersimpan di Iklan Harian.',
        existing: row,
      };
    });
};

const getPreviewRowMergeKey = (row: AdsDailySyncPreviewRow) =>
  row.status === 'unmapped'
    ? row.id
    : getDailyAdKey(row);

export const reconcileAdsDailySyncPreviewRows = (
  rows: AdsDailySyncPreviewRow[],
  context: AdsDailySyncContext,
  filters: AdsDailySyncFilters,
) => {
  const mergedFilters = { ...defaultFilters, ...filters };
  const existingByKey = new Map(context.dailyAds.map((row) => [getDailyAdKey(row), row]));

  return rows.map((row) => {
    if (row.status === 'unmapped') return row;
    const existing = existingByKey.get(getDailyAdKey(row));

    if (mergedFilters.advertiserId && mergedFilters.advertiserId !== 'all' && row.advertiserId !== mergedFilters.advertiserId) {
      return { ...row, existing, status: 'skip' as const, reason: 'Di luar filter advertiser.' };
    }

    if (mergedFilters.csId && mergedFilters.csId !== 'all' && row.csId !== mergedFilters.csId) {
      return { ...row, existing, status: 'skip' as const, reason: 'Di luar filter CS.' };
    }

    if (mergedFilters.adAccountId && mergedFilters.adAccountId !== 'all' && row.adAccountId !== mergedFilters.adAccountId) {
      return { ...row, existing, status: 'skip' as const, reason: 'Di luar filter akun iklan.' };
    }

    if (!existing) {
      return { ...row, existing: undefined, status: 'new' as const, reason: 'Siap ditambahkan.' };
    }

    if (row.sourceLabel === 'Database') {
      return { ...row, existing, status: 'skip' as const, reason: 'Sudah tersimpan di Iklan Harian.' };
    }

    if (mergedFilters.mode === 'update-existing') {
      if (mergedFilters.preserveEdited && (existing.editCount || 0) > 0) {
        return { ...row, existing, status: 'skip' as const, reason: 'Data pernah dikoreksi manual, tidak ditimpa.' };
      }
      return { ...row, existing, status: 'update' as const, reason: 'Akan update data operasional dari snapshot API.' };
    }

    return { ...row, existing, status: 'skip' as const, reason: 'Sudah ada di laporan harian.' };
  });
};

export async function buildAdsDailySyncPreview({
  range,
  context,
  filters = {},
  onProviderStatus,
  onPreviewRows,
}: {
  range: { from: string; to: string };
  context: AdsDailySyncContext;
  filters?: AdsDailySyncFilters;
  onProviderStatus?: (statuses: AdsDailySyncProviderStatus[]) => void;
  onPreviewRows?: (rows: AdsDailySyncPreviewRow[]) => void;
}): Promise<AdsDailySyncPreviewResult> {
  const mergedFilters = { ...defaultFilters, ...filters };
  const currentDailyAds = await fetchDailyAdsForRange(range);
  const resolvedContext: AdsDailySyncContext = {
    ...context,
    dailyAds: mergeDailyAdsByBusinessKey(context.dailyAds, currentDailyAds),
  };
  const configs = await loadAdsDailySyncIntegrationConfigs();
  const existingPreviewRows = buildExistingDailyAdPreviewRows(currentDailyAds, resolvedContext, mergedFilters);
  const prepareRowsForDisplay = (apiRows: AdsDailySyncPreviewRow[]) => {
    const mergedRows = new Map<string, AdsDailySyncPreviewRow>();
    existingPreviewRows.forEach((row) => mergedRows.set(getPreviewRowMergeKey(row), row));
    apiRows.forEach((row) => mergedRows.set(getPreviewRowMergeKey(row), row));

    return reconcileAdsDailySyncPreviewRows(
      [...mergedRows.values()].sort((left, right) => left.date.localeCompare(right.date) || left.accountName.localeCompare(right.accountName)),
      resolvedContext,
      mergedFilters,
    );
  };

  if (existingPreviewRows.length > 0) {
    onPreviewRows?.(prepareRowsForDisplay([]));
  }

  const platformNameById = new Map(resolvedContext.platforms.map((platform) => [platform.id, platform.name]));
  const selectedProviderKey =
    mergedFilters.platformId && mergedFilters.platformId !== 'all'
      ? getAdsProviderKeyByPlatformName(platformNameById.get(mergedFilters.platformId))
      : null;
  const shouldLoadProvider = (provider: AdsProviderKey) =>
    !mergedFilters.platformId || mergedFilters.platformId === 'all' || selectedProviderKey === provider;
  const getActiveAdAccountIdsForProvider = (provider: AdsProviderKey) => new Set(
    resolvedContext.adAccounts
      .filter((account) => {
        if (account.status !== 'active') return false;
        if (getAdsProviderKeyByPlatformName(platformNameById.get(account.platformId)) !== provider) return false;
        if (mergedFilters.platformId && mergedFilters.platformId !== 'all' && account.platformId !== mergedFilters.platformId) return false;
        if (mergedFilters.adAccountId && mergedFilters.adAccountId !== 'all' && account.id !== mergedFilters.adAccountId) return false;
        return true;
      })
      .map((account) => account.id),
  );
  const activeAccountById = new Map(
    resolvedContext.adAccounts
      .filter((account) => account.status === 'active')
      .map((account) => [account.id, account]),
  );
  const getConfiguredExternalAccountTargets = (provider: AdsProviderKey) => {
    const activeAccountIds = getActiveAdAccountIdsForProvider(provider);
    const mappedTargets = configs.mappings
      .filter((mapping) =>
        mapping.status === 'active' &&
        mapping.platformKey === provider &&
        activeAccountIds.has(mapping.internalAdAccountId)
      )
      .map((mapping) => ({
        accountId: mapping.externalAccountId,
        accountName: activeAccountById.get(mapping.internalAdAccountId)?.accountName,
      }));

    if (provider === 'meta') {
      return uniqueExternalAccountTargets([
        ...configs.meta
          .filter((config) => config.enabled && config.liveMetaAccountId && activeAccountIds.has(config.adAccountId))
          .map((config) => ({
            accountId: config.liveMetaAccountId || '',
            accountName: config.liveMetaAccountName || activeAccountById.get(config.adAccountId)?.accountName,
            groupId: config.businessManagerId,
            groupName: config.businessManagerName,
          })),
        ...mappedTargets,
      ]);
    }

    if (provider === 'google') {
      return uniqueExternalAccountTargets([
        ...configs.google
          .filter((config) => config.enabled && config.liveGoogleCustomerId && activeAccountIds.has(config.adAccountId))
          .map((config) => ({
            accountId: config.liveGoogleCustomerId || '',
            accountName: config.liveGoogleCustomerName || activeAccountById.get(config.adAccountId)?.accountName,
            groupId: config.managerCustomerId,
            groupName: config.managerCustomerName,
          })),
        ...mappedTargets,
      ]);
    }

    return uniqueExternalAccountTargets([
      ...configs.tiktok
        .filter((config) => config.enabled && config.liveTikTokAdvertiserId && activeAccountIds.has(config.adAccountId))
        .map((config) => ({
          accountId: config.liveTikTokAdvertiserId || '',
          accountName: config.liveTikTokAdvertiserName || activeAccountById.get(config.adAccountId)?.accountName,
          groupId: config.businessCenterId,
          groupName: config.businessCenterName,
        })),
      ...mappedTargets,
    ]);
  };
  const tasks: Array<{
    key: AdsProviderKey;
    label: string;
    enabledConfigCount: number;
    request: Promise<ProviderBuildResult>;
  }> = [];

  if (shouldLoadProvider('meta')) {
    const metaTargets = getConfiguredExternalAccountTargets('meta');
    const buildMetaResult = async () => {
      let fulfilledRows: AdsSnapshotRow[] = [];
      const diagnostics: string[] = [];
      const rejectedMessages: string[] = [];

      try {
        const broadPayload = await syncMetaSnapshotDataset({
          from: range.from,
          to: range.to,
          force: true,
          minFreshMinutes: 0,
          mappedOnly: false,
        });
        fulfilledRows = broadPayload.rows || [];

        const servedFrom = broadPayload.metadata?.servedFrom;
        if (servedFrom && servedFrom !== 'meta-live') {
          diagnostics.push(`Meta memakai ${servedFrom}, bukan live penuh.`);
        }
      } catch (error) {
        rejectedMessages.push(error instanceof Error ? error.message : String(error || 'Meta sync broad gagal.'));
      }

      if (fulfilledRows.length === 0 && metaTargets.length > 0) {
        const metaRequests = metaTargets.map((target) => syncMetaSnapshotDataset({
          from: range.from,
          to: range.to,
          accountId: target.accountId,
          accountName: target.accountName,
          force: true,
          minFreshMinutes: 0,
          mappedOnly: false,
        }));
        const results = await Promise.allSettled(metaRequests);
        fulfilledRows = results.flatMap((result) =>
          result.status === 'fulfilled' ? result.value.rows || [] : [],
        );
        rejectedMessages.push(
          ...results
            .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
            .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason || 'Meta sync per akun gagal.')),
        );

        if (fulfilledRows.length > 0) {
          diagnostics.push(`${metaTargets.length} akun Meta aktif diminta per akun setelah broad live kosong.`);
        }
      }

      if (fulfilledRows.length === 0 && rejectedMessages.length > 0) {
        throw new Error(rejectedMessages[0]);
      }

      const buildResult = buildPreviewRowsForProvider({
        snapshotRows: mergeSnapshotRowsByBusinessKey(fulfilledRows),
        sourceLabel: providerLabels.meta,
        context: resolvedContext,
        configs,
        filters: mergedFilters,
        range,
      });

      if (metaTargets.length > 0 && fulfilledRows.length === 0) {
        diagnostics.push(`${metaTargets.length} akun Meta aktif sudah dicek, tetapi API mengembalikan 0 row untuk periode ini.`);
      }
      if (rejectedMessages.length > 0) {
        diagnostics.push(`${rejectedMessages.length} request Meta gagal: ${rejectedMessages.slice(0, 2).join(' ')}`);
      }

      return {
        ...buildResult,
        diagnosticMessage: diagnostics.join(' ') || undefined,
      };
    };

    tasks.push({
      key: 'meta',
      label: providerLabels.meta,
      enabledConfigCount: metaTargets.length,
      request: buildMetaResult(),
    });
  }

  if (shouldLoadProvider('google')) {
    const googleTargets = getConfiguredExternalAccountTargets('google');
    const googleRequests = googleTargets.length > 0
      ? googleTargets.map((target) => syncGoogleAdsSnapshotDataset({
          from: range.from,
          to: range.to,
          managerId: target.groupId,
          customerId: target.accountId,
          force: true,
          minFreshMinutes: 0,
        }))
      : [syncGoogleAdsSnapshotDataset({
          from: range.from,
          to: range.to,
          force: true,
          minFreshMinutes: 0,
        })];

    tasks.push({
      key: 'google',
      label: providerLabels.google,
      enabledConfigCount: googleTargets.length,
      request: Promise.allSettled(googleRequests).then(async (results) => {
        const requestedCount = googleTargets.length;
        let fulfilledRows = results.flatMap((result) =>
          result.status === 'fulfilled' ? result.value.rows || [] : [],
        );
        const rejectedMessages = results
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason || 'Google Ads sync gagal.'));

        let usedBroadFallback = false;
        let broadFallbackMessage = '';
        if (requestedCount > 0 && fulfilledRows.length === 0) {
          try {
            const fallbackPayload = await syncGoogleAdsSnapshotDataset({
              from: range.from,
              to: range.to,
              force: true,
              minFreshMinutes: 0,
            });
            const fallbackRows = fallbackPayload.rows || [];
            if (fallbackRows.length > 0) {
              fulfilledRows = fallbackRows;
              usedBroadFallback = true;
            } else {
              broadFallbackMessage = 'Fallback semua akun Google Ads juga mengembalikan 0 row.';
            }
          } catch (error) {
            const fallbackError = error instanceof Error ? error.message : String(error || 'Fallback semua akun Google Ads gagal.');
            broadFallbackMessage = `Fallback semua akun Google Ads gagal: ${fallbackError}`;
          }
        }

        if (
          fulfilledRows.length === 0 &&
          rejectedMessages.length === results.length &&
          rejectedMessages.length > 0 &&
          !broadFallbackMessage
        ) {
          throw new Error(rejectedMessages[0]);
        }

        const buildResult = buildPreviewRowsForProvider({
          snapshotRows: mergeSnapshotRowsByBusinessKey(fulfilledRows),
          sourceLabel: providerLabels.google,
          context: resolvedContext,
          configs,
          filters: mergedFilters,
          range,
        });

        const diagnostics: string[] = [];
        if (usedBroadFallback) {
          diagnostics.push(`${requestedCount} akun Google Ads aktif diminta per akun, lalu fallback semua akun Google Ads dipakai.`);
        } else if (requestedCount > 0 && fulfilledRows.length === 0) {
          diagnostics.push(`${requestedCount} akun Google Ads aktif sudah diminta, tetapi API mengembalikan 0 row untuk periode ini.`);
        }
        if (broadFallbackMessage) {
          diagnostics.push(broadFallbackMessage);
        }
        if (rejectedMessages.length > 0) {
          diagnostics.push(`${rejectedMessages.length} akun gagal: ${rejectedMessages.slice(0, 2).join(' ')}`);
        }

        return {
          ...buildResult,
          diagnosticMessage: diagnostics.join(' ') || undefined,
        };
      }),
    });
  }

  if (shouldLoadProvider('tiktok')) {
    const tiktokTargets = getConfiguredExternalAccountTargets('tiktok');
    const tiktokRequests = tiktokTargets.length > 0
      ? tiktokTargets.map((target) => syncTikTokAdsSnapshotDataset({
          from: range.from,
          to: range.to,
          businessCenterId: target.groupId,
          advertiserId: target.accountId,
          force: true,
          minFreshMinutes: 0,
        }))
      : [syncTikTokAdsSnapshotDataset({
          from: range.from,
          to: range.to,
          force: true,
          minFreshMinutes: 0,
        })];

    tasks.push({
      key: 'tiktok',
      label: providerLabels.tiktok,
      enabledConfigCount: tiktokTargets.length,
      request: Promise.allSettled(tiktokRequests).then(async (results) => {
        const requestedCount = tiktokTargets.length;
        let fulfilledRows = results.flatMap((result) =>
          result.status === 'fulfilled' ? result.value.rows || [] : [],
        );
        const rejectedMessages = results
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason || 'TikTok Ads sync gagal.'));

        let usedBroadFallback = false;
        let broadFallbackMessage = '';
        if (requestedCount > 0 && fulfilledRows.length === 0) {
          try {
            const fallbackPayload = await syncTikTokAdsSnapshotDataset({
              from: range.from,
              to: range.to,
              force: true,
              minFreshMinutes: 0,
            });
            const fallbackRows = fallbackPayload.rows || [];
            if (fallbackRows.length > 0) {
              fulfilledRows = fallbackRows;
              usedBroadFallback = true;
            } else {
              broadFallbackMessage = 'Fallback semua akun TikTok Ads juga mengembalikan 0 row.';
            }
          } catch (error) {
            const fallbackError = error instanceof Error ? error.message : String(error || 'Fallback semua akun TikTok Ads gagal.');
            broadFallbackMessage = `Fallback semua akun TikTok Ads gagal: ${fallbackError}`;
          }
        }

        if (
          fulfilledRows.length === 0 &&
          rejectedMessages.length === results.length &&
          rejectedMessages.length > 0 &&
          !broadFallbackMessage
        ) {
          throw new Error(rejectedMessages[0]);
        }

        const buildResult = buildPreviewRowsForProvider({
          snapshotRows: mergeSnapshotRowsByBusinessKey(fulfilledRows),
          sourceLabel: providerLabels.tiktok,
          context: resolvedContext,
          configs,
          filters: mergedFilters,
          range,
        });

        const diagnostics: string[] = [];
        if (usedBroadFallback) {
          diagnostics.push(`${requestedCount} akun TikTok Ads aktif diminta per akun, lalu fallback semua akun TikTok Ads dipakai.`);
        } else if (requestedCount > 0 && fulfilledRows.length === 0) {
          diagnostics.push(`${requestedCount} akun TikTok Ads aktif sudah diminta, tetapi API mengembalikan 0 row untuk periode ini.`);
        }
        if (broadFallbackMessage) {
          diagnostics.push(broadFallbackMessage);
        }
        if (rejectedMessages.length > 0) {
          diagnostics.push(`${rejectedMessages.length} akun gagal: ${rejectedMessages.slice(0, 2).join(' ')}`);
        }

        return {
          ...buildResult,
          diagnosticMessage: diagnostics.join(' ') || undefined,
        };
      }),
    });
  }

  if (tasks.length === 0) {
    const fallbackRows = prepareRowsForDisplay([]);
    onPreviewRows?.(fallbackRows);
    return {
      rows: fallbackRows,
      providerStatuses: [],
      errors: [],
      insertedCount: fallbackRows.filter((row) => row.status === 'new').length,
      updatedCount: fallbackRows.filter((row) => row.status === 'update').length,
      skippedCount: fallbackRows.filter((row) => row.status === 'skip').length,
      unmappedCount: fallbackRows.filter((row) => row.status === 'unmapped').length,
    };
  }

  const statuses: AdsDailySyncProviderStatus[] = tasks.map((task) => ({
    key: task.key,
    label: task.label,
    state: 'loading',
    count: 0,
    message: 'Mengambil snapshot provider...',
  }));
  onProviderStatus?.([...statuses]);

  const rows: AdsDailySyncPreviewRow[] = [];
  const errors: string[] = [];
  const setStatus = (nextStatus: AdsDailySyncProviderStatus) => {
    const index = statuses.findIndex((status) => status.key === nextStatus.key);
    if (index >= 0) statuses[index] = nextStatus;
    onProviderStatus?.([...statuses]);
  };

  await Promise.allSettled(tasks.map(async (task) => {
    try {
      const buildResult = await withProviderTimeout(task.key, task.request);
      rows.push(...buildResult.rows);
      if (rows.length > 0 || existingPreviewRows.length > 0) {
        onPreviewRows?.(prepareRowsForDisplay(rows));
      }
      const ignoredMessage = buildResult.ignoredZeroActivityCount > 0
        ? ` ${buildResult.ignoredZeroActivityCount} snapshot kosong dilewati.`
        : '';
      const inactiveMessage = buildResult.ignoredInactiveAccountCount > 0
        ? ` ${buildResult.ignoredInactiveAccountCount} akun OFF dilewati.`
        : '';

      setStatus({
        key: task.key,
        label: task.label,
        state: buildResult.rows.length > 0 ? 'success' : 'empty',
        count: buildResult.rows.length,
        message: buildResult.rows.length > 0
          ? `${buildResult.rows.length} snapshot terbaca.${ignoredMessage}${inactiveMessage}${buildResult.diagnosticMessage ? ` ${buildResult.diagnosticMessage}` : ''}`
          : `${buildResult.diagnosticMessage || getEmptyMessage(task.key, task.enabledConfigCount)}${ignoredMessage}${inactiveMessage}`,
      });
    } catch (reason) {
      const message = getErrorMessage(task.key, reason);
      const isTimeout = isProviderTimeoutError(reason);
      if (!isTimeout) {
        errors.push(`${task.label}: ${message}`);
      }
      setStatus({
        key: task.key,
        label: task.label,
        state: isTimeout ? 'empty' : 'error',
        count: 0,
        message: isTimeout
          ? `${task.label} belum selesai. Provider dilewati sementara supaya preview lain tetap tampil.`
          : message,
      });
    }
  }));

  const sortedRows = prepareRowsForDisplay(rows);
  onPreviewRows?.(sortedRows);

  return {
    rows: sortedRows,
    providerStatuses: [...statuses],
    errors,
    insertedCount: sortedRows.filter((row) => row.status === 'new').length,
    updatedCount: sortedRows.filter((row) => row.status === 'update').length,
    skippedCount: sortedRows.filter((row) => row.status === 'skip').length,
    unmappedCount: sortedRows.filter((row) => row.status === 'unmapped').length,
  };
}

const mapPreviewRowToDailyAdPayload = (row: AdsDailySyncPreviewRow) => ({
  id: row.existing?.id || crypto.randomUUID(),
  date: row.date,
  advertiser_id: row.advertiserId,
  platform_id: row.platformId,
  sub_channel_id: row.subChannelId || null,
  ad_account_id: row.adAccountId,
  cs_id: row.csId || null,
  amount_spent: row.amountSpent,
  leads_dashboard: row.leadsDashboard,
  ppn_amount: row.ppnAmount,
  fee_amount: row.feeAmount,
  edit_count: row.existing?.editCount || 0,
});

const withoutEditCount = (payload: ReturnType<typeof mapPreviewRowToDailyAdPayload>) => {
  const { edit_count: _editCount, ...safePayload } = payload;
  return safePayload;
};

const getDatabaseErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const parts = ['message', 'details', 'hint', 'code']
      .map((key) => (error as Record<string, unknown>)[key])
      .filter(Boolean)
      .map(String);
    if (parts.length > 0) return parts.join(' ');
  }
  return String(error || '');
};

const isMissingEditCountError = (error: unknown) => {
  const message = getDatabaseErrorMessage(error);
  return /edit_count/i.test(message) && /schema cache|column|could not find|does not exist/i.test(message);
};

async function findExistingDailyAdByBusinessKey(row: Pick<AdsDailySyncPreviewRow, 'date' | 'adAccountId'>) {
  const { data, error } = await supabase
    .from('daily_ads')
    .select('*')
    .eq('date', row.date)
    .eq('ad_account_id', row.adAccountId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw new Error(error.message);
  const [existing] = data || [];
  return existing ? mapDailyAdFromDbRow(existing) : undefined;
}

async function updateDailyAdFromPreview(row: AdsDailySyncPreviewRow, existing: DailyAd) {
  const payload = mapPreviewRowToDailyAdPayload({ ...row, existing });
  const { error } = await supabase
    .from('daily_ads')
    .update(payload)
    .eq('id', existing.id);

  if (!error) return;
  if (!isMissingEditCountError(error)) throw new Error(error.message);

  const fallback = await supabase
    .from('daily_ads')
    .update(withoutEditCount(payload))
    .eq('id', existing.id);

  if (fallback.error) throw new Error(fallback.error.message);
}

async function insertDailyAdFromPreview(row: AdsDailySyncPreviewRow) {
  const payload = mapPreviewRowToDailyAdPayload(row);
  const { error } = await supabase
    .from('daily_ads')
    .insert(payload);

  if (!error) return;
  if (!isMissingEditCountError(error)) throw new Error(error.message);

  const fallback = await supabase
    .from('daily_ads')
    .insert(withoutEditCount(payload));

  if (fallback.error) throw new Error(fallback.error.message);
}

export async function commitAdsDailySyncPreview(rows: AdsDailySyncPreviewRow[]): Promise<AdsDailySyncCommitResult> {
  const actionableRows = rows.filter((row) => row.status === 'new' || row.status === 'update');
  let inserted = 0;
  let updated = 0;

  for (const row of actionableRows) {
    const currentExisting = row.existing || await findExistingDailyAdByBusinessKey(row);

    if (currentExisting && (currentExisting.editCount || 0) > 0) {
      continue;
    }

    if (currentExisting) {
      await updateDailyAdFromPreview(row, currentExisting);
      updated += 1;
    } else {
      try {
        await insertDailyAdFromPreview(row);
        inserted += 1;
      } catch (error) {
        const freshExisting = await findExistingDailyAdByBusinessKey(row);
        if (!freshExisting) throw error;
        if ((freshExisting.editCount || 0) > 0) continue;
        await updateDailyAdFromPreview(row, freshExisting);
        updated += 1;
      }
    }
  }

  return { inserted, updated };
}

export async function syncAdsApiToDailyAds({
  range,
  filters = {},
  forceProviders = true,
}: {
  range: { from: string; to: string };
  context: AdsDailySyncContext;
  filters?: AdsDailySyncFilters;
  onProviderStatus?: (statuses: AdsDailySyncProviderStatus[]) => void;
  actor?: Pick<User, 'id' | 'name' | 'role'>;
  forceProviders?: boolean;
}): Promise<AdsDailySyncRunResult> {
  const response = await fetchWithTimeout(
    buildMakeServerUrl('/ads/sync-run'),
    {
      method: 'POST',
      headers: await getSessionBackedEdgeHeaders({ includeJsonContentType: true }),
      body: JSON.stringify({
        from: range.from,
        to: range.to,
        filters: { ...defaultFilters, ...filters },
        forceProviders,
      }),
    },
    180_000,
    'Sinkronisasi iklan masih berlangsung terlalu lama. Periksa status pembaruan beberapa saat lagi.',
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Gagal menjalankan sinkronisasi iklan di backend.');
  }

  const providerStatuses = Array.isArray(payload.providerStatuses) ? payload.providerStatuses : [];
  const errors = Array.isArray(payload.errors) ? payload.errors.map(String) : [];
  const inserted = Number(payload.counts?.inserted) || 0;
  const updated = Number(payload.counts?.updated) || 0;
  window.dispatchEvent(new Event(ADS_DAILY_SYNC_HISTORY_UPDATED_EVENT));

  return {
    rows: [],
    providerStatuses,
    errors,
    insertedCount: inserted,
    updatedCount: updated,
    skippedCount: Number(payload.counts?.skipped) || 0,
    unmappedCount: Number(payload.counts?.unmapped) || 0,
    inserted,
    updated,
    actionableCount: inserted + updated,
    busy: Boolean(payload.busy),
    message: typeof payload.message === 'string' ? payload.message : undefined,
  };
}
