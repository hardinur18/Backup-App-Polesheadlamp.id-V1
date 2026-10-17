import type { PermissionKey } from '@/app/data/permissions';

export type AppRouteAccess = 'public' | 'auth' | 'permission';

export type AppRouteDefinition = {
  id: string;
  path: string;
  title: string;
  access: AppRouteAccess;
  tabId?: string;
  permission?: PermissionKey;
  canonicalPath?: string;
  notes?: string;
};

export const PUBLIC_APP_ROUTES: AppRouteDefinition[] = [
  {
    id: 'public-booking',
    path: '/booking',
    title: 'Booking',
    access: 'public',
  },
];

export const AUTH_APP_ROUTES: AppRouteDefinition[] = [
  {
    id: 'login',
    path: '/login',
    title: 'Login',
    access: 'public',
    notes: 'Target formal login route. Current login still appears through auth gate.',
  },
  {
    id: 'dashboard',
    tabId: 'dashboard',
    path: '/dashboard',
    title: 'Dashboard',
    access: 'permission',
    permission: 'dashboard.view',
  },
  {
    id: 'dashboard-owner-view-legacy-alias',
    tabId: 'dashboard',
    path: '/dashboard/owner-view',
    title: 'Dashboard',
    access: 'permission',
    permission: 'dashboard.view',
    canonicalPath: '/dashboard',
    notes: 'Legacy owner dashboard path kept as a redirect after the owner-only dashboard modules were removed.',
  },
  {
    id: 'dashboard-advertiser-view-legacy-alias',
    tabId: 'dashboard',
    path: '/dashboard/advertiser-view',
    title: 'Dashboard',
    access: 'permission',
    permission: 'dashboard.view',
    canonicalPath: '/dashboard',
    notes: 'Legacy dashboard view path kept as a redirect after dashboard views moved into the unified Dashboard page.',
  },
  {
    id: 'dashboard-cs-view-legacy-alias',
    tabId: 'dashboard',
    path: '/dashboard/cs-view',
    title: 'Dashboard',
    access: 'permission',
    permission: 'dashboard.view',
    canonicalPath: '/dashboard',
    notes: 'Legacy dashboard view path kept as a redirect after dashboard views moved into the unified Dashboard page.',
  },
  {
    id: 'dashboard-teknisi-view-legacy-alias',
    tabId: 'dashboard',
    path: '/dashboard/teknisi-view',
    title: 'Dashboard',
    access: 'permission',
    permission: 'dashboard.view',
    canonicalPath: '/dashboard',
    notes: 'Legacy dashboard view path kept as a redirect after dashboard views moved into the unified Dashboard page.',
  },
  {
    id: 'daily-ads',
    tabId: 'daily-ads',
    path: '/ads/daily',
    title: 'Iklan Harian',
    access: 'permission',
    permission: 'ads.view_daily',
  },
  {
    id: 'ads-monitoring',
    tabId: 'ads-monitoring',
    path: '/ads/monitoring',
    title: 'Monitoring Performance',
    access: 'permission',
    permission: 'monitoring.marketing.view',
  },
  {
    id: 'affiliates',
    tabId: 'affiliates',
    path: '/affiliates',
    title: 'Affiliate',
    access: 'permission',
    permission: 'affiliate.view',
  },
  {
    id: 'leads',
    tabId: 'leads',
    path: '/leads',
    title: 'Prospek',
    access: 'permission',
    permission: 'leads.view',
  },
  {
    id: 'prospek-alias',
    tabId: 'prospek',
    path: '/leads',
    title: 'Prospek',
    access: 'permission',
    permission: 'leads.view',
    canonicalPath: '/leads',
    notes: 'Compatibility alias for existing bottom navigation id.',
  },
  {
    id: 'embed-forms',
    tabId: 'embed-forms',
    path: '/leads/embed-forms',
    title: 'Embed Lead Form',
    access: 'permission',
    permission: 'leads.view',
  },
  {
    id: 'proof-assets',
    tabId: 'proof-assets',
    path: '/proof-assets',
    title: 'Galeri Bukti',
    access: 'permission',
    permission: 'proof_assets.view',
  },
  {
    id: 'orders',
    tabId: 'orders',
    path: '/orders',
    title: 'Pesanan',
    access: 'permission',
    permission: 'order.view',
  },
  {
    id: 'daily-report',
    tabId: 'daily-report',
    path: '/reports/daily',
    title: 'Laporan Operasional',
    access: 'permission',
    permission: 'daily_report.view',
  },
  {
    id: 'cs-okr-report',
    tabId: 'cs-okr-report',
    path: '/reports/cs-okr',
    title: 'OKR CS',
    access: 'permission',
    permission: 'cs_okr.view',
  },
  {
    id: 'schedule',
    tabId: 'schedule',
    path: '/schedule',
    title: 'Jadwal',
    access: 'permission',
    permission: 'schedule.view',
  },
  {
    id: 'technician-schedule',
    tabId: 'technician-schedule',
    path: '/technician/schedule',
    title: 'Jadwal Teknisi',
    access: 'permission',
    permission: 'technician_schedule.view',
  },
  {
    id: 'teknisi-mobile',
    tabId: 'teknisi-mobile',
    path: '/technician/mobile',
    title: 'Area Teknisi',
    access: 'permission',
    permission: 'teknisi.view_mobile',
  },
  {
    id: 'monitoring-activity',
    tabId: 'monitoring-activity',
    path: '/monitoring/activity',
    title: 'Aktivitas Teknisi',
    access: 'permission',
    permission: 'monitoring.activity_view',
  },
  {
    id: 'monitoring',
    tabId: 'monitoring',
    path: '/monitoring/field',
    title: 'Pemantauan Lapangan',
    access: 'permission',
    permission: 'monitoring.view',
  },
  {
    id: 'map',
    tabId: 'map',
    path: '/map',
    title: 'Peta Sebaran',
    access: 'permission',
    permission: 'map.view_global',
  },
  {
    id: 'profile',
    tabId: 'profile',
    path: '/profile',
    title: 'Profil Saya',
    access: 'auth',
  },
  {
    id: 'payroll',
    tabId: 'payroll',
    path: '/finance/payroll',
    title: 'Payroll & Komisi',
    access: 'permission',
    permission: 'payroll.view',
  },
  {
    id: 'recurring-expenses',
    tabId: 'recurring-expenses',
    path: '/finance/recurring-expenses',
    title: 'Pengeluaran Rutin',
    access: 'permission',
    permission: 'recurring_expenses.view',
  },
  {
    id: 'cashflow',
    tabId: 'cashflow',
    path: '/finance/operational-expenses',
    title: 'Biaya Operasional',
    access: 'permission',
    permission: 'operational_expenses.view',
  },
  {
    id: 'cashflow-legacy-alias',
    path: '/finance/cashflow',
    title: 'Biaya Operasional',
    access: 'permission',
    permission: 'operational_expenses.view',
    canonicalPath: '/finance/operational-expenses',
    notes: 'Compatibility alias for the previous Kas Masuk/Keluar route.',
  },
  {
    id: 'debts',
    tabId: 'debts',
    path: '/finance/debts',
    title: 'Hutang & Piutang',
    access: 'permission',
    permission: 'debts.view',
  },
  {
    id: 'finance-report',
    tabId: 'finance-report',
    path: '/finance/report',
    title: 'Laporan Operasional',
    access: 'permission',
    permission: 'finance_report.view',
    canonicalPath: '/reports/daily',
    notes: 'Legacy finance menu alias; laporan operasional teknisi sekarang satu pintu di /reports/daily.',
  },
  {
    id: 'inventory',
    tabId: 'inventory',
    path: '/inventory',
    title: 'Manajemen Stok',
    access: 'permission',
    permission: 'inventory.view',
    canonicalPath: '/inventory/products',
  },
  {
    id: 'inventory-products',
    tabId: 'inventory-products',
    path: '/inventory/products',
    title: 'Master Data Produk',
    access: 'permission',
    permission: 'inventory.view',
  },
  {
    id: 'inventory-transactions',
    tabId: 'inventory-transactions',
    path: '/inventory/transactions',
    title: 'Transaksi & Mutasi',
    access: 'permission',
    permission: 'stock.transaction.view',
  },
  {
    id: 'inventory-valuation',
    tabId: 'inventory-valuation',
    path: '/inventory/valuation',
    title: 'Laporan Valuasi',
    access: 'permission',
    permission: 'stock.valuation.view',
  },
  {
    id: 'inventory-settings',
    tabId: 'inventory-settings',
    path: '/inventory/settings',
    title: 'Pengaturan Stok',
    access: 'permission',
    permission: 'stock.settings.manage',
  },
  {
    id: 'master-data',
    tabId: 'master-data',
    path: '/master-data',
    title: 'Master Data',
    access: 'permission',
    permission: 'master_data.view',
  },
  {
    id: 'users',
    tabId: 'users',
    path: '/users',
    title: 'Pengguna & Akses',
    access: 'permission',
    permission: 'users.view',
  },
  {
    id: 'roles',
    tabId: 'roles',
    path: '/settings/roles',
    title: 'Role Permission',
    access: 'permission',
    permission: 'role_permissions.view',
  },
  {
    id: 'usage-control',
    tabId: 'usage-control',
    path: '/settings/usage-control',
    title: 'Kontrol & Integrasi',
    access: 'permission',
    permission: 'role_permissions.view',
  },
  {
    id: 'wa-templates',
    tabId: 'wa-templates',
    path: '/leads/templates',
    title: 'Template WhatsApp',
    access: 'permission',
    permission: 'wa_template.view',
  },
  {
    id: 'audit-logs',
    tabId: 'audit-logs',
    path: '/audit-logs',
    title: 'Riwayat Aktivitas',
    access: 'permission',
    permission: 'audit_logs.view',
  },
];

