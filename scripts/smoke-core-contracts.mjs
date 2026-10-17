import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ARTIFACT_DIR = path.join(process.cwd(), 'File Review', 'artifacts');
const OUTPUT_PATH = path.join(ARTIFACT_DIR, 'core-contracts-smoke.json');
const PROJECT_ROOT = process.cwd();

function ensureArtifactDir() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

function resolveWithKnownExtensions(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.mjs`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
    path.join(basePath, 'index.js'),
  ];

  const match = candidates.find((candidate) => fs.existsSync(candidate));
  if (!match) {
    throw new Error(`Unable to resolve aliased import: ${basePath}`);
  }

  return match;
}

const localAliasPlugin = {
  name: 'local-alias',
  setup(bundle) {
    bundle.onResolve({ filter: /^@\// }, (args) => ({
      path: resolveWithKnownExtensions(path.join(PROJECT_ROOT, 'src', args.path.slice(2))),
    }));
    bundle.onResolve({ filter: /^\/utils\// }, (args) => ({
      path: resolveWithKnownExtensions(path.join(PROJECT_ROOT, args.path.slice(1))),
    }));
  },
};

const entry = String.raw`
import assert from 'node:assert/strict';
import {
  buildActiveScheduleConflictMap,
  getOrderProspectBookingScheduleConflicts,
  getOrderScheduleConflicts,
  getProspectBookingScheduleConflicts,
  getScheduleConflictItemKey,
  getScheduleSlotConflictKey,
  shouldValidateOrderScheduleOnSave,
  shouldValidateProspectBookingScheduleOnSave,
} from './src/app/services/orderScheduleValidation.ts';
import {
  buildOrderFormPatch,
  normalizeCustomerPhone,
} from './src/app/pages/orders/orderFormModel.ts';
import {
  buildActiveBookingByLeadId,
  buildLatestBookingByLeadId,
  getLeadNotesPreview,
  isAutoWhatsAppLead,
  uniqueById,
} from './src/app/pages/leads/prospectModel.ts';
import {
  getAdsProviderKeyByPlatformName,
  reconcileAdsDailySyncPreviewRows,
  fetchAdsDailySyncUpdateHistory,
  formatAdsSyncHistoryTime,
  getAdsSyncHistoryOutcome,
  hasAdsSyncDataChanges,
} from './src/app/services/adsDailySyncService.ts';

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

const baseOrder = (overrides = {}) => ({
  id: 'ord-1',
  leadDate: '2026-10-01',
  customerName: 'Customer A',
  customerPhone: '081234567890',
  address: 'Jl Test',
  serviceDate: '2026-10-08',
  serviceTime: '09:00',
  serviceId: 'svc-1',
  serviceCategory: 'Restoration',
  vehicleId: 'veh-1',
  units: 1,
  price: 350000,
  platformId: 'platform-meta',
  csId: 'cs-1',
  advertiserId: 'adv-1',
  technicianId: 'tech-1',
  branchId: 'branch-1',
  status: 'pending',
  paymentStatus: 'Unpaid',
  paymentValidation: 'Pending',
  ...overrides,
});

const baseBooking = (overrides = {}) => ({
  id: 'booking-1',
  leadId: 'lead-1',
  customerName: 'Prospect A',
  customerPhone: '081234567891',
  scheduleDate: '2026-10-08',
  scheduleTime: '09:00',
  branchId: 'branch-1',
  status: 'tentative',
  technicianId: 'tech-1',
  platformId: 'platform-meta',
  csId: 'cs-1',
  advertiserId: 'adv-1',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

const baseDailyAd = (overrides = {}) => ({
  id: 'daily-1',
  date: '2026-10-08',
  advertiserId: 'adv-1',
  platformId: 'platform-meta',
  adAccountId: 'account-1',
  csId: 'cs-1',
  subChannelId: 'sub-1',
  amountSpent: 100000,
  leadsDashboard: 10,
  ppnAmount: 0,
  feeAmount: 0,
  editCount: 0,
  ...overrides,
});

const basePreviewRow = (overrides = {}) => ({
  id: 'preview-1',
  date: '2026-10-08',
  advertiserId: 'adv-1',
  platformId: 'platform-meta',
  adAccountId: 'account-1',
  csId: 'cs-1',
  subChannelId: 'sub-1',
  amountSpent: 120000,
  leadsDashboard: 12,
  ppnAmount: 0,
  feeAmount: 0,
  sourceLabel: 'Meta',
  accountName: 'Rahmansa 9',
  advertiserName: 'Advertiser A',
  status: 'new',
  reason: '',
  ...overrides,
});

test('order schedule conflict map catches active order and booking in same slot', () => {
  const conflictMap = buildActiveScheduleConflictMap(
    [baseOrder()],
    [
      baseBooking(),
      baseBooking({ id: 'booking-cancelled', leadId: 'lead-x', status: 'cancelled' }),
      baseBooking({ id: 'booking-linked', leadId: 'lead-y', orderId: 'ord-linked' }),
    ],
  );

  assert.equal(conflictMap.size, 2);
  assert.ok(conflictMap.has(getScheduleConflictItemKey('order', 'ord-1')));
  assert.ok(conflictMap.has(getScheduleConflictItemKey('booking', 'booking-1')));
});

test('order to booking conversion ignores same lead booking but catches other lead', () => {
  const target = baseOrder({ id: 'ord-new', leadId: 'lead-1' });
  const conflicts = getOrderProspectBookingScheduleConflicts(target, [
    baseBooking({ id: 'same-lead-booking', leadId: 'lead-1' }),
    baseBooking({ id: 'other-lead-booking', leadId: 'lead-2' }),
  ]);

  assert.deepEqual(conflicts.map((item) => item.id), ['other-lead-booking']);
});

test('order schedule conflict separates active and inactive orders', () => {
  const result = getOrderScheduleConflicts(
    baseOrder({ id: 'ord-target' }),
    [
      baseOrder({ id: 'ord-active', customerName: 'Active' }),
      baseOrder({ id: 'ord-cancelled', customerName: 'Cancelled', status: 'cancelled' }),
    ],
  );

  assert.deepEqual(result.activeConflicts.map((item) => item.id), ['ord-active']);
  assert.deepEqual(result.inactiveConflicts.map((item) => item.id), ['ord-cancelled']);
});

test('prospect booking conflict detects active order and active booking only', () => {
  const result = getProspectBookingScheduleConflicts(
    baseBooking({ id: 'booking-target' }),
    [
      baseBooking({ id: 'booking-active', leadId: 'lead-2' }),
      baseBooking({ id: 'booking-reschedule', leadId: 'lead-3', status: 'reschedule' }),
    ],
    [
      baseOrder({ id: 'ord-active' }),
      baseOrder({ id: 'ord-reschedule', status: 'reschedule' }),
    ],
  );

  assert.deepEqual(result.activeOrderConflicts.map((item) => item.id), ['ord-active']);
  assert.deepEqual(result.activeBookingConflicts.map((item) => item.id), ['booking-active']);
  assert.deepEqual(result.inactiveBookingConflicts.map((item) => item.id), ['booking-reschedule']);
});

test('schedule validation only runs when slot signature changes and row is active', () => {
  assert.equal(shouldValidateOrderScheduleOnSave(null, baseOrder()), true);
  assert.equal(shouldValidateOrderScheduleOnSave(baseOrder(), baseOrder()), false);
  assert.equal(shouldValidateOrderScheduleOnSave(baseOrder(), baseOrder({ serviceTime: '10:00' })), true);
  assert.equal(shouldValidateOrderScheduleOnSave(baseOrder(), baseOrder({ status: 'cancelled' })), false);

  assert.equal(shouldValidateProspectBookingScheduleOnSave(null, baseBooking()), true);
  assert.equal(shouldValidateProspectBookingScheduleOnSave(baseBooking(), baseBooking()), false);
  assert.equal(shouldValidateProspectBookingScheduleOnSave(baseBooking(), baseBooking({ orderId: 'ord-1' })), false);
});

test('schedule slot key requires complete technician date time signature', () => {
  assert.equal(getScheduleSlotConflictKey({ technicianId: 'tech-1', serviceDate: '2026-10-08', serviceTime: '09:00' }), 'tech-1|2026-10-08|09:00');
  assert.equal(getScheduleSlotConflictKey({ technicianId: 'tech-1', serviceDate: '', serviceTime: '09:00' }), null);
});

test('order form phone normalization and minimal patch contract stay stable', () => {
  assert.equal(normalizeCustomerPhone('0812-3456-7890'), '6281234567890');
  assert.equal(normalizeCustomerPhone('81234567890'), '6281234567890');
  assert.equal(normalizeCustomerPhone('+62 812 3456 7890'), '6281234567890');

  const previous = baseOrder({ notes: undefined, price: 350000 });
  assert.deepEqual(buildOrderFormPatch(previous, { ...previous }), {});
  assert.deepEqual(buildOrderFormPatch(previous, { ...previous, price: 450000, notes: null }), { price: 450000 });
});

test('prospect helper keeps Auto WA and latest active booking behavior deterministic', () => {
  assert.equal(isAutoWhatsAppLead({ origin: 'auto_wa_api', lastContact: '', notes: '' }), true);
  assert.equal(isAutoWhatsAppLead({ origin: 'manual', lastContact: 'Auto WA API', notes: '' }), true);
  assert.equal(isAutoWhatsAppLead({ origin: 'manual', lastContact: '', notes: 'Masuk dari Auto WA API' }), true);

  const activeByLead = buildActiveBookingByLeadId([
    baseBooking({ id: 'old', leadId: 'lead-1', updatedAt: '2026-10-01T00:00:00.000Z' }),
    baseBooking({ id: 'new', leadId: 'lead-1', updatedAt: '2026-10-02T00:00:00.000Z' }),
    baseBooking({ id: 'cancelled', leadId: 'lead-2', status: 'cancelled', updatedAt: '2026-10-03T00:00:00.000Z' }),
  ]);
  assert.equal(activeByLead.get('lead-1')?.id, 'new');
  assert.equal(activeByLead.has('lead-2'), false);

  const latestByLead = buildLatestBookingByLeadId([
    baseBooking({ id: 'latest-cancelled', leadId: 'lead-3', status: 'cancelled', updatedAt: '2026-10-04T00:00:00.000Z' }),
    baseBooking({ id: 'older-active', leadId: 'lead-3', updatedAt: '2026-10-03T00:00:00.000Z' }),
  ]);
  assert.equal(latestByLead.get('lead-3')?.id, 'latest-cancelled');

  assert.deepEqual(uniqueById([{ id: 'a', value: 1 }, { id: 'a', value: 2 }]), [{ id: 'a', value: 2 }]);
  assert.equal(getLeadNotesPreview('  A   long   lead note  ', 12), 'A long lead...');
});

test('ads provider and daily sync reconcile preserve manual edits and filter scope', () => {
  assert.equal(getAdsProviderKeyByPlatformName('Meta Ads'), 'meta');
  assert.equal(getAdsProviderKeyByPlatformName('Google Search'), 'google');
  assert.equal(getAdsProviderKeyByPlatformName('TikTok Shop'), 'tiktok');
  assert.equal(getAdsProviderKeyByPlatformName('Organik'), null);

  const context = {
    dailyAds: [baseDailyAd({ editCount: 1 })],
    platforms: [],
    adAccounts: [],
    adAccountAssignments: [],
    adAccountOwnerAssignments: [],
    users: [],
  };

  const [preserved] = reconcileAdsDailySyncPreviewRows(
    [basePreviewRow()],
    context,
    { mode: 'update-existing', preserveEdited: true },
  );
  assert.equal(preserved.status, 'skip');
  assert.match(preserved.reason, /dikoreksi manual/i);

  const [update] = reconcileAdsDailySyncPreviewRows(
    [basePreviewRow()],
    context,
    { mode: 'update-existing', preserveEdited: false },
  );
  assert.equal(update.status, 'update');

  const [newRow] = reconcileAdsDailySyncPreviewRows(
    [basePreviewRow({ adAccountId: 'account-2', id: 'preview-2' })],
    { ...context, dailyAds: [] },
    { mode: 'update-existing', preserveEdited: true },
  );
  assert.equal(newRow.status, 'new');

  const [filtered] = reconcileAdsDailySyncPreviewRows(
    [basePreviewRow({ advertiserId: 'adv-2' })],
    context,
    { advertiserId: 'adv-1' },
  );
  assert.equal(filtered.status, 'skip');
  assert.match(filtered.reason, /advertiser/i);
});

test('ads history distinguishes saved changes from preview, no-op, and partial sync', () => {
  const saved = {
    kind: 'commit', counts: { inserted: 1, updated: 0 }, errors: [],
    providerStatuses: [{ key: 'meta', state: 'success' }],
  };
  assert.equal(hasAdsSyncDataChanges(saved), true);
  assert.equal(hasAdsSyncDataChanges({ ...saved, kind: 'preview' }), false);
  const noChange = { ...saved, counts: { inserted: 0, updated: 0 } };
  assert.equal(hasAdsSyncDataChanges(noChange), false);
  assert.equal(getAdsSyncHistoryOutcome(noChange), 'Tanpa perubahan');
  assert.equal(getAdsSyncHistoryOutcome({ ...saved, errors: ['Google timeout'] }), 'Tersimpan sebagian');
  assert.equal(getAdsSyncHistoryOutcome({ ...noChange, errors: ['Meta timeout'] }), 'Sinkron bermasalah');
});

test('ads history timestamps always use Jakarta time and handle invalid values', () => {
  const displayed = formatAdsSyncHistoryTime('2026-10-17T20:05:00Z');
  assert.match(displayed, /18 Okt 2026/);
  assert.match(displayed, /03[.:]05 WIB/);
  assert.equal(formatAdsSyncHistoryTime('invalid'), '-');
});

test('ads history uses the latest completed sync even when no rows changed', async () => {
  const originalFetch = globalThis.fetch;
  const saved = {
    id: 'saved', created_at: '2026-10-16T03:00:00Z', finished_at: '2026-10-16T03:01:00Z',
    run_kind: 'commit', status: 'succeeded', inserted_count: 0, updated_count: 0,
    range_from: '2026-10-01', range_to: '2026-10-16',
  };
  const previews = Array.from({ length: 5 }, (_, i) => ({
    ...saved, id: 'preview-' + i, run_kind: 'preview', created_at: '2026-10-17T03:00:00Z',
    inserted_count: 0, updated_count: 0,
  }));
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url || input);
    assert.equal(url.pathname, '/rest/v1/daily_ads_sync_runs');
    const isLastUpdate = url.searchParams.get('run_kind') === 'eq.commit';
    if (isLastUpdate) {
      assert.equal(url.searchParams.get('status'), 'in.(succeeded,partial)');
      assert.equal(url.searchParams.get('order'), 'finished_at.desc');
      assert.equal(url.searchParams.get('limit'), '1');
    }
    return new Response(JSON.stringify(isLastUpdate ? [saved] : previews), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const history = await fetchAdsDailySyncUpdateHistory();
    assert.equal(history.source, 'database');
    assert.equal(history.recent.length, 5);
    assert.equal(history.lastUpdate.id, 'saved');
    assert.equal(history.lastUpdate.createdAt, saved.finished_at);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

export async function runCoreContracts() {
  const results = [];
  for (const item of tests) {
    try {
      await item.fn();
      results.push({ name: item.name, passed: true });
    } catch (error) {
      results.push({
        name: item.name,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    passed: results.every((item) => item.passed),
    tests: results,
  };
}
`;

async function buildAndRunContracts() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhi-core-contracts-'));
  const outfile = path.join(tempDir, 'core-contracts.mjs');

  await build({
    stdin: {
      contents: entry,
      resolveDir: PROJECT_ROOT,
      sourcefile: 'core-contracts-entry.ts',
      loader: 'ts',
    },
    outfile,
    absWorkingDir: PROJECT_ROOT,
    bundle: true,
    platform: 'node',
    format: 'esm',
    sourcemap: false,
    define: {
      'import.meta.env': JSON.stringify({
        DEV: false,
        PROD: true,
        VITE_AUTH_MODE: 'supabase',
        VITE_SUPABASE_URL: 'http://localhost',
        VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      }),
    },
    plugins: [localAliasPlugin],
    logLevel: 'silent',
  });

  const module = await import(pathToFileURL(outfile).href);
  return module.runCoreContracts();
}

async function main() {
  ensureArtifactDir();

  try {
    const result = await buildAndRunContracts();
    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    const result = {
      generatedAt: new Date().toISOString(),
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`);
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  }
}

main();
