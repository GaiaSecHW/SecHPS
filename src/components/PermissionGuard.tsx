'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { AlertCircle } from 'lucide-react';

interface PermissionGuardProps {
  /** 需要检查的权限 */
  permission?: string;
  /** 需要检查的角色（可选，与 permission 二选一） */
  role?: string;
  /** 子组件 */
  children: React.ReactNode;
  /** 自定义无权限时显示的内容 */
  fallback?: React.ReactNode;
}

/**
 * 权限守卫组件
 * 
 * 用于页面级权限控制，检查用户是否拥有指定权限或角色
 * 
 * @example
 * // 检查权限
 * <PermissionGuard permission={PERMISSIONS.USER_READ}>
 *   <UsersPage />
 * </PermissionGuard>
 * 
 * @example
 * // 检查角色
 * <PermissionGuard role="admin">
 *   <AdminPage />
 * </PermissionGuard>
 */
export function PermissionGuard({ permission, role, children, fallback }: PermissionGuardProps) {
  const router = useRouter();
  const { isAuthenticated, loading, hasPermission, hasRole } = useAuth();

  // 未认证时跳转登录页
  if (!loading && !isAuthenticated) {
    router.push('/login');
    return null;
  }

  // 加载中
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // 检查权限
  if (permission && !hasPermission(permission)) {
    return fallback || <AccessDenied />;
  }

  // 检查角色
  if (role && !hasRole(role)) {
    return fallback || <AccessDenied />;
  }

  return <>{children}</>;
}

/**
 * 管理员权限守卫组件
 * 专门用于检查用户是否是管理员
 */
export function AdminGuard({ children }: { children: React.ReactNode }) {
  return (
    <PermissionGuard role="admin">
      {children}
    </PermissionGuard>
  );
}

/**
 * 无权限访问提示组件
 */
export function AccessDenied({ message = '您没有权限访问此页面' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 space-y-4">
      <div className="flex items-center justify-center w-16 h-16 bg-red-100 rounded-full">
        <AlertCircle className="w-8 h-8 text-red-600" />
      </div>
      <h2 className="text-xl font-semibold text-gray-900">访问被拒绝</h2>
      <p className="text-gray-500">{message}</p>
      <p className="text-sm text-gray-400">如需访问，请联系管理员获取相应权限</p>
    </div>
  );
}

/**
 * 检查用户是否是管理员
 * @deprecated 请使用 useAuth hook 替代：const { isAdmin } = useAuth()
 */
export function useIsAdmin(): boolean {
  const { isAdmin } = useAuth();
  return isAdmin;
}

/**
 * 检查用户是否有指定权限
 * @deprecated 请使用 useAuth hook 替代：const { hasPermission } = useAuth()
 */
export function useHasPermission(permission: string): boolean {
  const { hasPermission: checkPermission } = useAuth();
  return checkPermission(permission);
}