export const ADS_MONITORING_APP_ROUTES: AppRouteDefinition[] = [
  {
    id: 'ads-monitoring-workspace',
    tabId: 'ads-monitoring-workspace',
    path: '/ads/monitoring/overview',
    title: 'Ads Monitoring',
    access: 'permission',
    permission: 'monitoring.marketing.view',
    canonicalPath: '/ads/monitoring/overview',
  },
  {
    id: 'ads-monitoring-overview',
    tabId: 'ads-monitoring-overview',
    path: '/ads/monitoring/overview',
    title: 'Ads Monitoring / Ringkasan',
    access: 'permission',
    permission: 'monitoring.marketing.view',
  },
  {
    id: 'ads-realtime',
    tabId: 'ads-realtime',
    path: '/ads/monitoring/integrasi-iklan',
    title: 'Integrasi Iklan',
    access: 'permission',
    permission: 'monitoring.marketing.view',
    canonicalPath: '/ads/monitoring/integrasi-iklan',
  },
  {
    id: 'ads-monitoring-integrasi-iklan',
    tabId: 'ads-monitoring-integrasi-iklan',
    path: '/ads/monitoring/integrasi-iklan',
    title: 'Ads Monitoring / Integrasi Iklan',
    access: 'permission',
    permission: 'monitoring.marketing.view',
  },
  {
    id: 'ads-monitoring-advertiser-matrix',
    tabId: 'ads-monitoring-advertiser-matrix',
    path: '/ads/monitoring/advertiser-matrix',
    title: 'Ads Monitoring / Matriks Advertiser',
    access: 'permission',
    permission: 'monitoring.marketing.view',
  },
  {
    id: 'ads-monitoring-cs-matrix',
    tabId: 'ads-monitoring-cs-matrix',
    path: '/ads/monitoring/cs-matrix',
    title: 'Ads Monitoring / Matriks CS',
    access: 'permission',
    permission: 'monitoring.marketing.view',
  },
  {
    id: 'ads-monitoring-diagnostics',
    tabId: 'ads-monitoring-diagnostics',
    path: '/ads/monitoring/diagnostics',
    title: 'Ads Monitoring / Diagnostik',
    access: 'permission',
    permission: 'monitoring.marketing.view',
  },
  {
    id: 'ads-monitoring-openclaw',
    tabId: 'ads-monitoring-openclaw',
    path: '/ads/monitoring/openclaw',
    title: 'Ads Monitoring / OpenClaw',
    access: 'permission',
    permission: 'monitoring.marketing.view',
  },
  {
    id: 'ads-monitoring-action-sandbox',
    tabId: 'ads-monitoring-action-sandbox',
    path: '/ads/monitoring/action-sandbox',
    title: 'Ads Monitoring / Simulasi Aksi',
    access: 'permission',
    permission: 'monitoring.marketing.view',
  },
];

