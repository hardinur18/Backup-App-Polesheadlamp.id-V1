import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useMasterData } from '@/app/pages/master-data/context';
import { supabase } from '@/lib/supabaseClient';
import { Sidebar } from '../Sidebar';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { cn } from '../ui/utils';
import { toast } from 'sonner';
import { Toaster } from '../ui/sonner';
import { Menu, Sun, Moon, LogOut, User, RefreshCcw } from 'lucide-react';
import { useTheme } from "next-themes"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "../ui/sheet";
import { NotificationBell } from '../ui/NotificationBell';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu"

// Page Components
import { PlaceholderPage } from '../../pages/PlaceholderPage';
import { usePermissions } from '@/app/hooks/usePermissions';
import { DashboardViewMode, DASHBOARD_VIEW_PERMISSION_MAP, DEFAULT_DASHBOARD_VIEW_BY_ROLE, type PermissionKey } from '../../data/permissions';
import {
  isAdvertiserRole,
  isCsRole,
  isFinanceRole,
  isTechnicianRole,
} from '@/app/data/roleHelpers';
import { Lock } from 'lucide-react';
import { BottomNav } from '../BottomNav';
import { AppLoadingScreen } from '../AppLoadingScreen';
import {
  ACCESS_DENIED_FALLBACK_TAB,
  APP_LAYOUT_ACCESS_FALLBACKS,
  DEFAULT_APP_LAYOUT_TAB,
  TEKNISI_ALLOWED_TABS,
} from './appLayoutTabRegistry';
import { APP_LAYOUT_TAB_PERMISSIONS } from './appLayoutTabPermissions';
import { getAppLayoutPageTitle } from './appLayoutPageTitles';
import { getAppLayoutPlaceholderMeta } from './appLayoutWorkspaceMeta';
import {
  getAppRouteByPath,
  getAppRouteByTabId,
  getCanonicalAppPath,
} from '@/app/routing/appRouteRegistry';

const Dashboard = React.lazy(() => import('../../pages/Dashboard'));

const Prospek = React.lazy(() =>
  import('../../pages/Prospek').then((module) => ({ default: module.Prospek })),
);

const EmbedLeadFormManagerPage = React.lazy(() =>
  import('../../pages/leads/EmbedLeadFormManagerPage').then((module) => ({ default: module.EmbedLeadFormManagerPage })),
);

const ProofAssetLibraryPage = React.lazy(() =>
  import('../../pages/proof-assets/ProofAssetLibraryPage').then((module) => ({ default: module.ProofAssetLibraryPage })),
);

const Pesanan = React.lazy(() =>
  import('../../pages/Pesanan').then((module) => ({ default: module.Pesanan })),
);

const Schedule = React.lazy(() => import('../../pages/Schedule'));

const Pemantauan = React.lazy(() =>
  import('../../pages/Pemantauan').then((module) => ({ default: module.Pemantauan })),
);

const Kas = React.lazy(() =>
  import('../../pages/Kas').then((module) => ({ default: module.Kas })),
);

const Laporan = React.lazy(() =>
  import('../../pages/Laporan').then((module) => ({ default: module.Laporan })),
);

const UserManagement = React.lazy(() => import('../../pages/users/UserManagementPage'));

const MasterDataPage = React.lazy(() =>
  import('../../pages/master-data/MasterDataPage').then((module) => ({ default: module.MasterDataPage })),
);

const ProfilePage = React.lazy(() =>
  import('../../pages/ProfilePage').then((module) => ({ default: module.ProfilePage })),
);

const AffiliateList = React.lazy(() =>
  import('../../pages/affiliates/AffiliateList').then((module) => ({ default: module.AffiliateList })),
);

const MapPage = React.lazy(() =>
  import('../../pages/MapPage').then((module) => ({ default: module.MapPage })),
);

const DebtsPage = React.lazy(() =>
  import('../../pages/finance/DebtsPage').then((module) => ({ default: module.DebtsPage })),
);

