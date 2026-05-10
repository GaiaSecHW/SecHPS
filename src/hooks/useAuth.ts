// src/hooks/useAuth.ts
'use client';

import { useState, useEffect, useCallback } from 'react';
import { hasPermission } from '@/lib/permissions';

/**
 * 用户信息接口
 */
export interface UserInfo {
  id: string;
  email?: string;
  username?: string;
  name?: string;
  avatar?: string;
  roles?: string[];
  permissions?: string[];
}

/**
 * 认证状态 Hook 返回值
 */
export interface UseAuthReturn {
  /** 用户信息 */
  user: UserInfo | null;
  /** 是否已认证 */
  isAuthenticated: boolean;
  /** 是否正在加载 */
  loading: boolean;
  /** 是否是管理员 */
  isAdmin: boolean;
  /** 检查用户是否有指定角色 */
  hasRole: (role: string) => boolean;
  /** 检查用户是否有指定权限 */
  hasPermission: (permission: string) => boolean;
  /** 获取认证 Token */
  getToken: () => string | null;
  /** 刷新用户信息（从 localStorage 重新读取） */
  refresh: () => void;
  /** 登出（清除本地存储） */
  logout: () => void;
}

/**
 * 认证状态管理 Hook
 * 
 * 统一管理用户认证状态，避免重复的 localStorage 解析逻辑
 * 
 * @example
 * const { user, isAdmin, hasPermission, getToken } = useAuth();
 * 
 * if (!isAuthenticated) {
 *   return <LoginPrompt />;
 * }
 * 
 * if (!hasPermission('user:read')) {
 *   return <AccessDenied />;
 * }
 */
export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // 从 localStorage 加载用户信息
  const loadUser = useCallback(() => {
    try {
      const token = localStorage.getItem('token');
      const userStr = localStorage.getItem('user');

      if (token && userStr) {
        const userData = JSON.parse(userStr) as UserInfo;
        setUser(userData);
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('[useAuth] 解析用户信息失败:', error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始化时加载用户信息
  useEffect(() => {
    loadUser();
  }, [loadUser]);

  // 检查是否有指定角色
  const checkHasRole = useCallback((role: string): boolean => {
    return user?.roles?.includes(role) ?? false;
  }, [user]);

  // 检查是否有指定权限
  const checkHasPermission = useCallback((permission: string): boolean => {
    return hasPermission(user?.permissions, permission);
  }, [user]);

  // 获取 Token
  const getToken = useCallback((): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('token');
  }, []);

  // 刷新用户信息
  const refresh = useCallback(() => {
    setLoading(true);
    loadUser();
  }, [loadUser]);

  // 登出
  const logout = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      document.cookie = 'auth-token=; path=/; max-age=0';
    }
    setUser(null);
  }, []);

  return {
    user,
    isAuthenticated: user !== null,
    loading,
    isAdmin: checkHasRole('admin'),
    hasRole: checkHasRole,
    hasPermission: checkHasPermission,
    getToken,
    refresh,
    logout,
  };
}

/**
 * 仅检查管理员权限的 Hook
 * 适用于只需要判断是否是管理员的场景
 * 
 * @example
 * const isAdmin = useIsAdmin();
 * if (!isAdmin) return null;
 */
export function useIsAdmin(): boolean {
  const { isAdmin } = useAuth();
  return isAdmin;
}

/**
 * 仅检查指定权限的 Hook
 * 适用于只需要判断单个权限的场景
 * 
 * @example
 * const canReadUsers = usePermission('user:read');
 * if (!canReadUsers) return <AccessDenied />;
 */
export function usePermission(permission: string): boolean {
  const { hasPermission: checkPermission } = useAuth();
  return checkPermission(permission);
}