export const CONVERSATION_APP_ROUTES: AppRouteDefinition[] = [
  {
    id: 'conversation-center',
    tabId: 'conversation-center',
    path: '/conversations',
    title: 'Pusat Percakapan',
    access: 'permission',
    permission: 'whatsapp.view',
    canonicalPath: '/conversations/inbox',
  },
  {
    id: 'conversation-live-inbox',
    tabId: 'conversation-live-inbox',
    path: '/conversations/inbox',
    title: 'Pusat Percakapan / Kotak Masuk Live',
    access: 'permission',
    permission: 'whatsapp.view',
  },
  {
    id: 'conversation-channel-settings',
    tabId: 'conversation-channel-settings',
    path: '/conversations/channel-settings',
    title: 'Pusat Percakapan / Pengaturan Channel',
    access: 'permission',
    permission: 'whatsapp.view',
  },
  {
    id: 'conversation-automation',
    tabId: 'conversation-automation',
    path: '/conversations/automation',
    title: 'Pusat Percakapan / Bot & Automasi',
    access: 'permission',
    permission: 'whatsapp.view',
  },
  {
    id: 'conversation-routing',
    tabId: 'conversation-routing',
    path: '/conversations/routing',
    title: 'Pusat Percakapan / Routing CS',
    access: 'permission',
    permission: 'whatsapp.view',
  },
  {
    id: 'conversation-history',
    tabId: 'conversation-history',
    path: '/conversations/history',
    title: 'Pusat Percakapan / Riwayat Percakapan',
    access: 'permission',
    permission: 'whatsapp.view',
  },
];