const RoleManagement = React.lazy(() =>
  import('../../pages/settings/RoleManagement').then((module) => ({ default: module.RoleManagement })),
);

const UsageControlPage = React.lazy(() =>
  import('../../pages/settings/UsageControlPage').then((module) => ({ default: module.UsageControlPage })),
);

const TeknisiMobile = React.lazy(() =>
  import('../../pages/TeknisiMobile').then((module) => ({ default: module.TeknisiMobile })),
);

const MonitoringPage = React.lazy(() =>
  import('../../pages/MonitoringPage').then((module) => ({ default: module.MonitoringPage })),
);

const TechnicianSchedulePage = React.lazy(() => import('../../pages/technician/TechnicianSchedulePage'));

const RecurringExpensesTab = React.lazy(() =>
  import('../../pages/master-data/tabs/RecurringExpensesTab').then((module) => ({ default: module.RecurringExpensesTab })),
);

const AuditLogPage = React.lazy(() =>
  import('../../pages/AuditLogPage').then((module) => ({ default: module.AuditLogPage })),
);

const AdsMonitoringOverviewPage = React.lazy(() =>
  import('../../pages/ads/AdsMonitoringOverviewPage').then((module) => ({ default: module.AdsMonitoringOverviewPage })),
);

const UnifiedAdsMonitoringPage = React.lazy(() =>
  import('../../pages/ads/UnifiedAdsMonitoringPage').then((module) => ({ default: module.UnifiedAdsMonitoringPage })),
);

const AdsMonitoringAdvertiserMatrixPage = React.lazy(() =>
  import('../../pages/ads/AdsMonitoringAdvertiserMatrixPage').then((module) => ({ default: module.AdsMonitoringAdvertiserMatrixPage })),
);

const AdsMonitoringCsMatrixPage = React.lazy(() =>
  import('../../pages/ads/AdsMonitoringCsMatrixPage').then((module) => ({ default: module.AdsMonitoringCsMatrixPage })),
);

const AdsMonitoringDiagnosticsPage = React.lazy(() =>
  import('../../pages/ads/AdsMonitoringDiagnosticsPage').then((module) => ({ default: module.AdsMonitoringDiagnosticsPage })),
);

const AdsMonitoringOpenClawPage = React.lazy(() =>
  import('../../pages/ads/AdsMonitoringOpenClawPage').then((module) => ({ default: module.AdsMonitoringOpenClawPage })),
);

const AdsMonitoringActionSandboxPage = React.lazy(() =>
  import('../../pages/ads/AdsMonitoringActionSandboxPage').then((module) => ({ default: module.AdsMonitoringActionSandboxPage })),
);

const ConversationLiveInboxPage = React.lazy(() =>
  import('../../pages/conversations/ConversationLiveInboxPage').then((module) => ({ default: module.ConversationLiveInboxPage })),
);

const ConversationChannelSettingsPage = React.lazy(() =>
  import('../../pages/conversations/ConversationChannelSettingsPage').then((module) => ({ default: module.ConversationChannelSettingsPage })),
);

const WhatsAppChatsPage = React.lazy(() =>
  import('../../pages/whatsapp/WhatsAppChatsPage').then((module) => ({ default: module.WhatsAppChatsPage })),
);

const WhatsAppContactsPage = React.lazy(() =>
  import('../../pages/whatsapp/WhatsAppContactsPage').then((module) => ({ default: module.WhatsAppContactsPage })),
);

const WhatsAppTemplatesPage = React.lazy(() =>
  import('../../pages/whatsapp/WhatsAppTemplatesPage').then((module) => ({ default: module.WhatsAppTemplatesPage })),
);

const WhatsAppInboxSettingsPage = React.lazy(() =>
  import('../../pages/whatsapp/WhatsAppInboxSettingsPage').then((module) => ({ default: module.WhatsAppInboxSettingsPage })),
);

