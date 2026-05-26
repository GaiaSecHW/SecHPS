'use client';

import { Suspense, useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Toaster } from 'react-hot-toast';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  LayoutDashboard,
  Users,
  LogOut,
  ClipboardCheck,
  User,
  Award,
  Bug,
  TrendingUp,
  Zap,
  Activity,
  Terminal,
  Server,
  Layers,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Coins,
  GitBranch,
  ClipboardList,
  Box,
  Key,
  Network,
  X,
  ArrowLeft,
  Home,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

// --- Page title & icon mapping ---

import type { ReactNode } from 'react';

const PAGE_META: Record<string, { title: string; icon: ReactNode }> = {
  '/dashboard': { title: '首页', icon: <Home size={20} /> },
  '/dashboard/overview': { title: '仪表盘', icon: <LayoutDashboard size={20} /> },
  '/dashboard/task-builder': { title: '我的任务', icon: <ClipboardList size={20} /> },
  '/dashboard/skills': { title: 'Skill 市场', icon: <Award size={20} /> },
  '/dashboard/skills/create': { title: '快速创建', icon: <Award size={20} /> },
  '/dashboard/skills/create-wizard': { title: '引导创建', icon: <Award size={20} /> },
  '/dashboard/skills/import-create': { title: '导入创建', icon: <Award size={20} /> },
  '/dashboard/mcp-servers': { title: 'MCP 市场', icon: <Server size={20} /> },
  '/dashboard/agent-apps': { title: 'Agent 市场', icon: <Box size={20} /> },
  '/dashboard/agent-apps/developer-guide': { title: '开发者指南', icon: <Box size={20} /> },
  '/dashboard/agentflow-pipelines': { title: '工作流编排', icon: <Layers size={20} /> },
  '/dashboard/evolution': { title: '智能体进化', icon: <TrendingUp size={20} /> },
  '/dashboard/knowledge-graph': { title: '知识图谱', icon: <Network size={20} /> },
  '/dashboard/data-feedback': { title: '数据回流', icon: <GitBranch size={20} /> },
  '/dashboard/evaluation': { title: '测评基准', icon: <ClipboardCheck size={20} /> },
  '/dashboard/users': { title: '用户管理', icon: <Users size={20} /> },
  '/dashboard/models': { title: '模型管理', icon: <Zap size={20} /> },
  '/dashboard/admin/tenants': { title: '租户管理', icon: <Layers size={20} /> },
  '/dashboard/admin/api-keys': { title: 'API Key 管理', icon: <Key size={20} /> },
  '/dashboard/admin/sdk': { title: '系统 SDK', icon: <Terminal size={20} /> },
  '/dashboard/admin/monitoring': { title: '系统监控', icon: <Activity size={20} /> },
  '/dashboard/admin/vulnerabilities': { title: '漏洞管理', icon: <Bug size={20} /> },
  '/dashboard/codeswarm': { title: '智能体集群', icon: <Server size={20} /> },
  '/dashboard/profile': { title: '个人中心', icon: <User size={20} /> },
  '/dashboard/token-stats': { title: 'Token 统计', icon: <Coins size={20} /> },
  '/dashboard/plugins': { title: '插件管理', icon: <Box size={20} /> },
  '/dashboard/config': { title: '系统配置', icon: <Activity size={20} /> },
};

function getPageMeta(pathname: string): { title: string; icon: ReactNode } | null {
  if (PAGE_META[pathname]) return PAGE_META[pathname];
  return null;
}