export const WHATSAPP_APP_ROUTES: AppRouteDefinition[] = [
  {
    id: 'whatsapp',
    tabId: 'whatsapp',
    path: '/whatsapp',
    title: 'Live Chat',
    access: 'permission',
    permission: 'whatsapp.view',
    canonicalPath: '/whatsapp/chats',
  },
  {
    id: 'whatsapp-chats',
    tabId: 'whatsapp-chats',
    path: '/whatsapp/chats',
    title: 'Live Chat',
    access: 'permission',
    permission: 'whatsapp.view',
  },
  {
    id: 'whatsapp-contacts',
    tabId: 'whatsapp-contacts',
    path: '/whatsapp/contacts',
    title: 'CRM / Kontak',
    access: 'permission',
    permission: 'whatsapp.view',
  },
  {
    id: 'whatsapp-templates',
    tabId: 'whatsapp-templates',
    path: '/whatsapp/templates',
    title: 'Live Chat / Template Pesan',
    access: 'permission',
    permission: 'whatsapp.templates.manage',
  },
  {
    id: 'whatsapp-inbox-settings',
    tabId: 'whatsapp-inbox-settings',
    path: '/whatsapp/inbox-settings',
    title: 'Live Chat / Akun WA',
    access: 'permission',
    permission: 'whatsapp.settings.manage',
  },
];

export const APP_ROUTE_DEFINITIONS: AppRouteDefinition[] = [
  ...PUBLIC_APP_ROUTES,
  ...AUTH_APP_ROUTES,
  ...ADS_MONITORING_APP_ROUTES,
  ...CONVERSATION_APP_ROUTES,
  ...WHATSAPP_APP_ROUTES,
];

export const LEGACY_APP_ROUTE_ALIASES: AppRouteDefinition[] = [
  ...AUTH_APP_ROUTES,
  ...ADS_MONITORING_APP_ROUTES,
  ...CONVERSATION_APP_ROUTES,
  ...WHATSAPP_APP_ROUTES,
]
  .filter((route) => route.path !== '/login')
  .map((route) => ({
    ...route,
    id: `legacy-app-${route.id}`,
    path: `/app${route.path}`,
    canonicalPath: route.canonicalPath ?? route.path,
    notes: route.notes
      ? `${route.notes} Legacy /app alias.`
      : 'Legacy /app alias kept during route migration.',
  }));

export const APP_ROUTE_PATH_DEFINITIONS: AppRouteDefinition[] = [
  ...APP_ROUTE_DEFINITIONS,
  ...LEGACY_APP_ROUTE_ALIASES,
];

export function normalizeAppPath(path: string) {
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }

  return path;
}

export const APP_ROUTES_BY_PATH = APP_ROUTE_PATH_DEFINITIONS.reduce<Record<string, AppRouteDefinition>>(
  (acc, route) => {
    const path = normalizeAppPath(route.path);
    const existingRoute = acc[path];

    if (!existingRoute || existingRoute.canonicalPath) {
      acc[path] = route;
    }

    return acc;
  },
  {},
);

export const APP_ROUTES_BY_TAB_ID = APP_ROUTE_DEFINITIONS.reduce<Record<string, AppRouteDefinition>>(
  (acc, route) => {
    if (route.tabId && !acc[route.tabId]) {
      acc[route.tabId] = route;
    }

    return acc;
  },
  {},
);

export function getAppRouteByPath(path: string) {
  return APP_ROUTES_BY_PATH[normalizeAppPath(path)] ?? null;
}

export function getAppRouteByTabId(tabId: string) {
  return APP_ROUTES_BY_TAB_ID[tabId] ?? null;
}

export function getCanonicalAppPath(route: AppRouteDefinition) {
  const path = route.canonicalPath ?? route.path;
  const segmentCount = path.split('/').filter(Boolean).length;

  if (segmentCount === 1 && !path.endsWith('/')) {
    return `${path}/`;
  }

  return path;
}
