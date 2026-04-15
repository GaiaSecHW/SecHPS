'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Toaster } from 'react-hot-toast';
import {
  LayoutDashboard,
  Users,
  Settings,
  MessageSquare,
  LogOut,
  Cog,
  User,
  GitBranch,
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
  ChevronLeft,
  ChevronRight,
  Coins,
} from 'lucide-react';

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

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
    </div>
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
  
  // 从 URL 参数判断是否需要收起侧边栏（新窗口打开详情页时）
  const [collapsed, setCollapsed] = useState(searchParams.get('sidebar') === 'collapsed');

  useEffect(() => {
    // 检查认证状态
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
      // userData 损坏，清除并跳转登录
      console.error('Failed to parse user data:', e);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      router.push('/login');
      return;
    }
    setLoading(false);
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* 侧边栏 */}
      <div
        className={`${collapsed ? 'w-16' : 'w-64'} bg-gray-900 text-white flex flex-col transition-all duration-300 ease-in-out relative flex-shrink-0`}
      >
        {/* 收缩/展开按钮 */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-6 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-gray-700 text-gray-300 hover:bg-blue-600 hover:text-white transition-colors shadow-md"
          title={collapsed ? '展开菜单' : '收起菜单'}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        {/* 品牌区 */}
        <div className={`border-b border-gray-800 overflow-hidden ${collapsed ? 'p-4' : 'p-6'}`}>
          {collapsed ? (
            <div className="flex justify-center">
              <Brain size={24} className="text-blue-400" />
            </div>
          ) : (
            <>
              <h1 className="text-xl font-bold">AI4WEB 平台</h1>
              <p className="text-sm text-gray-400 mt-1">
                {user?.name || user?.username}
              </p>
            </>
          )}
        </div>

        <nav className="flex-1 p-2 space-y-1 overflow-y-auto overflow-x-hidden">
          <NavLink href="/dashboard" icon={<LayoutDashboard size={20} />} collapsed={collapsed}>
            仪表盘
          </NavLink>
          <NavLink href="/dashboard/sessions" icon={<MessageSquare size={20} />} collapsed={collapsed}>
            我的项目
          </NavLink>

          {/* Agent编排 */}
          {!collapsed && (
            <div className="pt-4 pb-1">
              <p className="text-xs text-gray-500 uppercase tracking-wider px-2">Agent编排</p>
            </div>
          )}
          {collapsed && <div className="pt-2 border-t border-gray-800 mx-2" />}
          <NavLink href="/dashboard/workflows" icon={<GitBranch size={20} />} collapsed={collapsed}>
            Agent编排管理
          </NavLink>
          <NavLink href="/dashboard/skills" icon={<Award size={20} />} collapsed={collapsed}>
            Skills 管理
          </NavLink>
          <NavLink href="/dashboard/mcp-servers" icon={<Server size={20} />} collapsed={collapsed}>
            MCP 服务器
          </NavLink>

          {/* 个人中心 */}
          {!collapsed && (
            <div className="pt-4 pb-1">
              <p className="text-xs text-gray-500 uppercase tracking-wider px-2">个人</p>
            </div>
          )}
          {collapsed && <div className="pt-2 border-t border-gray-800 mx-2" />}
          <NavLink href="/dashboard/profile" icon={<User size={20} />} collapsed={collapsed}>
            个人中心
          </NavLink>
          <NavLink href="/dashboard/token-stats" icon={<Coins size={20} />} collapsed={collapsed}>
            Token 统计
          </NavLink>

          {/* 管理功能 - 根据权限显示 */}
          {user?.roles?.includes('admin') && (
            <>
              {!collapsed && (
                <div className="pt-4 pb-1">
                  <p className="text-xs text-gray-500 uppercase tracking-wider px-2">管理员</p>
                </div>
              )}
              {collapsed && <div className="pt-2 border-t border-gray-800 mx-2" />}
              <NavLink href="/dashboard/users" icon={<Users size={20} />} collapsed={collapsed}>
                用户管理
              </NavLink>
              <NavLink href="/dashboard/roles" icon={<Settings size={20} />} collapsed={collapsed}>
                角色权限
              </NavLink>
              <NavLink href="/dashboard/config" icon={<Cog size={20} />} collapsed={collapsed}>
                系统配置
              </NavLink>
              <NavLink href="/dashboard/admin/models" icon={<Brain size={20} />} collapsed={collapsed}>
                模型管理
              </NavLink>
              <NavLink href="/dashboard/plugins" icon={<Puzzle size={20} />} collapsed={collapsed}>
                插件管理
              </NavLink>
              <NavLink href="/dashboard/claude" icon={<Clock size={20} />} collapsed={collapsed}>
                Claude 会话
              </NavLink>
              <NavLink href="/dashboard/admin/categories" icon={<Tags size={20} />} collapsed={collapsed}>
                漏洞分类
              </NavLink>
              <NavLink href="/dashboard/admin/vulnerabilities" icon={<Bug size={20} />} collapsed={collapsed}>
                漏洞管理
              </NavLink>
              <NavLink href="/dashboard/admin/skills-evolution" icon={<TrendingUp size={20} />} collapsed={collapsed}>
                Skills 进化
              </NavLink>
              <NavLink href="/dashboard/admin/autonomous-evolution" icon={<Brain size={20} />} collapsed={collapsed}>
                执行自主进化
              </NavLink>
              <NavLink href="/dashboard/admin/tools" icon={<Cog size={20} />} collapsed={collapsed}>
                工具管理
              </NavLink>
              <NavLink href="/dashboard/admin/default-tool-permissions" icon={<Shield size={20} />} collapsed={collapsed}>
                默认工具权限
              </NavLink>
            </>
          )}
        </nav>

        <div className={`border-t border-gray-800 ${collapsed ? 'p-2' : 'p-4'}`}>
          <button
            onClick={handleLogout}
            className={`flex items-center text-gray-400 hover:text-white transition-colors w-full rounded-md px-2 py-2 hover:bg-gray-800 ${collapsed ? 'justify-center' : 'space-x-2'}`}
            title={collapsed ? '退出登录' : undefined}
          >
            <LogOut size={20} className="flex-shrink-0" />
            {!collapsed && <span>退出登录</span>}
          </button>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="flex-1 bg-gray-50 overflow-hidden flex flex-col">
        {/* 顶部栏 */}
        <header className="bg-white shadow-sm border-b border-gray-200 flex-shrink-0">
          <div className="h-16 flex items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="flex items-center space-x-4">
              <h2 className="text-lg font-semibold text-gray-900">
                AI4WEB 测试平台
              </h2>
            </div>

            <div className="flex items-center space-x-4">
              {user?.avatar && (
                <img
                  src={user.avatar}
                  alt={user.name || user.username}
                  className="h-8 w-8 rounded-full"
                />
              )}
              <div className="text-sm">
                <p className="font-medium text-gray-900">
                  {user?.name || user?.username}
                </p>
                <p className="text-gray-500">{user?.email}</p>
              </div>
            </div>
          </div>
        </header>

        {/* 页面内容 */}
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>

      {/* Toast 通知 */}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#363636',
            color: '#fff',
          },
          success: {
            style: {
              background: '#22c55e',
            },
          },
          error: {
            style: {
              background: '#ef4444',
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
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  collapsed?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center px-3 py-2 rounded-md text-gray-300 hover:bg-gray-800 hover:text-white transition-colors ${collapsed ? 'justify-center' : 'space-x-3'}`}
      title={collapsed ? String(children) : undefined}
    >
      <span className="flex-shrink-0">{icon}</span>
      {!collapsed && <span className="truncate">{children}</span>}
    </Link>
  );
}
