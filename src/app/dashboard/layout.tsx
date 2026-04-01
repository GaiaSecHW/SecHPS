'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
} from 'lucide-react';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 检查认证状态
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');

    if (!token || !userData) {
      router.push('/login');
      return;
    }

    setUser(JSON.parse(userData));
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
      <div className="w-64 bg-gray-900 text-white flex flex-col">
        <div className="p-6 border-b border-gray-800">
          <h1 className="text-xl font-bold">AI4WEB 平台</h1>
          <p className="text-sm text-gray-400 mt-1">
            {user?.name || user?.username}
          </p>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <NavLink href="/dashboard" icon={<LayoutDashboard size={20} />}>
            仪表盘
          </NavLink>
          <NavLink href="/dashboard/sessions" icon={<MessageSquare size={20} />}>
            项目管理
          </NavLink>

          {/* 工作流 */}
          <div className="pt-4 pb-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider">
              工作流
            </p>
          </div>
          <NavLink href="/dashboard/workflows" icon={<GitBranch size={20} />}>
            工作流管理
          </NavLink>
          <NavLink href="/dashboard/executions" icon={<Clock size={20} />}>
            执行历史
          </NavLink>

          {/* 个人中心 */}
          <div className="pt-4 pb-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider">
              个人
            </p>
          </div>
          <NavLink href="/dashboard/profile" icon={<User size={20} />}>
            个人中心
          </NavLink>

          {/* 管理功能 - 根据权限显示 */}
          {user?.roles?.includes('admin') && (
            <>
              <div className="pt-4 pb-2">
                <p className="text-xs text-gray-500 uppercase tracking-wider">
                  管理员
                </p>
              </div>
              <NavLink href="/dashboard/users" icon={<Users size={20} />}>
                用户管理
              </NavLink>
              <NavLink href="/dashboard/roles" icon={<Settings size={20} />}>
                角色权限
              </NavLink>
              <NavLink href="/dashboard/config" icon={<Cog size={20} />}>
                系统配置
              </NavLink>
            </>
          )}
        </nav>

        <div className="p-4 border-t border-gray-800">
          <button
            onClick={handleLogout}
            className="flex items-center space-x-2 text-gray-400 hover:text-white transition-colors w-full"
          >
            <LogOut size={20} />
            <span>退出登录</span>
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
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

function NavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center space-x-3 px-3 py-2 rounded-md text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
    >
      {icon}
      <span>{children}</span>
    </Link>
  );
}
