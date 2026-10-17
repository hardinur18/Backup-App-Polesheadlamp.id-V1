import React, { useState } from 'react';
import { 
  LayoutDashboard, Database, Users, Settings, LogOut, Shield,
  Megaphone, UserPlus, ClipboardList, Calendar, Map,
  Wallet, ArrowRightLeft, ScrollText, FileBarChart, Package, ShieldCheck, MessageSquare,
  Share2, RefreshCw, Briefcase, TrendingUp, DollarSign, Repeat, ChevronDown,
  FileText, Images, Target, Activity
} from 'lucide-react';
import { cn } from './ui/utils';
import appLogo from "@/assets/polesheadlamp-app-logo-round.png";
import { useMasterData } from '@/app/pages/master-data/context';
import { usePermissions } from '@/app/hooks/usePermissions';
import { PermissionKey } from '@/app/data/permissions';
import { isTechnicianRole } from '@/app/data/roleHelpers';
import { getAppRouteByTabId, getCanonicalAppPath } from '@/app/routing/appRouteRegistry';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  
} from "./ui/tooltip"

interface SidebarProps {
  activeTab: string;
  onNavigate: (id: string) => void;
  isCollapsed?: boolean;
  toggleSidebar?: () => void;
  onLogout?: () => void;
  mobileMode?: boolean;
}

type NavItem = {
    icon: any;
    label: string;
    id: string;
    permission?: PermissionKey;
    alternativePermissions?: PermissionKey[];
    children?: NavItem[];
    canNavigate?: boolean;
    ownerOnly?: boolean;
};

type NavGroup = {
    title: string;
    items: NavItem[];
};

type CollapsedFlyoutState = {
    item: NavItem;
    top: number;
};

