'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Toaster } from 'react-hot-toast';
import { BroadcastMarquee } from '@/components/BroadcastMarquee';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  LayoutDashboard,
  Users,
  Settings,
  MessageSquare,
  LogOut,
  Cog,
  User,
  Clock,
  Award,
  Bug,
  TrendingUp,
  Brain,
  Zap,
  Code,
  Shield,
  Search,
  Terminal,
  Puzzle,
  Server,
  Tags,
  Layers,
  ChevronLeft,
  ChevronRight,
  Coins,
  GitBranch,
  Megaphone,
  ClipboardList,
  Box,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

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
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [collapsed, setCollapsed] = useState(searchParams.get('sidebar') === 'collapsed');

  useEffect(() => {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');

    if (!token || !userData) {
      console.log('Redirecting to login - missing token or userData');
      router.push('/login');
      return;
    }

    try {
      const parsedUser = JSON.parse(userData);
      setUser(parsedUser);
    } catch (e) {
      console.error('Failed to parse user data:', e);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      document.cookie = 'auth-token=; path=/; max-age=0';
      router.push('/login');
      return;
    }
    setLoading(false);
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    document.cookie = 'auth-token=; path=/; max-age=0';
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-bg">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Sidebar */}
      <div
        className={`fixed left-0 top-0 h-screen ${collapsed ? 'w-16' : 'w-56'} bg-[#0F172A] text-gray-300 flex flex-col transition-all duration-300 ease-in-out z-20 border-r border-gray-800/50`}
      >
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-6 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-dark-surface text-gray-400 hover:bg-primary-600 hover:text-white transition-colors shadow-lg border border-gray-700"
          title={collapsed ? '展开菜单' : '收起菜单'}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>

        {/* Brand */}
        <div className={`border-b border-gray-800/60 overflow-hidden ${collapsed ? 'p-3' : 'px-5 py-5'}`}>
          {collapsed ? (
            <div className="flex justify-center">
              <Brain size={22} className="text-primary-400" />
            </div>
          ) : (
            <>
              <h1 className="text-base font-bold text-gray-100 tracking-wide">AI4WEB 平台</h1>
              <p className="text-xs text-gray-500 mt-1">
                {user?.name || user?.username}
              </p>
            </>
          )}
        </div>

        <nav className="flex-1 py-2 space-y-0.5 overflow-y-auto overflow-x-hidden custom-scrollbar sidebar-scrollbar">
          <NavLink href="/dashboard" icon={<LayoutDashboard size={18} />} collapsed={collapsed} exact>
            仪表盘
          </NavLink>
          <NavLink href="/dashboard/sessions" icon={<MessageSquare size={18} />} collapsed={collapsed}>
            我的项目
          </NavLink>
          <NavLink href="/dashboard/task-builder" icon={<ClipboardList size={18} />} collapsed={collapsed}>
            任务实例
          </NavLink>

          {/* Developer section */}
          {(user?.roles?.includes('developer') || user?.roles?.includes('admin')) && (
            <>
              {!collapsed && (
                <div className="pt-5 pb-1 px-4">
                  <p className="text-[10px] text-gray-400 uppercase tracking-widest font-medium">开发者视图</p>
                </div>
              )}
              {collapsed && <div className="pt-3 mx-3 border-t border-gray-800/60" />}

              <NavLink href="/dashboard/workflows" icon={<GitBranch size={18} />} collapsed={collapsed}>
                开发者编排
              </NavLink>
              <NavLink href="/dashboard/skills" icon={<Award size={18} />} collapsed={collapsed}>
                Skills 管理
              </NavLink>
              <NavLink href="/dashboard/mcp-servers" icon={<Server size={18} />} collapsed={collapsed}>
                MCP 服务器
              </NavLink>
              <NavLink href="/dashboard/agent-apps" icon={<Box size={18} />} collapsed={collapsed}>
                Agent应用开发
              </NavLink>
            </>
          )}

          {/* Personal section */}
          {!collapsed && (
            <div className="pt-5 pb-1 px-4">
              <p className="text-[10px] text-gray-400 uppercase tracking-widest font-medium">个人</p>
            </div>
          )}
          {collapsed && <div className="pt-3 mx-3 border-t border-gray-800/60" />}
          <NavLink href="/dashboard/profile" icon={<User size={18} />} collapsed={collapsed}>
            个人中心
          </NavLink>
          <NavLink href="/dashboard/models" icon={<Brain size={18} />} collapsed={collapsed}>
            我的模型
          </NavLink>
          <NavLink href="/dashboard/token-stats" icon={<Coins size={18} />} collapsed={collapsed}>
            Token 统计
          </NavLink>

          {/* Admin section */}
          {user?.roles?.includes('admin') && (
            <>
              {!collapsed && (
                <div className="pt-5 pb-1 px-4">
                  <p className="text-[10px] text-gray-400 uppercase tracking-widest font-medium">管理员</p>
                </div>
              )}
              {collapsed && <div className="pt-3 mx-3 border-t border-gray-800/60" />}
              <NavLink href="/dashboard/users" icon={<Users size={18} />} collapsed={collapsed}>
                用户管理
              </NavLink>
              <NavLink href="/dashboard/admin/tenants" icon={<Layers size={18} />} collapsed={collapsed}>
                租户管理
              </NavLink>
              {/* <NavLink href="/dashboard/roles" icon={<Settings size={18} />} collapsed={collapsed}>
                角色权限
              </NavLink> */}
              <NavLink href="/dashboard/config" icon={<Cog size={18} />} collapsed={collapsed}>
                系统配置
              </NavLink>
              <NavLink href="/dashboard/admin/broadcast" icon={<Megaphone size={18} />} collapsed={collapsed}>
                通知广播
              </NavLink>
              {/* <NavLink href="/dashboard/plugins" icon={<Puzzle size={18} />} collapsed={collapsed}>
                插件管理
              </NavLink> */}
              <NavLink href="/dashboard/admin/vulnerability-patterns" icon={<Shield size={18} />} collapsed={collapsed}>
                漏洞模式
              </NavLink>
              <NavLink href="/dashboard/admin/vulnerabilities" icon={<Bug size={18} />} collapsed={collapsed}>
                漏洞管理
              </NavLink>
              <NavLink href="/dashboard/admin/skills-evolution" icon={<TrendingUp size={18} />} collapsed={collapsed}>
                Skills 进化
              </NavLink>
              <NavLink href="/dashboard/admin/skills-governance" icon={<Shield size={18} />} collapsed={collapsed}>
                Skills 治理
              </NavLink>
              <NavLink href="/dashboard/admin/autonomous-evolution" icon={<Brain size={18} />} collapsed={collapsed}>
                执行过程进化
              </NavLink>
              <NavLink href="/dashboard/tech-stack" icon={<Layers size={18} />} collapsed={collapsed}>
                技术栈管理
              </NavLink>
              {/* <NavLink href="/dashboard/admin/tools" icon={<Cog size={18} />} collapsed={collapsed}>
                工具管理
              </NavLink> */}
              <NavLink href="/dashboard/admin/default-tool-permissions" icon={<Shield size={18} />} collapsed={collapsed}>
                默认工具权限
              </NavLink>
              <NavLink href="/dashboard/admin/fsm-templates" icon={<Layers size={18} />} collapsed={collapsed}>
                威胁建模配置
              </NavLink>
              <NavLink href="/dashboard/codeswarm" icon={<Server size={18} />} collapsed={collapsed}>
                CodeSwarm
              </NavLink>
              <NavLink href="/dashboard/admin/categories" icon={<Tags size={18} />} collapsed={collapsed}>
                漏洞分类管理
              </NavLink>
            </>
          )}
        </nav>

        <div className={`border-t border-gray-800/60 ${collapsed ? 'p-2' : 'p-3'}`}>
          <button
            onClick={handleLogout}
            className={`flex items-center text-gray-500 hover:text-gray-200 transition-colors w-full rounded-md px-2 py-2 hover:bg-dark-surface-hover ${collapsed ? 'justify-center' : 'space-x-2'}`}
            title={collapsed ? '退出登录' : undefined}
          >
            <LogOut size={18} className="flex-shrink-0" />
            {!collapsed && <span className="text-sm">退出登录</span>}
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className={`fixed right-0 top-0 h-screen ${collapsed ? 'left-16' : 'left-56'} bg-dark-bg overflow-hidden flex flex-col transition-all duration-300`}>
        {/* Header */}
        <header className="bg-dark-surface border-b border-gray-800/60 flex-shrink-0">
          <div className="h-14 flex items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="flex items-center space-x-4 flex-1 mr-6">
              <h2 className="text-sm font-semibold text-gray-300 whitespace-nowrap">
                AI4WEB 测试平台
              </h2>
              <BroadcastMarquee />
            </div>

            <div className="flex items-center space-x-4">
              {user?.avatar && (
                <img
                  src={user.avatar}
                  alt={user.name || user.username}
                  className="h-8 w-8 rounded-full ring-2 ring-gray-700"
                />
              )}
              <div className="text-sm">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-200">
                    {user?.name || user?.username}
                  </p>
                  {user?.tenantId && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary-500/15 text-primary-400 border border-primary-500/20">
                      {user?.tenantName || '租户'}
                    </span>
                  )}
                  {user?.isIcsTenant && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-500/15 text-purple-400 border border-purple-500/20">
                      ICSL
                    </span>
                  )}
                  {user?.roles?.includes('admin') && !user?.tenantId && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/20">
                      平台管理员
                    </span>
                  )}
                </div>
                <p className="text-gray-500 text-xs">{user?.email}</p>
              </div>
              <button
                onClick={handleLogout}
                className="ml-2 p-1.5 rounded-md text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title="退出登录"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6 custom-scrollbar content-scrollbar">
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>
      </div>

      {/* Toast notifications */}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#1E293B',
            color: '#E2E8F0',
            border: '1px solid #374151',
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
    </div>
  );
}

function NavLink({
  href,
  icon,
  children,
  collapsed,
  exact,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  collapsed?: boolean;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/');

  return (
    <Link
      href={href}
      className={`flex items-center px-3 py-2 mx-2 rounded-md transition-colors text-sm ${
        isActive
          ? 'bg-primary-600/20 text-primary-400 border-l-2 border-primary-500'
          : 'text-gray-400 hover:bg-dark-surface-hover hover:text-gray-200'
      } ${collapsed ? 'justify-center' : 'space-x-3'}`}
      title={collapsed ? String(children) : undefined}
    >
      <span className="flex-shrink-0">{icon}</span>
      {!collapsed && <span className="truncate">{children}</span>}
    </Link>
  );
}