const PayrollPage = React.lazy(() =>
  import('../../pages/finance/PayrollPage').then((module) => ({ default: module.PayrollPage })),
);

const StockManagementPage = React.lazy(() =>
  import('../../pages/stock/StockManagementPage').then((module) => ({ default: module.StockManagementPage })),
);

const WATemplatesPage = React.lazy(() =>
  import('../../pages/WATemplatesPage').then((module) => ({ default: module.WATemplatesPage })),
);

const IklanHarianPage = React.lazy(() =>
  import('../../pages/IklanHarian').then((module) => ({ default: module.IklanHarian })),
);

const MarketingMonitoringPage = React.lazy(() =>
  import('../../pages/ads/MarketingMonitoringPage').then((module) => ({ default: module.MarketingMonitoringPage })),
);

const CsOkrReportPage = React.lazy(() =>
  import('../../pages/cs/CsOkrReportPage').then((module) => ({ default: module.CsOkrReportPage })),
);

const hasRequiredPermission = (
  requirement: PermissionKey | PermissionKey[] | undefined,
  hasPermission: (permission: PermissionKey) => boolean,
) => {
  if (!requirement) return true;
  return Array.isArray(requirement)
    ? requirement.some(permission => hasPermission(permission))
    : hasPermission(requirement);
};

const hasTabAccess = (
  tabId: string,
  hasPermission: (permission: PermissionKey) => boolean,
) => hasRequiredPermission(APP_LAYOUT_TAB_PERMISSIONS[tabId], hasPermission);

const getRoleFallbackCandidates = (role?: string) => {
  if (isTechnicianRole(role)) {
    return ['teknisi-mobile', 'orders', 'dashboard'];
  }

  if (isCsRole(role)) {
    return ['dashboard', 'leads', 'orders', 'schedule'];
  }

  if (isAdvertiserRole(role)) {
    return ['dashboard', 'daily-ads', 'leads', 'orders', 'schedule'];
  }

  if (isFinanceRole(role)) {
    return ['dashboard', 'finance-report', 'daily-report', 'orders', 'cashflow'];
  }

  return ['dashboard', 'leads', 'orders', 'daily-report'];
};

// --- COMPONENTS ---

function PageLoadingState() {
  return (
    <div className="opsPageShell">
      <div className="surfacePanel">
        <div className="topbar mb-0">
          <div className="topbarTitle space-y-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-7 w-64 max-w-full" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <div className="topbarActions">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-9" />
          </div>
        </div>
      </div>
      <div className="metricGrid">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="metricCard loading">
            <span className="metricIcon">
              <Skeleton className="h-5 w-5 rounded-full" />
            </span>
            <span>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-4 h-8 w-20" />
            <Skeleton className="mt-2 h-3 w-32" />
            </span>
          </div>
        ))}
      </div>
      <div className="tablePanel">
        <div className="tableHeader">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="space-y-3 p-5">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ModeToggle() {
  const { resolvedTheme, theme, setTheme } = useTheme()
  const activeTheme = (theme === "system" ? resolvedTheme : theme) ?? "light"
  const isDark = activeTheme === "dark"

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="appTopbarButton appTopbarSecondaryAction"
      title={isDark ? "Ubah ke mode terang" : "Ubah ke mode gelap"}
    >
      <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}

