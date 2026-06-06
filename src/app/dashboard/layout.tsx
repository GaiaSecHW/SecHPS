'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Toaster } from 'react-hot-toast';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Activity,
  Award,
  Box,
  Brain,
  Bug,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Coins,
  GitBranch,
  Home,
  Key,
  LayoutDashboard,
  Layers,
  LogOut,
  Network,
  Server,
  Terminal,
  TrendingUp,
  User,
  Users,
  Zap,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { CSSProperties } from 'react';

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
  roles?: Array<'admin' | 'developer' | 'user'>;
  badge?: string;
};

type NavGroup = {
  id: 'workspace' | 'developer' | 'evolution' | 'admin';
  label: string;
  shortLabel: string;
  roles?: Array<'admin' | 'developer' | 'user'>;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'workspace',
    label: '工作台',
    shortLabel: '工作台',
    roles: ['user', 'developer', 'admin'],
    items: [
      { href: '/dashboard', label: '首页', icon: <Home size={18} />, exact: true, roles: ['user', 'developer', 'admin'] },
      { href: '/dashboard/overview', label: '仪表盘', icon: <LayoutDashboard size={18} />, roles: ['user', 'developer', 'admin'] },
      { href: '/dashboard/task-builder', label: '我的任务', icon: <ClipboardList size={18} />, roles: ['user', 'developer', 'admin'] },
    ],
  },
  {
    id: 'developer',
    label: '开发资产',
    shortLabel: '开发',
    roles: ['developer', 'admin'],
    items: [
      { href: '/dashboard/skills', label: 'Skill 市场', icon: <Award size={18} />, roles: ['developer', 'admin'] },
      { href: '/dashboard/mcp-servers', label: 'MCP 市场', icon: <Server size={18} />, roles: ['developer', 'admin'] },
      { href: '/dashboard/agent-apps', label: 'Agent 市场', icon: <Box size={18} />, roles: ['developer', 'admin'] },
      { href: '/dashboard/agentflow-pipelines', label: '工作流编排', icon: <Layers size={18} />, roles: ['developer', 'admin'], badge: '建设中' },
    ],
  },
  {
    id: 'evolution',
    label: '数据与进化',
    shortLabel: '进化',
    roles: ['developer', 'admin'],
    items: [
      { href: '/dashboard/evolution', label: '智能体进化', icon: <TrendingUp size={18} />, roles: ['developer', 'admin'], badge: '对接中' },
      { href: '/dashboard/knowledge-graph', label: '知识图谱', icon: <Network size={18} />, roles: ['developer', 'admin'] },
      { href: '/dashboard/data-feedback', label: '数据回流', icon: <GitBranch size={18} />, roles: ['developer', 'admin'] },
      { href: '/dashboard/evaluation', label: '测评基准', icon: <ClipboardCheck size={18} />, roles: ['developer', 'admin'], badge: '对接中' },
    ],
  },
  {
    id: 'admin',
    label: '系统管理',
    shortLabel: '管理',
    roles: ['admin'],
    items: [
      { href: '/dashboard/users', label: '用户管理', icon: <Users size={18} />, roles: ['admin'] },
      { href: '/dashboard/models', label: '模型管理', icon: <Zap size={18} />, roles: ['admin'] },
      { href: '/dashboard/admin/tenants', label: '租户管理', icon: <Layers size={18} />, roles: ['admin'] },
      { href: '/dashboard/admin/api-keys', label: 'API Key 管理', icon: <Key size={18} />, roles: ['admin'] },
      { href: '/dashboard/admin/sdk', label: '系统 SDK', icon: <Terminal size={18} />, roles: ['admin'] },
      { href: '/dashboard/admin/monitoring', label: '系统监控', icon: <Activity size={18} />, roles: ['admin'] },
      { href: '/dashboard/admin/vulnerabilities', label: '漏洞管理', icon: <Bug size={18} />, roles: ['admin'] },
      { href: '/dashboard/codeswarm', label: '智能体集群', icon: <Server size={18} />, roles: ['admin'] },
    ],
  },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </Suspense>
  );
}

function DashboardLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(searchParams.get('sidebar') === 'collapsed');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setSidebarCollapsed(true);
        setMobileSidebarOpen(false);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

    if (fcNewPassword.length < 6) {
      setFcError('新密码长度至少为 6 位');
      return;
    }
    if (fcNewPassword !== fcConfirmPassword) {
      setFcError('两次输入的密码不一致');
      return;
    }

    setFcLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/users/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
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

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  const roleSet = useMemo(() => new Set<string>(user?.roles || []), [user]);

  const canAccess = useCallback(
    (roles?: Array<'admin' | 'developer' | 'user'>) => {
      if (!roles || roles.length === 0) {
        return true;
      }
      if (roleSet.has('admin') && roles.includes('admin')) {
        return true;
      }
      if (roleSet.has('developer') && roles.includes('developer')) {
        return true;
      }
      return roles.includes('user');
    },
    [roleSet],
  );

  const visibleGroups = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => canAccess(item.roles)),
      })).filter((group) => canAccess(group.roles) && group.items.length > 0),
    [canAccess],
  );

  const activeGroup = useMemo(() => {
    for (const group of visibleGroups) {
      if (group.items.some((item) => isPathActive(pathname, item.href, item.exact))) {
        return group;
      }
    }
    return visibleGroups[0] ?? null;
  }, [pathname, visibleGroups]);

  const sidebarWidth = sidebarCollapsed ? 88 : 272;
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [pathname]);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-zinc-950">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <div className="fixed inset-x-0 top-0 z-40 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="flex h-16 items-center gap-3 px-4 md:px-6">
          <button
            onClick={() => setMobileSidebarOpen((prev) => !prev)}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-300 lg:hidden"
            title="切换侧栏"
          >
            <Layers size={18} />
          </button>

          <div className="min-w-0 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-500/15 text-cyan-400 ring-1 ring-cyan-500/20">
                <Brain size={18} />
              </div>
              <div className="hidden min-w-0 sm:block">
                <p className="text-sm font-semibold text-zinc-100">SecHPS</p>
                <p className="text-xs text-zinc-500">{user?.name || user?.username}</p>
              </div>
            </div>
          </div>

          <nav className="hidden min-w-0 flex-1 items-center justify-center gap-2 overflow-x-auto lg:flex">
            {visibleGroups.map((group) => {
              const active = group.id === activeGroup?.id;
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => router.push(group.items[0].href)}
                  className={`whitespace-nowrap rounded-2xl px-4 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-500/30'
                      : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                  }`}
                >
                  {group.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <div className="hidden rounded-2xl border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-right md:block">
              <p className="max-w-[200px] truncate text-sm font-medium text-zinc-100">{user?.name || user?.username}</p>
              <p className="max-w-[200px] truncate text-xs text-zinc-500">{user?.email}</p>
            </div>

            <div className="relative">
              <button
                onClick={() => setShowUserMenu((prev) => !prev)}
                className="flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-600 text-sm font-semibold text-white">
                  {user?.name?.charAt(0) || user?.username?.charAt(0) || 'U'}
                </div>
                <ChevronDown size={14} className={`transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
              </button>

              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setShowUserMenu(false)} />
                  <div className="absolute right-0 top-full z-30 mt-2 w-52 rounded-2xl border border-zinc-800 bg-zinc-900 p-1 shadow-xl">
                    <Link
                      href="/dashboard/profile"
                      onClick={() => setShowUserMenu(false)}
                      className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                    >
                      <User size={15} />
                      个人中心
                    </Link>
                    <Link
                      href="/dashboard/models"
                      onClick={() => setShowUserMenu(false)}
                      className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                    >
                      <Brain size={15} />
                      我的模型
                    </Link>
                    <Link
                      href="/dashboard/token-stats"
                      onClick={() => setShowUserMenu(false)}
                      className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                    >
                      <Coins size={15} />
                      Token 统计
                    </Link>
                    <div className="my-1 border-t border-zinc-800" />
                    <button
                      onClick={() => {
                        setShowUserMenu(false);
                        handleLogout();
                      }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
                    >
                      <LogOut size={15} />
                      退出登录
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-zinc-900 px-4 py-2 lg:hidden">
          <div className="flex items-center gap-2 overflow-x-auto">
            {visibleGroups.map((group) => {
              const active = group.id === activeGroup?.id;
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => router.push(group.items[0].href)}
                  className={`whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
                    active ? 'bg-cyan-500/15 text-cyan-300' : 'bg-zinc-900 text-zinc-400'
                  }`}
                >
                  {group.shortLabel}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {mobileSidebarOpen && <div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={() => setMobileSidebarOpen(false)} />}

      <aside
        className={`fixed top-16 z-30 h-[calc(100vh-4rem)] border-r border-zinc-800 bg-zinc-900/95 backdrop-blur transition-all duration-300 ease-in-out ${
          mobileSidebarOpen ? 'left-0' : '-left-full'
        } lg:left-0`}
        style={{ width: sidebarWidth }}
      >
        <div className={`flex h-full flex-col ${sidebarCollapsed ? 'px-2 py-3' : 'px-3 py-4'}`}>
          <div className={`mb-3 flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between px-2'}`}>
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <p className="truncate text-xs uppercase tracking-[0.24em] text-zinc-500">{activeGroup?.label || '导航'}</p>
                <p className="mt-1 text-sm font-medium text-zinc-200">当前模块菜单</p>
              </div>
            )}

            <button
              onClick={toggleSidebar}
              className="hidden h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-zinc-400 transition-colors hover:bg-cyan-600 hover:text-white lg:flex"
              title={sidebarCollapsed ? '展开菜单' : '收起菜单'}
            >
              {sidebarCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
            </button>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden custom-scrollbar sidebar-scrollbar">
            {(activeGroup?.items || []).map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                icon={item.icon}
                collapsed={sidebarCollapsed}
                exact={item.exact}
                pathname={pathname}
                badge={item.badge}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className={`border-t border-zinc-800/70 pt-3 ${sidebarCollapsed ? 'px-1' : 'px-2'}`}>
            <button
              onClick={handleLogout}
              className={`flex w-full items-center rounded-xl px-3 py-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 ${sidebarCollapsed ? 'justify-center' : 'gap-3'}`}
              title={sidebarCollapsed ? '退出登录' : undefined}
            >
              <LogOut size={18} className="flex-shrink-0" />
              {!sidebarCollapsed && <span className="truncate text-sm">退出登录</span>}
            </button>
          </div>
        </div>
      </aside>

      <div
        className="fixed right-0 top-16 bottom-0 flex flex-col transition-all duration-300 ease-in-out lg:left-[var(--dashboard-sidebar-width)]"
        style={{ '--dashboard-sidebar-width': `${sidebarWidth}px` } as CSSProperties}
      >
        <main
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-zinc-950 custom-scrollbar content-scrollbar"
        >
          <div
            className="w-full min-h-full p-4 md:p-6 lg:p-6 transition-all duration-300 ease-in-out"
            style={{ paddingLeft: 16 }}
          >
            <div
              className="mx-auto w-full max-w-screen-2xl transition-all duration-300 ease-in-out"
              style={{ marginLeft: 0 }}
            >
              <ErrorBoundary>
                <div
                  className="transition-all duration-300 ease-in-out"
                  style={{ paddingLeft: 0 }}
                >
                  {children}
                </div>
              </ErrorBoundary>
            </div>
          </div>
        </main>
      </div>

      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#18181B',
            color: '#FAFAFA',
            border: '1px solid #27272A',
          },
          success: {
            style: {
              background: '#065F46',
              border: '1px solid #059669',
            },
          },
          error: {
            style: {
              background: '#7F1D1D',
              border: '1px solid #DC2626',
            },
          },
        }}
      />

      {forceChangePassword && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80">
          <div className="mx-4 w-full max-w-md rounded-xl border border-gray-700/50 bg-dark-surface shadow-2xl">
            <div className="border-b border-gray-700/50 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">首次登录 — 修改初始密码</h3>
              <p className="mt-1 text-sm text-gray-400">请修改初始密码后方可使用系统</p>
            </div>
            <form className="space-y-4 p-6" onSubmit={handleForceChangePassword}>
              {fcError && (
                <div className="rounded-lg border border-red-500/30 bg-red-900/20 px-4 py-3 text-sm text-red-400">{fcError}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-300">
                  新密码 <span className="text-red-400">*</span>
                </label>
                <input
                  type="password"
                  required
                  value={fcNewPassword}
                  onChange={(e) => setFcNewPassword(e.target.value)}
                  minLength={6}
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-dark-bg px-3 py-2 text-gray-100 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="至少 6 位"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300">
                  确认新密码 <span className="text-red-400">*</span>
                </label>
                <input
                  type="password"
                  required
                  value={fcConfirmPassword}
                  onChange={(e) => setFcConfirmPassword(e.target.value)}
                  minLength={6}
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-dark-bg px-3 py-2 text-gray-100 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="再次输入新密码"
                />
              </div>
              <button
                type="submit"
                disabled={fcLoading}
                className="w-full rounded-md bg-primary-500 px-4 py-2.5 font-medium text-white disabled:opacity-50 hover:bg-primary-400"
              >
                {fcLoading ? '提交中...' : '确认修改并重新登录'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function isPathActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
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
  const isActive = isPathActive(pathname, href, exact);

  return (
    <Link
      href={href}
      className={`group flex items-center rounded-2xl transition-colors ${
        isActive
          ? 'bg-cyan-500/15 text-cyan-300 ring-1 ring-inset ring-cyan-500/20'
          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
      } ${collapsed ? 'justify-center px-2 py-3' : 'gap-3 px-3 py-2.5'}`}
      title={collapsed ? String(children) : undefined}
    >
      <span className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center">{icon}</span>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate text-sm">{children}</span>
          {badge && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${isActive ? 'bg-cyan-400/15 text-cyan-200' : 'bg-zinc-800 text-zinc-500'}`}>
              {badge}
            </span>
          )}
        </>
      )}
    </Link>
  );
}