const NAV_GROUPS: NavGroup[] = [
  {
    title: '', 
    items: [
      { 
        icon: LayoutDashboard, 
        label: 'Dashboard', 
        id: 'dashboard', 
        permission: 'dashboard.view',
      },
    ]
  },
  {
    title: 'OPERASIONAL',
    items: [
      {
        icon: Megaphone,
        label: 'Akuisisi & Iklan',
        id: 'ops-acquisition',
        canNavigate: false,
        children: [
          { icon: Megaphone, label: 'Iklan Harian', id: 'daily-ads', permission: 'ads.view_daily' },
          { icon: TrendingUp, label: 'Monitoring Iklan', id: 'ads-monitoring', permission: 'monitoring.marketing.view' },
          { icon: Target, label: 'OKR CS', id: 'cs-okr-report', permission: 'cs_okr.view' },
          { icon: Share2, label: 'Affiliate', id: 'affiliates', permission: 'affiliate.view' },
        ],
      },
      {
        icon: UserPlus,
        label: 'Prospek & Channel',
        id: 'ops-prospects',
        canNavigate: false,
        children: [
          { icon: UserPlus, label: 'Prospek', id: 'leads', permission: 'leads.view' },
          { icon: Users, label: 'Kontak', id: 'whatsapp-contacts', permission: 'whatsapp.view' },
          { icon: ClipboardList, label: 'Form Embed', id: 'embed-forms', permission: 'leads.view' },
          { icon: Images, label: 'Galeri Bukti', id: 'proof-assets', permission: 'proof_assets.view' },
        ],
      },
      {
        icon: MessageSquare,
        label: 'Live Chat',
        id: 'whatsapp',
        canNavigate: false,
        permission: 'whatsapp.view',
        children: [
          { icon: MessageSquare, label: 'Percakapan', id: 'whatsapp-chats', permission: 'whatsapp.view' },
          { icon: FileText, label: 'Template Pesan', id: 'whatsapp-templates', permission: 'whatsapp.templates.manage' },
          { icon: Settings, label: 'Akun WA', id: 'whatsapp-inbox-settings', permission: 'whatsapp.settings.manage' },
        ],
      },
      {
        icon: ClipboardList,
        label: 'Pesanan & Jadwal',
        id: 'ops-orders',
        canNavigate: false,
        children: [
          { icon: ClipboardList, label: 'Pesanan & Penugasan', id: 'orders', permission: 'order.view' },
          { icon: Calendar, label: 'Jadwal', id: 'schedule', permission: 'schedule.view' },
          {
            icon: FileBarChart,
            label: 'Laporan Operasional',
            id: 'daily-report',
            permission: 'daily_report.view',
            alternativePermissions: ['finance_report.view'],
          },
        ],
      },
      {
        icon: Briefcase,
        label: 'Teknisi & Lapangan',
        id: 'ops-field',
        canNavigate: false,
        children: [
          { icon: Calendar, label: 'Ketersediaan Teknisi', id: 'technician-schedule', permission: 'technician_schedule.view' },
          { icon: Calendar, label: 'Jadwal Saya', id: 'teknisi-mobile', permission: 'teknisi.view_mobile' },
          { icon: Briefcase, label: 'Aktivitas Teknisi', id: 'monitoring-activity', permission: 'monitoring.activity_view' },
          { icon: Activity, label: 'Pemantauan Lapangan', id: 'monitoring', permission: 'monitoring.view' },
          { icon: Map, label: 'Peta Sebaran', id: 'map', permission: 'map.view_global' },
        ],
      },
    ]
  },
  {
    title: 'KEUANGAN',
    items: [
      {
        icon: Wallet,
        label: 'Keuangan Operasional',
        id: 'finance-operations',
        canNavigate: false,
        children: [
          { icon: DollarSign, label: 'Payroll & Gaji', id: 'payroll', permission: 'payroll.view' },
          { icon: RefreshCw, label: 'Pengeluaran Rutin', id: 'recurring-expenses', permission: 'recurring_expenses.view' },
          { icon: ArrowRightLeft, label: 'Biaya Operasional', id: 'cashflow', permission: 'operational_expenses.view' },
          { icon: ScrollText, label: 'Hutang & Piutang', id: 'debts', permission: 'debts.view' },
        ],
      },
    ]
  },
  {
    title: 'ADMINISTRASI',
    items: [
      { 
        icon: Package, 
        label: 'Inventory', 
        id: 'inventory', 
        permission: 'inventory.view',
        children: [
            { icon: Database, label: 'Master Data Produk', id: 'inventory-products', permission: 'inventory.view' },
            { icon: Repeat, label: 'Transaksi & Mutasi', id: 'inventory-transactions', permission: 'stock.transaction.view' },
            { icon: TrendingUp, label: 'Laporan Valuasi', id: 'inventory-valuation', permission: 'stock.valuation.view' },
            { icon: Settings, label: 'Pengaturan Stok', id: 'inventory-settings', permission: 'stock.settings.manage' },
        ]
      },
      {
        icon: ShieldCheck,
        label: 'Sistem & Akses',
        id: 'admin-system',
        canNavigate: false,
        children: [
          { icon: Database, label: 'Master Data', id: 'master-data', permission: 'master_data.view' },
          { icon: ShieldCheck, label: 'Pengguna & Akses', id: 'users', permission: 'users.view' },
          { icon: Shield, label: 'Role & Permission', id: 'roles', permission: 'role_permissions.view' },
          { icon: Activity, label: 'Kontrol & Integrasi', id: 'usage-control', permission: 'role_permissions.view' },
          { icon: MessageSquare, label: 'Template WhatsApp', id: 'wa-templates', permission: 'wa_template.view' },
        ],
      },
    ]
  }
];

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onNavigate, isCollapsed = false, toggleSidebar, mobileMode = false, onLogout }) => {
  const { currentUser, currentRole } = useMasterData();
  const { hasPermission, viewAsRole } = usePermissions();
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [collapsedFlyout, setCollapsedFlyout] = useState<CollapsedFlyoutState | null>(null);
  const collapsedFlyoutRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
     // Auto expand parent if child is active
     NAV_GROUPS.forEach(group => {
         group.items.forEach(item => {
             if (item.children) {
                  // If activeTab is the parent itself OR one of the children
                  if (item.id === activeTab || item.children.some(child => child.id === activeTab)) {
                      setExpandedItems(prev => {
                          if (!prev.includes(item.id)) return [...prev, item.id];
                          return prev;
                      });
                  }
             }
         });
     });
  }, [activeTab]);

  React.useEffect(() => {
      if (!isCollapsed) {
          setCollapsedFlyout(null);
      }
  }, [isCollapsed]);

  React.useEffect(() => {
      if (!collapsedFlyout) return;

      const handlePointerDown = (event: PointerEvent) => {
          const target = event.target as Node | null;

          if (target && collapsedFlyoutRef.current?.contains(target)) return;
          if (target instanceof Element && target.closest('[data-collapsed-nav-trigger="true"]')) return;

          setCollapsedFlyout(null);
      };

      const handleKeyDown = (event: KeyboardEvent) => {
          if (event.key === 'Escape') {
              setCollapsedFlyout(null);
          }
      };

      document.addEventListener('pointerdown', handlePointerDown);
      document.addEventListener('keydown', handleKeyDown);

      return () => {
          document.removeEventListener('pointerdown', handlePointerDown);
          document.removeEventListener('keydown', handleKeyDown);
      };
  }, [collapsedFlyout]);

  const toggleExpand = (id: string) => {
      setExpandedItems(prev => 
          prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
      );
  };

  const getNavHref = (id: string) => {
      const route = getAppRouteByTabId(id);
      return route ? getCanonicalAppPath(route) : undefined;
  };

  const shouldUseBrowserDefault = (event: React.MouseEvent<HTMLAnchorElement>) =>
      event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;

  const scheduleBrowserFallback = (href?: string) => {
      if (!href) return;

      window.setTimeout(() => {
          const targetPath = new URL(href, window.location.origin).pathname;
          if (window.location.pathname !== targetPath) {
              window.location.assign(href);
          }
      }, 180);
  };

  const navigateItem = (id: string, href?: string) => {
      onNavigate(id);
      scheduleBrowserFallback(href);
  };

  const navigateChild = (child: NavItem, href?: string) => {
      navigateItem(child.id, href);
  };

  const openCollapsedFlyout = (item: NavItem, trigger: HTMLElement) => {
      setCollapsedFlyout(prev => {
          if (prev?.item.id === item.id) return null;

          const triggerRect = trigger.getBoundingClientRect();
          const rowCount = (item.canNavigate ? 1 : 0) + (item.children?.length || 0);
          const estimatedHeight = Math.min(520, 64 + rowCount * 44);
          const viewportPadding = 12;
          const maxTop = Math.max(viewportPadding, window.innerHeight - estimatedHeight - viewportPadding);
          const top = Math.min(Math.max(triggerRect.top, viewportPadding), maxTop);

          return { item, top };
      });
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const hasNavItemAccess = (item: NavItem) =>
      !item.permission ||
      hasPermission(item.permission) ||
      Boolean(item.alternativePermissions?.some(permission => hasPermission(permission)));

  const allowedForTeknisi = ['teknisi-mobile', 'dashboard', 'orders'];
  const isNavItemAllowedByRole = (item: NavItem, hasVisibleChildren = false) => {
      if (item.id === 'roles' && viewAsRole) return false;
      if (item.ownerOnly && currentRole !== 'Owner') return false;
      if (isTechnicianRole(currentRole)) {
          return allowedForTeknisi.includes(item.id) || hasVisibleChildren;
      }
      return true;
  };

  const filteredNavGroups = NAV_GROUPS.map(group => {
      const visibleItems = group.items.map(item => {
          // Filter children first if any
          let children = item.children;

          if (children) {
             children = children.filter(child => hasNavItemAccess(child) && isNavItemAllowedByRole(child));
          }

          const hasVisibleChildren = Boolean(children?.length);
          const hasOwnAccess = item.canNavigate === false ? false : hasNavItemAccess(item);

          // Check item itself
          let isVisible = isNavItemAllowedByRole(item, hasVisibleChildren);
          if (!hasOwnAccess && !hasVisibleChildren) {
              isVisible = false; 
          }

          if (!isVisible) return null;
          
          return { ...item, children, canNavigate: item.canNavigate ?? hasOwnAccess };
      }).filter((item) => item !== null) as NavItem[];
      
      return { ...group, items: visibleItems };
  }).filter(group => group.items.length > 0);

  return (
    <aside className={cn('sidebar', isCollapsed && 'collapsed', mobileMode && 'mobile')}>
      {/* Logo */}
      <div className="brand">
        {!mobileMode && toggleSidebar ? (
          <button
            className="brandMark brandToggle"
            type="button"
            title={isCollapsed ? 'Buka sidebar' : 'Tutup sidebar'}
            aria-label={isCollapsed ? 'Buka sidebar' : 'Tutup sidebar'}
            aria-expanded={!isCollapsed}
            onClick={toggleSidebar}
          >
            <img src={appLogo} alt="" />
          </button>
        ) : (
          <div className="brandMark">
            <img src={appLogo} alt="" />
          </div>
        )}
        {!isCollapsed && (
          <div className="brandText">
            <strong>RHI System</strong>
            <small>Restoration Headlamp</small>
          </div>
        )}
      </div>
      
      {/* Navigation */}
      <nav className="navList scrollbar-stable" aria-label="Menu aplikasi">
        <TooltipProvider delayDuration={0}>
          {filteredNavGroups.map((group, groupIndex) => (
              <section className="navGroup" aria-label={group.title || 'Utama'} key={groupIndex}>
                  {group.title && <span className="navGroupLabel">{group.title}</span>}
                  <div className="navGroupItems">
                      {group.items.map((item) => {
                          const hasChildren = item.children && item.children.length > 0;
                          
                          // Determine if parent is "active" (itself or one of its children)
                          const isChildActive = hasChildren && item.children?.some(child => child.id === activeTab);
                          const isActive = activeTab === item.id || isChildActive;
                          const isExpanded = expandedItems.includes(item.id);
                          const isCollapsedFlyoutOpen = collapsedFlyout?.item.id === item.id;

                          // Common Button Content
                          const renderIcon = () => (
                              <item.icon size={18} />
                          );

                          // Parent Item with Children
                          if (hasChildren) {
                              const handleParentClick = () => {
                                  toggleExpand(item.id);
                              };

                              if (isCollapsed) {
                                  return (
                                      <div
                                          key={item.id}
                                          className={cn('navBranch', (isActive || isCollapsedFlyoutOpen) && 'open')}
                                      >
                                          <button
                                              type="button"
                                              data-collapsed-nav-trigger="true"
                                              className={cn('navItem navItemParent', isActive && 'active')}
                                              aria-label={item.label}
                                              aria-haspopup="dialog"
                                              aria-expanded={isCollapsedFlyoutOpen}
                                              onClick={(event) => {
                                                openCollapsedFlyout(item, event.currentTarget);
                                              }}
                                          >
                                              {renderIcon()}
                                          </button>
                                      </div>
                                  );
                              }

                               return (
                                   <div key={item.id} className={cn('navBranch', isExpanded && 'open')}>
                                       <button
                                           type="button"
                                           onClick={handleParentClick}
                                           className={cn('navItem navItemParent', isActive && 'active')}
                                           aria-expanded={isExpanded}
                                       >
                                           {renderIcon()}
                                           {!isCollapsed && (
                                               <>
                                                   <span className="navLabel">{item.label}</span>
                                                   <ChevronDown className="navChevron" size={16} />
                                               </>
                                           )}
                                       </button>
                                       
                                       {/* Children Render (Only if Expanded & Not Collapsed) */}
                                       {!isCollapsed && isExpanded && (
                                           <div className="navSubList">
                                                {item.children?.map(child => {
                                                    const isChildActiveItem = activeTab === child.id;
                                                    const childHref = getNavHref(child.id);
                                                    
                                                    return (
                                                        <a
                                                            key={child.id}
                                                            href={childHref || '#'}
                                                            onClick={(event) => {
                                                                if (shouldUseBrowserDefault(event)) return;
                                                                event.preventDefault();
                                                                navigateChild(child, childHref);
                                                            }}
                                                            className={cn('navSubItem', isChildActiveItem && 'active')}
                                                        >
                                                            <child.icon size={15} />
                                                            <span>{child.label}</span>
                                                        </a>
                                                    );
                                                })}
                                           </div>
                                       )}
                                   </div>
                               );
                          }
                          
                          // Standard Single Item
                          const itemHref = getNavHref(item.id);
                          const ButtonContent = (
                              <a
                                  href={itemHref || '#'}
                                  onClick={(event) => {
                                      if (shouldUseBrowserDefault(event)) return;
                                      event.preventDefault();
                                      navigateItem(item.id, itemHref);
                                  }}
                                  className={cn('navItem', isActive && 'active')}
                              >
                                  {renderIcon()}
                                  {!isCollapsed && <span className="navLabel">{item.label}</span>}
                              </a>
                          );

                          if (isCollapsed) {
                              return (
                                  <Tooltip key={item.id}>
                                      <TooltipTrigger asChild>
                                          {ButtonContent}
                                      </TooltipTrigger>
                                      <TooltipContent side="right" className="bg-white text-slate-900 border-slate-200 shadow-lg ml-2 dark:bg-slate-900 dark:text-white dark:border-slate-800">
                                          {item.label}
                                      </TooltipContent>
                                  </Tooltip>
                              )
                          }

                          return <div key={item.id}>{ButtonContent}</div>;
                      })}
                  </div>
              </section>
          ))}
        </TooltipProvider>
      </nav>

      {isCollapsed && collapsedFlyout && (
        <div
          ref={collapsedFlyoutRef}
          className="navFlyout"
          style={{ top: collapsedFlyout.top }}
          role="dialog"
          aria-label={`Menu ${collapsedFlyout.item.label}`}
        >
          <span className="navFlyoutTitle">{collapsedFlyout.item.label}</span>
          <div className="navFlyoutDivider" />
          <div className="navFlyoutItems">
            {collapsedFlyout.item.canNavigate && (
              <a
                href={getNavHref(collapsedFlyout.item.id) || '#'}
                onClick={(event) => {
                  if (shouldUseBrowserDefault(event)) return;
                  event.preventDefault();
                  navigateItem(collapsedFlyout.item.id, getNavHref(collapsedFlyout.item.id));
                  setCollapsedFlyout(null);
                }}
                className={cn('navFlyoutItem', activeTab === collapsedFlyout.item.id && 'active')}
              >
                {React.createElement(collapsedFlyout.item.icon, { size: 15 })}
                <span>{collapsedFlyout.item.label}</span>
              </a>
            )}
            {collapsedFlyout.item.children?.map(child => {
              const isChildActiveItem = activeTab === child.id;
              const childHref = getNavHref(child.id);

              return (
                <a
                  key={child.id}
                  href={childHref || '#'}
                  onClick={(event) => {
                    if (shouldUseBrowserDefault(event)) return;
                    event.preventDefault();
                    navigateChild(child, childHref);
                    setCollapsedFlyout(null);
                  }}
                  className={cn('navFlyoutItem', isChildActiveItem && 'active')}
                >
                  <child.icon size={15} />
                  <span>{child.label}</span>
                </a>
              );
            })}
          </div>
        </div>
      )}

      <div className="sidebarUser">
        <button className="sidebarUserProfile" type="button" onClick={() => onNavigate('profile')} aria-label="Buka profil">
          <span className="userAvatar">
            {currentUser?.avatar ? <img src={currentUser.avatar} alt="" /> : getInitials(currentUser?.name || 'DU')}
          </span>
          <span className="userMeta">
            <strong>{currentUser?.name || 'User'}</strong>
            <small className="roleBadge">{viewAsRole ? `View: ${viewAsRole}` : currentUser?.role || 'Online'}</small>
          </span>
        </button>
        {onLogout && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="iconButton danger" type="button" aria-label="Keluar" onClick={onLogout}>
                <LogOut size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="bg-red-600 text-white border-red-500">
              Keluar
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </aside>
  );
};
