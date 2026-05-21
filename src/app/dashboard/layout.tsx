'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
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
  Activity,
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
  Key,
  Network,
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
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(searchParams.get('sidebar') === 'collapsed');
  const [showUserMenu, setShowUserMenu] = useState(false);

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
      const parsedUser = JSON.parse(userData);
      setUser(parsedUser);
    } catch (e) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      document.cookie = 'auth-token=; path=/; max-age=0';
      router.push('/login');
      return;
    }
    setLoading(false);
  }, [router]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    document.cookie = 'auth-token=; path=/; max-age=0';
    router.push('/login');
  }, [router]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => !prev);
  }, []);

  const sidebarWidth = sidebarCollapsed ? 64 : 240;

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-zinc-950">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-zinc-950">
      <div className="flex h-full">
        <aside
          className={`fixed left-0 top-0 h-screen bg-zinc-900 border-r border-zinc-800 flex flex-col transition-all duration-300 ease-in-out z-30`}
          style={{ width: sidebarWidth }}
        >
          <button
            onClick={toggleSidebar}
            className="absolute -right-3 top-6 z-40 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800 text-zinc-400 hover:bg-cyan-600 hover:text-white transition-colors shadow-lg border border-zinc-700"
            title={sidebarCollapsed ? '展开菜单' : '收起菜单'}
          >
            {sidebarCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
          </button>

          <div className={`border-b border-zinc-800/60 overflow-hidden ${sidebarCollapsed ? 'p-3 flex justify-center' : 'px-5 py-5'}`}>
            {sidebarCollapsed ? (
              <Brain size={22} className="text-cyan-400" />
            ) : (
              <>
                <p className="text-xs text-zinc-500 mt-1 truncate">
                  {user?.name || user?.username}
                </p>
              </>
            )}
          </div>

          <nav className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-2 space-y-0.5 custom-scrollbar sidebar-scrollbar">
            {!sidebarCollapsed && (
              <div className="pt-3 pb-1 px-4">
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">使用者视图</p>
              </div>
            )}
            {sidebarCollapsed && <div className="pt-3 mx-3 border-t border-zinc-800/60" />}
            
            <NavLink href="/dashboard" icon={<LayoutDashboard size={18} />} collapsed={sidebarCollapsed} exact pathname={pathname}>
              仪表盘
            </NavLink>
            <NavLink href="/dashboard/task-builder" icon={<ClipboardList size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
              我的任务
            </NavLink>

            {(user?.roles?.includes('developer') || user?.roles?.includes('admin')) && (
              <>
                {!sidebarCollapsed && (
                  <div className="pt-5 pb-1 px-4">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">开发者视图</p>
                  </div>
                )}
                {sidebarCollapsed && <div className="pt-3 mx-3 border-t border-zinc-800/60" />}

                <NavLink href="/dashboard/skills" icon={<Award size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
                  Skills 管理
                </NavLink>
                <NavLink href="/dashboard/mcp-servers" icon={<Server size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
                  MCP 服务器
                </NavLink>
                <NavLink href="/dashboard/agent-apps" icon={<Box size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
                  Agent应用开发
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
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">进化与回流</p>
                  </div>
                )}
                {sidebarCollapsed && <div className="pt-3 mx-3 border-t border-zinc-800/60" />}

                <NavLink href="/dashboard/evolution" icon={<TrendingUp size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
                  智能体进化
                </NavLink>
                <NavLink href="/dashboard/knowledge-graph" icon={<Network size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
                  知识图谱
                </NavLink>
                <NavLink href="/dashboard/data-feedback" icon={<GitBranch size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
                  数据回流
                </NavLink>
              </>
            )}

            {user?.roles?.includes('admin') && (
              <>
                {!sidebarCollapsed && (
                  <div className="pt-5 pb-1 px-4">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">管理员视图</p>
                  </div>
                )}
                {sidebarCollapsed && <div className="pt-3 mx-3 border-t border-zinc-800/60" />}
                
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
                <NavLink href="/dashboard/config" icon={<Cog size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
                  系统配置
                </NavLink>
                <NavLink href="/dashboard/admin/broadcast" icon={<Megaphone size={18} />} collapsed={sidebarCollapsed} pathname={pathname}>
                  通知广播
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

          <div className={`border-t border-zinc-800/60 flex-shrink-0 ${sidebarCollapsed ? 'p-2' : 'p-3'}`}>
            <button
              onClick={handleLogout}
              className={`flex items-center text-zinc-500 hover:text-zinc-200 transition-colors w-full rounded-lg px-2 py-2 hover:bg-zinc-800 ${sidebarCollapsed ? 'justify-center' : 'gap-2'}`}
              title={sidebarCollapsed ? '退出登录' : undefined}
            >
              <LogOut size={18} className="flex-shrink-0" />
              {!sidebarCollapsed && <span className="text-sm truncate">退出登录</span>}
            </button>
          </div>
        </aside>

        <div 
          className="fixed right-0 top-0 h-screen flex flex-col transition-all duration-300 ease-in-out"
          style={{ left: sidebarWidth }}
        >
          <header className="h-14 bg-zinc-900/80 backdrop-blur-sm border-b border-zinc-800 flex-shrink-0">
            <div className="h-full flex items-center justify-between px-4 md:px-6 lg:px-8 gap-4">
              <div className="flex items-center gap-4 flex-1 min-w-0 overflow-hidden">
                <BroadcastMarquee />
              </div>

              <div className="flex items-center flex-shrink-0">
                <div className="relative">
                  <button
                    onClick={() => setShowUserMenu(!showUserMenu)}
                    className="flex items-center gap-2 bg-zinc-950/50 rounded-lg px-3 py-2 border border-zinc-700/30 hover:border-zinc-600/50 transition-colors max-w-xs md:max-w-sm lg:max-w-md"
                  >
                    {user?.avatar ? (
                      <img
                        src={user.avatar}
                        alt={user.name || user.username}
                        className="h-8 w-8 rounded-full ring-2 ring-cyan-500/30 flex-shrink-0"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-cyan-600 flex items-center justify-center text-white font-semibold flex-shrink-0 text-sm">
                        {user?.name?.charAt(0) || user?.username?.charAt(0) || 'U'}
                      </div>
                    )}

                    <div className="flex flex-col gap-0.5 text-left overflow-hidden min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-zinc-100 text-sm truncate">{user?.name || user?.username}</span>
                        {user?.roles?.includes('admin') && !user?.tenantId && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/15 text-red-400 border border-red-500/20 whitespace-nowrap">
                            平台管理员
                          </span>
                        )}
                        {user?.isIcsTenant && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/15 text-purple-400 border border-purple-500/20 whitespace-nowrap">
                            ICSL
                          </span>
                        )}
                      </div>
                      <p className="text-zinc-500 text-xs truncate">{user?.email}</p>
                    </div>

                    {user?.tenantId && (
                      <>
                        <div className="w-px h-6 bg-zinc-700/50 flex-shrink-0 hidden md:block" />
                        <div className="flex flex-col gap-0.5 flex-shrink-0 hidden md:flex">
                          <div className="flex items-center gap-1">
                            <div className="w-4 h-4 rounded bg-blue-500/20 flex items-center justify-center">
                              <span className="text-blue-400 text-[10px]">🏢</span>
                            </div>
                            <span className="text-zinc-400 text-[10px]">租户</span>
                          </div>
                          <span className="font-medium text-blue-400 text-xs truncate max-w-[80px]">{user?.tenantName || user?.tenantId}</span>
                        </div>
                      </>
                    )}
                  </button>

                  {showUserMenu && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setShowUserMenu(false)} />
                      <div className="absolute right-0 top-full mt-1 w-48 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl z-30 py-1">
                        <Link
                          href="/dashboard/profile"
                          onClick={() => setShowUserMenu(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                        >
                          <User size={15} />
                          个人中心
                        </Link>
                        <Link
                          href="/dashboard/models"
                          onClick={() => setShowUserMenu(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                        >
                          <Brain size={15} />
                          我的模型
                        </Link>
                        <Link
                          href="/dashboard/token-stats"
                          onClick={() => setShowUserMenu(false)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                        >
                          <Coins size={15} />
                          Token 统计
                        </Link>
                        <div className="my-1 border-t border-zinc-800" />
                        <button
                          onClick={() => { setShowUserMenu(false); handleLogout(); }}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-zinc-400 hover:bg-red-500/10 hover:text-red-400 transition-colors w-full"
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
          </header>

          <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-zinc-950 custom-scrollbar content-scrollbar">
            <div className="w-full min-h-full p-4 md:p-6 lg:p-8">
              <div className="w-full max-w-screen-2xl mx-auto">
                <ErrorBoundary>
                  {children}
                </ErrorBoundary>
              </div>
            </div>
          </main>
        </div>
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
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  collapsed?: boolean;
  exact?: boolean;
  pathname: string;
}) {
  const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/');

  return (
    <Link
      href={href}
      className={`flex items-center px-3 py-2 mx-2 rounded-lg transition-colors text-sm ${
        isActive
          ? 'bg-cyan-500/15 text-cyan-400 border-l-2 border-cyan-500'
          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
      } ${collapsed ? 'justify-center' : 'gap-3'}`}
      title={collapsed ? String(children) : undefined}
    >
      <span className="flex-shrink-0 w-[18px] h-[18px]">{icon}</span>
      {!collapsed && <span className="truncate min-w-0">{children}</span>}
    </Link>
  );
}