export function AppLayout() {
  const context = useMasterData();
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const location = useLocation();
  const navigate = useNavigate();
  const currentRoute = React.useMemo(
    () => getAppRouteByPath(location.pathname),
    [location.pathname],
  );
  const routeTabId = React.useMemo(
    () => currentRoute?.tabId,
    [currentRoute],
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // Default closed on mobile
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [fallbackActiveTab, setFallbackActiveTab] = useState(routeTabId ?? DEFAULT_APP_LAYOUT_TAB);
  const activeTab = routeTabId ?? fallbackActiveTab;
  const [dashboardViewMode, setDashboardViewMode] = useState<DashboardViewMode | undefined>(undefined);
  const currentRole = context?.currentRole;
  const currentUser = context?.currentUser;
  const isCurrentUserResolved = context?.isCurrentUserResolved ?? false;
  const currentUserIssue = context?.currentUserIssue;
  const triggerRefresh = context?.triggerRefresh ?? (() => {});
  const isRefreshingData = Boolean(
    context?.isMasterDataLoading ||
    context?.isOperationalDataLoading ||
    context?.isOrdersLoading ||
    context?.isLeadsLoading,
  );
  const handleGlobalRefresh = React.useCallback(() => {
    if (isRefreshingData) {
      toast.info('Data masih dimuat...');
      return;
    }

    triggerRefresh();
  }, [isRefreshingData, triggerRefresh]);
  const isTechnicianAppMode = isTechnicianRole(currentRole);
  const dashboardViewModes = React.useMemo(
    () => Object.keys(DASHBOARD_VIEW_PERMISSION_MAP) as DashboardViewMode[],
    [],
  );
  const isRecoverableCurrentUserIssue =
    currentUserIssue?.code === 'profile_timeout' ||
    currentUserIssue?.code === 'profile_query_error';
  const hasInvalidRoleSession = isCurrentUserResolved && !currentUser;
  const currentUserIssueTitle = (() => {
    switch (currentUserIssue?.code) {
      case 'profile_not_found':
        return 'Profil App V2 Belum Ada';
      case 'profile_inactive':
        return 'Akun Dinonaktifkan';
      case 'invalid_role':
        return 'Role Belum Didukung';
      case 'profile_query_error':
        return 'Profil Tidak Bisa Dibaca';
      case 'profile_timeout':
        return 'Koneksi Profil Timeout';
      default:
        return 'Profil Login Belum Valid';
    }
  })();
  const currentUserIssueHint =
    currentUserIssue?.message ||
    'Sesi browser masih aktif, tetapi profil pengguna belum siap dipakai di app v2.';

  React.useEffect(() => {
    const root = document.documentElement;
    const workspaceLayerLeft = isTechnicianAppMode ? '0px' : isSidebarCollapsed ? '88px' : '304px';

    root.style.setProperty('--workspace-layer-left', workspaceLayerLeft);

    return () => {
      root.style.removeProperty('--workspace-layer-left');
    };
  }, [isSidebarCollapsed, isTechnicianAppMode]);

  const preferredDashboardView = currentRole ? DEFAULT_DASHBOARD_VIEW_BY_ROLE[currentRole] : undefined;
  const preferredDashboardPermission = preferredDashboardView
    ? DASHBOARD_VIEW_PERMISSION_MAP[preferredDashboardView]
    : undefined;
  const availableDashboardViewModes = React.useMemo(
    () => dashboardViewModes.filter(mode => hasPermission(DASHBOARD_VIEW_PERMISSION_MAP[mode])),
    [dashboardViewModes, hasPermission],
  );
  const resolvedDashboardViewMode = React.useMemo(() => {
      if (!hasPermission('dashboard.view')) {
          return undefined;
      }

      if (dashboardViewMode && hasPermission(DASHBOARD_VIEW_PERMISSION_MAP[dashboardViewMode])) {
          return dashboardViewMode;
      }

      if (preferredDashboardPermission && hasPermission(preferredDashboardPermission)) {
          return preferredDashboardView;
      }

      return availableDashboardViewModes[0];
  }, [availableDashboardViewModes, dashboardViewMode, hasPermission, preferredDashboardPermission, preferredDashboardView]);

  React.useEffect(() => {
      if (!currentRoute) {
          return;
      }

      const canonicalPath = getCanonicalAppPath(currentRoute);
      if (canonicalPath !== location.pathname) {
          navigate(canonicalPath, { replace: true });
          return;
      }

      if (currentRoute.tabId) {
          setFallbackActiveTab(currentRoute.tabId);
      }
  }, [currentRoute, location.pathname, navigate]);

  const handleNavigate = React.useCallback((tabId: string) => {
      const route = getAppRouteByTabId(tabId);
      const nextPath = route ? getCanonicalAppPath(route) : null;
      const isSameRoute = nextPath === location.pathname && tabId === activeTab;

      if (isSameRoute) {
          return;
      }

      if (!route || !nextPath) {
          setFallbackActiveTab(tabId);
          return;
      }

      if (nextPath !== location.pathname) {
          navigate(nextPath);
          window.setTimeout(() => {
              const targetPath = new URL(nextPath, window.location.origin).pathname;
              if (window.location.pathname !== targetPath) {
                  window.location.assign(nextPath);
              }
          }, 180);
          return;
      }

      setFallbackActiveTab(tabId);
  }, [activeTab, location.pathname, navigate]);

  const getAccessibleFallbackTab = React.useCallback(() => {
      const roleCandidates = getRoleFallbackCandidates(currentRole);
      const fallbackCandidates = [
        ...roleCandidates,
        ...APP_LAYOUT_ACCESS_FALLBACKS.map(({ tab }) => tab),
        ACCESS_DENIED_FALLBACK_TAB,
      ];

      return fallbackCandidates.find((tabId) =>
        tabId !== activeTab && hasTabAccess(tabId, hasPermission)
      );
  }, [activeTab, currentRole, hasPermission]);

  // Effect: Auto-switch tab if permission denied (e.g. when switching roles)
  React.useEffect(() => {
      if (!isCurrentUserResolved || !currentUser || !currentRole) {
          return;
      }

      if (permissionsLoading) {
          return;
      }

      // STRICT REDIRECT FOR TEKNISI
      if (isTechnicianRole(currentRole)) {
          if (!TEKNISI_ALLOWED_TABS.includes(activeTab as (typeof TEKNISI_ALLOWED_TABS)[number])) {
              handleNavigate('teknisi-mobile');
          }
          return;
      }

      const requiredPermission = APP_LAYOUT_TAB_PERMISSIONS[activeTab];
      if (requiredPermission) {
          const isAllowed = hasRequiredPermission(requiredPermission, hasPermission);
          
          if (!isAllowed) {
              const fallbackTab = getAccessibleFallbackTab();

              if (fallbackTab) {
                  handleNavigate(fallbackTab);
              }
          }
      }
  }, [activeTab, currentRole, currentUser, getAccessibleFallbackTab, handleNavigate, hasPermission, isCurrentUserResolved, permissionsLoading]);

  React.useEffect(() => {
      if (dashboardViewMode !== resolvedDashboardViewMode) {
          setDashboardViewMode(resolvedDashboardViewMode);
      }
  }, [dashboardViewMode, resolvedDashboardViewMode]);

  // Safe check context
  if (!context) {
      return <div className="p-4 text-red-500">Error: MasterData Context not loaded.</div>;
  }

  // Helper to render the correct page content
  const renderContent = () => {
    // --- 1. ACCESS CONTROL CHECK ---
    const requiredPermission = APP_LAYOUT_TAB_PERMISSIONS[activeTab];
    let isAllowed = true;

    if (requiredPermission) {
        const isAllowedByCurrentSnapshot = hasRequiredPermission(requiredPermission, hasPermission);
        if (!isAllowedByCurrentSnapshot && permissionsLoading) {
            return (
              <AppLoadingScreen
                inline
                label="Membuka akses"
                detail="Menyiapkan menu sesuai role akun..."
              />
            );
        }

        if (!isAllowedByCurrentSnapshot) {
            isAllowed = false;
        }
    }

    if (!isAllowed) {
        const fallbackTab = getAccessibleFallbackTab();
        if (fallbackTab) {
             return (
               <AppLoadingScreen
                 inline
                 label="Mengalihkan halaman"
                 detail="Mengarahkan ke menu yang tersedia untuk role ini..."
               />
             );
        }
        return <AccessDenied />;
    }

    // --- 2. RENDER CONTENT ---
    switch (activeTab) {
      case 'dashboard':
        if (!resolvedDashboardViewMode) {
            return <AccessDenied />;
        }
        return (
          <Dashboard
            viewMode={resolvedDashboardViewMode}
            availableViewModes={availableDashboardViewModes}
            onViewModeChange={setDashboardViewMode}
          />
        );
      case 'daily-ads':
        return <IklanHarianPage />;
      case 'ads-monitoring':
        return <MarketingMonitoringPage />;
      case 'ads-monitoring-workspace':
      case 'ads-monitoring-overview':
        return <AdsMonitoringOverviewPage />;
      case 'ads-realtime':
      case 'ads-monitoring-integrasi-iklan':
        return <UnifiedAdsMonitoringPage />;
      case 'ads-monitoring-advertiser-matrix':
        return <AdsMonitoringAdvertiserMatrixPage />;
      case 'ads-monitoring-cs-matrix':
        return <AdsMonitoringCsMatrixPage />;
      case 'ads-monitoring-diagnostics':
        return <AdsMonitoringDiagnosticsPage />;
      case 'ads-monitoring-openclaw':
        return <AdsMonitoringOpenClawPage />;
      case 'ads-monitoring-action-sandbox':
        return <AdsMonitoringActionSandboxPage />;
      case 'conversation-center':
      case 'conversation-live-inbox':
        return <ConversationLiveInboxPage />;
      case 'conversation-channel-settings':
        return <ConversationChannelSettingsPage />;
      case 'whatsapp':
      case 'whatsapp-chats':
        return <WhatsAppChatsPage />;
      case 'whatsapp-contacts':
        return <WhatsAppContactsPage />;
      case 'whatsapp-templates':
        return <WhatsAppTemplatesPage />;
      case 'whatsapp-inbox-settings':
        return <WhatsAppInboxSettingsPage />;
      default: {
        const placeholderMeta = getAppLayoutPlaceholderMeta(activeTab);

        return placeholderMeta ? (
          <PlaceholderPage
            title={placeholderMeta.title}
            description={placeholderMeta.description}
          />
        ) : (
          <PlaceholderPage
            title="Halaman Belum Tersedia"
            description="Route ini belum terhubung ke halaman aplikasi."
          />
        );
      }
      case 'affiliates':
        return <AffiliateList />;
      case 'leads': // Changed to leads to match sidebar
      case 'prospek':
        return <Prospek onNavigate={handleNavigate} />;
      case 'embed-forms':
        return <EmbedLeadFormManagerPage />;
      case 'proof-assets':
        return <ProofAssetLibraryPage />;
      case 'orders':
        return <Pesanan onNavigate={handleNavigate} />;
      case 'daily-report':
        return <Laporan />;
      case 'cs-okr-report':
        return <CsOkrReportPage />;
      case 'schedule':
        return <Schedule />;
      case 'teknisi-mobile':
        return <TeknisiMobile />;
      case 'monitoring-activity':
        return <MonitoringPage />;
      case 'monitoring':
        return <Pemantauan />;
      case 'map':
        return <MapPage />;
      case 'recurring-expenses':
        return <div className="recurringExpensesRouteFrame"><RecurringExpensesTab currentRole={currentRole} /></div>;
      case 'cashflow':
        return <Kas />;
      case 'debts':
        return <DebtsPage />;
      case 'finance-report':
        return <Laporan mode="finance" />;
      case 'payroll':
        return <PayrollPage />;
      case 'inventory':
      case 'inventory-products':
        return <StockManagementPage key={activeTab} defaultTab="products" />;
      case 'inventory-transactions':
        return <StockManagementPage key={activeTab} defaultTab="transactions" />;
      case 'inventory-valuation':
        return <StockManagementPage key={activeTab} defaultTab="valuation" />;
      case 'inventory-settings':
        return <StockManagementPage key={activeTab} defaultTab="settings" />;
      case 'master-data':
        return (
          <MasterDataPage currentRole={currentRole} />
        );
      case 'users':
        return <UserManagement />;
      case 'technician-schedule':
        return <TechnicianSchedulePage />;
      case 'profile':
        return <ProfilePage />;
      case 'wa-templates':
        return <WATemplatesPage />;
      case 'audit-logs':
        return <AuditLogPage onBack={() => handleNavigate('dashboard')} />;
      case 'roles':
        return <RoleManagement />;
      case 'usage-control':
        return <UsageControlPage />;
    }
  };

  const getPageTitle = () => {
    return getAppLayoutPageTitle(activeTab);
  };
  const isFlushContentPage = activeTab === 'whatsapp-chats';

  const handleLogout = async () => {
    const loadingToast = toast.loading('Sedang keluar...');
    try {
      localStorage.clear();
      sessionStorage.clear();

      if (import.meta.env.VITE_AUTH_MODE !== 'local') {
        const { error } = await supabase.auth.signOut();
        if (error) {
          console.warn('Logout warning:', error.message);
        }
      }
    } catch (error) {
      console.error('Logout critical error:', error);
    } finally {
      toast.dismiss(loadingToast);
      window.location.href = '/'; 
    }
  };

  const AccessDenied = () => (
    <main className="loginShell">
      <section className="loginCard">
        <span className="loginMark dangerMark">
          <Lock size={26} />
        </span>
        <p className="loginEyebrow">Akses</p>
        <h1>Akses Ditolak</h1>
        <p className="loginHint">
            Anda tidak memiliki izin untuk mengakses halaman ini ({activeTab}). 
            Silakan hubungi Administrator jika Anda yakin ini kesalahan.
        </p>
        <Button onClick={() => handleNavigate(getAccessibleFallbackTab() || DEFAULT_APP_LAYOUT_TAB)} variant="outline">
            Kembali ke Halaman Utama
        </Button>
      </section>
    </main>
  );

  const RoleConfigurationRequired = () => (
    <main className="loginShell">
      <section className="loginCard">
        <span className="loginMark">
          <Lock size={26} />
        </span>
        <p className="loginEyebrow">Session App V2</p>
        <h1>{currentUserIssueTitle}</h1>
        <p className="loginHint">
          {currentUserIssueHint} Login ulang akan membersihkan session lama dari browser ini.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {isRecoverableCurrentUserIssue && (
            <Button onClick={() => window.location.reload()} variant="default">
              Coba Muat Ulang
            </Button>
          )}
          <Button onClick={handleLogout} variant="outline">
            Bersihkan Session
          </Button>
        </div>
      </section>
    </main>
  );

  if (hasInvalidRoleSession) {
    return <RoleConfigurationRequired />;
  }

  if (!isCurrentUserResolved) {
    return <AppLoadingScreen />;
  }

  return (
    <div
      className={cn(
        'appShell',
        isSidebarCollapsed && 'sidebarCollapsed',
        isTechnicianAppMode && 'sidebarHidden technicianAppMode',
      )}
    >
      
      {/* MOBILE SIDEBAR (Drawer/Sheet) - Still accessible via Hamburger for full menu */}
      {!isTechnicianAppMode && (
        <Sheet open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
          <SheetContent side="left" className="appSheetContent w-[300px] border-r-0 bg-white p-0 text-slate-700 focus:outline-none dark:bg-slate-950 dark:text-slate-300">
              <SheetHeader className="sr-only">
                <SheetTitle>Mobile Navigation</SheetTitle>
                <SheetDescription>Main navigation sidebar for mobile devices</SheetDescription>
              </SheetHeader>
              <Sidebar 
                  activeTab={activeTab} 
                  onNavigate={(id) => {
                      handleNavigate(id);
                      setIsSidebarOpen(false); // Close sheet on navigate
                  }} 
                  mobileMode={true}
                  onLogout={handleLogout}
              />
          </SheetContent>
        </Sheet>
      )}

      {/* DESKTOP SIDEBAR (Static) */}
      {!isTechnicianAppMode && (
        <div className="desktopSidebarSlot">
          <Sidebar 
              activeTab={activeTab} 
              onNavigate={handleNavigate} 
              isCollapsed={isSidebarCollapsed}
              toggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              onLogout={handleLogout}
          />
        </div>
      )}

      {/* Main Content */}
      <main className="appMain">
        {/* Topbar - Hidden on Teknisi Mobile */}
        {!isTechnicianAppMode && activeTab !== 'teknisi-mobile' && (
        <header className="appTopbar">
          <div className="appTopbarStart">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setIsSidebarOpen(true)} 
              className="appTopbarButton"
              aria-label="Buka menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
            
            {/* Breadcrumbs / Page Title */}
            <div className="crumbLine">
               <span className="hidden md:inline">RHI System</span>
               <span className="truncate">
                  {getPageTitle()}
               </span>
            </div>
          </div>

          <div className="appTopbarActions">
             <Button 
               variant="ghost" 
               size="icon" 
               onClick={handleGlobalRefresh}
               className="appTopbarButton appTopbarSecondaryAction"
               title={isRefreshingData ? "Data sedang dimuat" : "Refresh Data"}
               disabled={isRefreshingData}
               aria-label="Refresh data aplikasi"
             >
               <RefreshCcw className={cn("h-[1.2rem] w-[1.2rem]", isRefreshingData && "animate-spin")} />
             </Button>
             
            <ModeToggle />

            <NotificationBell onNavigate={handleNavigate} />
            
              <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="appUserTrigger" aria-label="Buka menu akun">
                   <div className="appUserAvatar">
                     {currentUser?.avatar ? (
                        <img src={currentUser.avatar} alt="User" />
                     ) : (
                        <div className="appUserFallback">
                            {currentUser?.name?.substring(0, 2).toUpperCase() || 'DU'}
                        </div>
                     )}
                   </div>
                   <div className="appUserMeta hidden lg:grid">
                      <strong>{currentUser?.name || 'User'}</strong>
                      <small>{currentUser?.role || 'Online'}</small>
                   </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="appDropdownPanel w-56">
                <DropdownMenuLabel className="appDropdownLabel">Akun Saya</DropdownMenuLabel>
                <DropdownMenuSeparator className="appDropdownSeparator" />
                <DropdownMenuItem onClick={() => handleNavigate('profile')} className="appDropdownItem cursor-pointer">
                  <User className="mr-2 h-4 w-4" />
                  <span>Profil</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="appDropdownSeparator" />
                <DropdownMenuItem onClick={handleLogout} className="appDropdownItem danger cursor-pointer">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Keluar</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

          </div>
        </header>
        )}

        {/* Page Content with bottom padding for mobile nav */}
        <div
          className={
            isFlushContentPage
              ? 'workspaceViewport flush'
              : cn('workspaceViewport withMobileNav', 'lg:pb-0')
          }
        >
           <React.Suspense fallback={<PageLoadingState />}>
             {renderContent()}
           </React.Suspense>
        </div>

        {/* Bottom Navigation (Mobile Only) */}
        {!permissionsLoading && (
        <BottomNav 
            activeTab={activeTab} 
            onRefresh={handleGlobalRefresh}
            isRefreshing={isRefreshingData}
            onNavigate={(id) => {
                if (id === 'menu' && !isTechnicianAppMode) {
                    setIsSidebarOpen(true);
                } else {
                    handleNavigate(id);
                }
            }} 
        />
        )}
      </main>

      <Toaster
        position="bottom-right"
        richColors
        closeButton
        duration={2200}
        visibleToasts={2}
        gap={8}
        offset={16}
        toastOptions={{
          className: 'appToast',
        }}
      />
    </div>
  );
}