function getParentMeta(pathname: string): { path: string; title: string; icon: ReactNode } | null {
  const match = Object.keys(PAGE_META)
    .filter(k => k !== pathname && k !== '/dashboard' && pathname.startsWith(k + '/'))
    .sort((a, b) => b.length - a.length)[0];
  return match ? { path: match, ...PAGE_META[match] } : null;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </Suspense>
  );
}

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(searchParams.get('sidebar') === 'collapsed');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [banner, setBanner] = useState<{ content: string; color: string } | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024 && !sidebarCollapsed) {
        setSidebarCollapsed(true);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [sidebarCollapsed]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');
    if (!token || !userData) {
      router.push('/login');
      return;
    }
    try {
      setUser(JSON.parse(userData));
    } catch {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      document.cookie = 'auth-token=; path=/; max-age=0';
      router.push('/login');
      return;
    }
    setLoading(false);
  }, [router]);

  useEffect(() => {
    fetch('/api/broadcast')
      .then(res => res.json())
      .then(data => {
        if (data.config?.enabled && data.config?.content) {
          const key = `banner-dismissed-${btoa(data.config.content).slice(0, 16)}`;
          if (!sessionStorage.getItem(key)) {
            setBanner({ content: data.config.content, color: data.config.color || 'blue' });
          }
        }
      })
      .catch(() => {});
  }, []);

  // 强制改密
  const [forceChangePassword, setForceChangePassword] = useState(false);
  const [fcNewPassword, setFcNewPassword] = useState('');
  const [fcConfirmPassword, setFcConfirmPassword] = useState('');
  const [fcError, setFcError] = useState('');
  const [fcLoading, setFcLoading] = useState(false);

  useEffect(() => {
    if (user?.mustChangePassword) {
      setForceChangePassword(true);
    }
  }, [user]);

  const handleForceChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setFcError('');
    if (fcNewPassword.length < 6) { setFcError('新密码长度至少为 6 位'); return; }
    if (fcNewPassword !== fcConfirmPassword) { setFcError('两次输入的密码不一致'); return; }
    setFcLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/users/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ newPassword: fcNewPassword, forceChange: true }),
      });
      if (!response.ok) {
        const data = await response.json();
        setFcError(data.details?.error || data.error || '修改密码失败');
        setFcLoading(false);
        return;
      }
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      document.cookie = 'auth-token=; path=/; max-age=0';
      router.push('/login');
    } catch {
      setFcError('网络错误，请重试');
      setFcLoading(false);
    }
  };

  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    document.cookie = 'auth-token=; path=/; max-age=0';
    router.push('/login');
  }, [router]);

  const dismissBanner = useCallback(() => {
    if (banner) {
      const key = `banner-dismissed-${btoa(banner.content).slice(0, 16)}`;
      sessionStorage.setItem(key, '1');
    }
    setBannerDismissed(true);
  }, [banner]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => !prev);
  }, []);

  const sidebarWidth = sidebarCollapsed ? 64 : 240;
  const pageMeta = getPageMeta(pathname);
  const parentMeta = getParentMeta(pathname);
  const isSubPage = parentMeta !== null;

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-dark-bg">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-dark-bg">
      <div className="flex h-full">
        {/* Sidebar */}
        <aside
          className="fixed left-0 top-0 h-screen bg-dark-surface border-r border-dark-border flex flex-col transition-all duration-300 ease-in-out z-30"
          style={{ width: sidebarWidth }}
        >
          <button
            onClick={toggleSidebar}
            className="absolute -right-3 top-6 z-40 flex h-6 w-6 items-center justify-center rounded-full bg-dark-surface-hover text-dark-text-secondary hover:bg-indigo-600 hover:text-white transition-colors shadow-lg border border-dark-border"
            title={sidebarCollapsed ? '展开菜单' : '收起菜单'}
          >
            {sidebarCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
          </button>

          {/* Brand */}
          <div className={`border-b border-dark-border overflow-hidden flex items-center ${sidebarCollapsed ? 'h-14 justify-center px-3' : 'h-14 px-5'}`}>
            {sidebarCollapsed ? (
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
                <span className="text-white text-xs font-bold">S</span>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-bold">S</span>
                </div>
                <span className="text-lg font-semibold text-dark-text">SecHPS</span>
              </div>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-2 space-y-0.5 custom-scrollbar sidebar-scrollbar">
            {!sidebarCollapsed && (
              <div className="pt-3 pb-1 px-4">
                <p className="text-[10px] text-dark-text-muted uppercase tracking-widest font-medium">使用者视图</p>
              </div>
            )}
            {sidebarCollapsed && <div className="pt-3 mx-3 border-t border-dark-border" />}

            <NavLink href="/dashboard" icon={<Home size={18} />} collapsed={sidebarCollapsed} exact pathname={pathname}>
              首页
            </NavLink>
            <NavLink href="/dashboard/overview" icon={<LayoutDashboard size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
              仪表盘
            </NavLink>
            <NavLink href="/dashboard/task-builder" icon={<ClipboardList size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
              我的任务
            </NavLink>

            {(user?.roles?.includes('developer') || user?.roles?.includes('admin')) && (
              <>
                {!sidebarCollapsed && (
                  <div className="pt-5 pb-1 px-4">
                    <p className="text-[10px] text-dark-text-muted uppercase tracking-widest font-medium">开发者视图</p>
                  </div>
                )}
                {sidebarCollapsed && <div className="pt-3 mx-3 border-t border-dark-border" />}

                <NavLink href="/dashboard/skills" icon={<Award size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
                  Skill市场
                </NavLink>
                <NavLink href="/dashboard/mcp-servers" icon={<Server size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
                  MCP市场
                </NavLink>
                <NavLink href="/dashboard/agent-apps" icon={<Box size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
                  Agent市场
                </NavLink>
                <NavLink href="/dashboard/agentflow-pipelines" icon={<Layers size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
                  工作流编排
                </NavLink>
              </>
            )}

            {(user?.isIcsTenant || user?.roles?.includes('admin')) && (
              <>
                {!sidebarCollapsed && (
                  <div className="pt-5 pb-1 px-4">
                    <p className="text-[10px] text-dark-text-muted uppercase tracking-widest font-medium">数据与进化</p>
                  </div>
                )}
                {sidebarCollapsed && <div className="pt-3 mx-3 border-t border-dark-border" />}

                <NavLink href="/dashboard/evolution" icon={<TrendingUp size={18} />} collapsed={sidebarCollapsed} pathname={pathname} badge="Beta">
                  智能体进化
                </NavLink>
                <NavLink href="/dashboard/knowledge-graph" icon={<Network size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
                  知识图谱
                </NavLink>
                <NavLink href="/dashboard/data-feedback" icon={<GitBranch size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
                  数据回流
                </NavLink>
                <NavLink href="/dashboard/evaluation" icon={<ClipboardCheck size={18} />} collapsed={sidebarCollapsed} pathname={pathname} badge="Beta">
                  测评基准
                </NavLink>
              </>
            )}

            {user?.roles?.includes('admin') && (
              <>
                {!sidebarCollapsed && (
                  <div className="pt-5 pb-1 px-4">
                    <p className="text-[10px] text-dark-text-muted uppercase tracking-widest font-medium">管理员视图</p>
                  </div>
                )}
                {sidebarCollapsed && <div className="pt-3 mx-3 border-t border-dark-border" />}

                <NavLink href="/dashboard/users" icon={<Users size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
                  用户管理
                </NavLink>
                <NavLink href="/dashboard/models" icon={<Zap size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
                  模型管理
                </NavLink>
                <NavLink href="/dashboard/admin/tenants" icon={<Layers size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
                  租户管理
                </NavLink>
                <NavLink href="/dashboard/admin/api-keys" icon={<Key size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
                  API Key 管理
                </NavLink>
                <NavLink href="/dashboard/admin/sdk" icon={<Terminal size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
                  系统SDK
                </NavLink>
                <NavLink href="/dashboard/admin/monitoring" icon={<Activity size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
                  系统监控
                </NavLink>
                <NavLink href="/dashboard/admin/vulnerabilities" icon={<Bug size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
                  漏洞管理
                </NavLink>
                <NavLink href="/dashboard/codeswarm" icon={<Server size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
                  智能体集群
                </NavLink>
              </>
            )}
          </nav>

          {/* User section at bottom */}
          <div className="border-t border-dark-border flex-shrink-0 relative" ref={userMenuRef}>
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className={`flex items-center w-full transition-colors hover:bg-dark-surface-hover ${sidebarCollapsed ? 'justify-center p-3' : 'gap-2.5 px-4 py-3'}`}
            >
              <div className="w-8 h-8 rounded-full bg-indigo-600/80 flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
                {user?.name?.charAt(0) || user?.username?.charAt(0) || 'U'}
              </div>
              {!sidebarCollapsed && (
                <>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-sm text-dark-text truncate">{user?.name || user?.username}</p>
                    <p className="text-[11px] text-dark-text-muted truncate">{user?.email}</p>
                  </div>
                  <ChevronUp size={14} className={`text-dark-text-muted transition-transform ${showUserMenu ? '' : 'rotate-180'}`} />
                </>
              )}
            </button>

            {showUserMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                <div className={`absolute bottom-full mb-1 bg-dark-surface-hover border border-dark-border rounded-lg shadow-xl z-50 py-1 ${sidebarCollapsed ? 'left-2 w-48' : 'left-2 right-2'}`}>
                  <Link
                    href="/dashboard/profile"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-dark-text-secondary hover:bg-dark-border hover:text-dark-text transition-colors"
                  >
                    <User size={15} />
                    个人中心
                  </Link>
                  <Link
                    href="/dashboard/token-stats"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-dark-text-secondary hover:bg-dark-border hover:text-dark-text transition-colors"
                  >
                    <Coins size={15} />
                    Token 统计
                  </Link>
                  <div className="my-1 border-t border-dark-border" />
                  <button
                    onClick={() => { setShowUserMenu(false); handleLogout(); }}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-dark-text-secondary hover:bg-red-500/10 hover:text-red-400 transition-colors w-full"
                  >
                    <LogOut size={15} />
                    退出登录
                  </button>
                </div>
              </>
            )}
          </div>
        </aside>

        {/* Main area */}
        <div
          className="fixed right-0 top-0 h-screen flex flex-col transition-all duration-300 ease-in-out z-20"
          style={{ left: sidebarWidth }}
        >
          {/* Header */}
          <header className="h-14 bg-dark-surface/80 backdrop-blur-sm border-b border-dark-border flex-shrink-0 px-[3.5rem] md:px-[4rem]">
            <div className="h-full flex items-center gap-2.5 w-full max-w-screen-2xl mx-auto">
              {isSubPage ? (
                <>
                  <button onClick={() => router.back()} className="p-1 -ml-1 mr-1 text-dark-text-muted hover:text-dark-text rounded-md hover:bg-dark-surface-hover transition-colors">
                    <ArrowLeft size={18} />
                  </button>
                  <Link href={parentMeta!.path} className="flex items-center gap-2 text-dark-text-muted hover:text-dark-text-secondary transition-colors">
                    <span className="text-dark-text-muted">{parentMeta!.icon}</span>
                    <span className="text-sm">{parentMeta!.title}</span>
                  </Link>
                  <span className="text-dark-text-muted text-sm">/</span>
                  <span className="text-sm font-medium text-dark-text">{pageMeta?.title || '详情'}</span>
                </>
              ) : (
                <>
                  {pageMeta && <span className="text-dark-text-secondary">{pageMeta.icon}</span>}
                  <h1 className="text-lg font-semibold text-dark-text">{pageMeta?.title || ''}</h1>
                </>
              )}
            </div>
          </header>

          {/* Notification Banner */}
          {banner && !bannerDismissed && <NotificationBanner content={banner.content} color={banner.color} onDismiss={dismissBanner} />}

          {/* Main content */}
          <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-dark-bg custom-scrollbar content-scrollbar">
            <div className="w-full min-h-full p-4 md:p-6">
              <div className="w-full max-w-screen-2xl mx-auto">
                <ErrorBoundary>
                  {children}
                </ErrorBoundary>
              </div>
            </div>
          </main>
        </div>
      </div>

      {/* 强制改密弹框 */}
      {forceChangePassword && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]">
          <div className="bg-dark-surface border border-dark-border rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <h2 className="text-lg font-semibold text-dark-text mb-2">修改密码</h2>
            <p className="text-sm text-dark-text-muted mb-4">首次登录需要修改密码后才能继续使用</p>
            <form onSubmit={handleForceChangePassword} className="space-y-4">
              {fcError && <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-3 py-2 rounded-lg text-sm">{fcError}</div>}
              <div>
                <label className="block text-sm text-dark-text-secondary mb-1">新密码</label>
                <input type="password" value={fcNewPassword} onChange={e => setFcNewPassword(e.target.value)} className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-dark-text focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500" placeholder="至少 6 位" required />
              </div>
              <div>
                <label className="block text-sm text-dark-text-secondary mb-1">确认密码</label>
                <input type="password" value={fcConfirmPassword} onChange={e => setFcConfirmPassword(e.target.value)} className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-dark-text focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500" placeholder="再次输入新密码" required />
              </div>
              <button type="submit" disabled={fcLoading} className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors text-sm font-medium disabled:opacity-50">
                {fcLoading ? '提交中...' : '确认修改'}
              </button>
            </form>
          </div>
        </div>
      )}

      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: { background: '#2c2c2e', color: '#e5e5e5', border: '1px solid #3a3a3c' },
          success: { style: { background: '#064e3b', border: '1px solid #059669' } },
          error: { style: { background: '#7f1d1d', border: '1px solid #dc2626' } },
        }}
      />
    </div>
  );
}

function NotificationBanner({ content, color, onDismiss }: { content: string; color: string; onDismiss: () => void }) {
  const colorStyles: Record<string, string> = {
    blue: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-200',
    yellow: 'bg-amber-500/10 border-amber-500/30 text-amber-200',
    red: 'bg-red-500/10 border-red-500/30 text-red-200',
    green: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200',
  };
  const style = colorStyles[color] || colorStyles.blue;

  return (
    <div className={`flex items-center justify-between px-4 py-2 border-b text-sm ${style}`}>
      <span>{content}</span>
      <button onClick={onDismiss} className="ml-3 p-0.5 rounded hover:bg-white/10 transition-colors flex-shrink-0">
        <X size={14} />
      </button>
    </div>
  );
}

function NavLink({
  href,
  icon,
  children,
  collapsed,
  exact,
  pathname,
  badge,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  collapsed?: boolean;
  exact?: boolean;
  pathname: string;
  badge?: string;
}) {
  const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/');

  return (
    <Link
      href={href}
      className={`flex items-center px-3 py-2 mx-2 rounded-lg transition-colors text-sm ${
        isActive
          ? 'bg-indigo-500/10 text-indigo-400 font-medium'
          : 'text-dark-text-secondary hover:bg-dark-surface-hover hover:text-dark-text'
      } ${collapsed ? 'justify-center' : 'gap-3'}`}
      title={collapsed ? String(children) : undefined}
    >
      <span className="flex-shrink-0 w-[18px] h-[18px]">{icon}</span>
      {!collapsed && (
        <>
          <span className="truncate min-w-0">{children}</span>
          {badge && <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-dark-surface-hover text-dark-text-muted">{badge}</span>}
        </>
      )}
    </Link>
  );
}
