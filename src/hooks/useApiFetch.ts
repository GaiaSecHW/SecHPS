// src/hooks/useApiFetch.ts
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiGet, apiPost, apiPut, apiDelete, apiPatch, apiRequest } from '@/lib/api-client';

/**
 * useApiFetch Hook 配置选项
 */
export interface UseApiFetchOptions {
  /** 是否立即执行（默认 true） */
  immediate?: boolean;
  /** 依赖数组，变化时重新请求 */
  deps?: unknown[];
  /** 请求前的回调，返回 false 可取消请求 */
  onBefore?: () => boolean | void;
  /** 请求成功回调 */
  onSuccess?: (data: unknown) => void;
  /** 请求失败回调 */
  onError?: (error: string) => void;
  /** 请求完成回调（无论成功失败） */
  onFinally?: () => void;
}

/**
 * useApiFetch Hook 返回值
 */
export interface UseApiFetchReturn<T> {
  /** 响应数据 */
  data: T | null;
  /** 是否正在加载 */
  loading: boolean;
  /** 错误消息 */
  error: string | null;
  /** 手动重新请求 */
  refetch: () => Promise<void>;
  /** 手动设置数据 */
  setData: (data: T | null) => void;
  /** 手动设置错误 */
  setError: (error: string | null) => void;
}

/**
 * 通用数据获取 Hook
 * 
 * 基于 api-client 封装，提供完整的加载状态管理
 * 
 * @example
 * // 基础用法
 * const { data, loading, error } = useApiFetch<User[]>('/api/users');
 * 
 * @example
 * // 带依赖
 * const { data } = useApiFetch(`/api/users/${userId}`, { deps: [userId] });
 * 
 * @example
 * // 手动触发（不立即执行）
 * const { data, refetch } = useApiFetch('/api/users', { immediate: false });
 * 
 * @example
 * // 带回调
 * const { data } = useApiFetch('/api/users', {
 *   onSuccess: (data) => toast.success('加载成功'),
 *   onError: (error) => toast.error(error),
 * });
 */
export function useApiFetch<T = unknown>(
  url: string | null,
  options: UseApiFetchOptions = {}
): UseApiFetchReturn<T> {
  const {
    immediate = true,
    deps = [],
    onBefore,
    onSuccess,
    onError,
    onFinally,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(immediate);
  const [error, setError] = useState<string | null>(null);

  // 使用 ref 避免闭包问题
  const cancelledRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (!url) return;

    // 请求前检查
    if (onBefore) {
      const shouldContinue = onBefore();
      if (shouldContinue === false) return;
    }

    cancelledRef.current = false;
    setLoading(true);
    setError(null);

    try {
      const result = await apiGet<T>(url);

      if (cancelledRef.current) return;

      if (result.error) {
        setError(result.error);
        onError?.(result.error);
      } else {
        setData(result.data);
        onSuccess?.(result.data);
      }
    } catch (err) {
      if (cancelledRef.current) return;

      const errorMsg = err instanceof Error ? err.message : '请求失败';
      setError(errorMsg);
      onError?.(errorMsg);
    } finally {
      if (!cancelledRef.current) {
        setLoading(false);
        onFinally?.();
      }
    }
  }, [url, onBefore, onSuccess, onError, onFinally]);

  // 初始化或依赖变化时请求
  useEffect(() => {
    if (immediate && url) {
      fetchData();
    }

    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, immediate, ...deps]);

  return {
    data,
    loading,
    error,
    refetch: fetchData,
    setData,
    setError,
  };
}

/**
 * POST 请求 Hook
 * 
 * @example
 * const { submit, loading, error } = useApiPost<User>('/api/users');
 * 
 * const handleSubmit = async () => {
 *   const result = await submit({ name: 'John', email: 'john@example.com' });
 *   if (result.data) {
 *     toast.success('创建成功');
 *   }
 * };
 */
export function useApiPost<T = unknown, B = unknown>(url: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (body: B) => {
    setLoading(true);
    setError(null);

    try {
      const result = await apiPost<T>(url, body);
      if (result.error) {
        setError(result.error);
      }
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '请求失败';
      setError(errorMsg);
      return { data: null, error: errorMsg };
    } finally {
      setLoading(false);
    }
  }, [url]);

  return { submit, loading, error, setError };
}

/**
 * PUT 请求 Hook
 */
export function useApiPut<T = unknown, B = unknown>(url: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (body: B) => {
    setLoading(true);
    setError(null);

    try {
      const result = await apiPut<T>(url, body);
      if (result.error) {
        setError(result.error);
      }
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '请求失败';
      setError(errorMsg);
      return { data: null, error: errorMsg };
    } finally {
      setLoading(false);
    }
  }, [url]);

  return { submit, loading, error, setError };
}

/**
 * DELETE 请求 Hook
 */
export function useApiDelete<T = unknown>(url: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await apiDelete<T>(url);
      if (result.error) {
        setError(result.error);
      }
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '请求失败';
      setError(errorMsg);
      return { data: null, error: errorMsg };
    } finally {
      setLoading(false);
    }
  }, [url]);

  return { submit, loading, error, setError };
}

/**
 * 通用请求 Hook（支持任意方法）
 * 
 * @example
 * const { request, loading } = useApiRequest();
 * 
 * const handleAction = async () => {
 *   const result = await request('/api/users', { method: 'POST', body: JSON.stringify(data) });
 * };
 */
export function useApiRequest<T = unknown>() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async (url: string, options?: RequestInit) => {
    setLoading(true);
    setError(null);

    try {
      const result = await apiRequest<T>(url, options);
      if (result.error) {
        setError(result.error);
      }
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '请求失败';
      setError(errorMsg);
      return { data: null, error: errorMsg };
    } finally {
      setLoading(false);
    }
  }, []);

  return { request, loading, error, setError };
}

/**
 * 分页数据获取 Hook
 * 
 * @example
 * const { data, pagination, loading, setPage } = useApiPaginated<User>('/api/users');
 */
export function useApiPaginated<T = unknown>(
  url: string,
  options: Omit<UseApiFetchOptions, 'deps'> & { defaultPage?: number; defaultLimit?: number } = {}
) {
  const { defaultPage = 1, defaultLimit = 20, ...fetchOptions } = options;

  const [page, setPage] = useState(defaultPage);
  const [limit, setLimit] = useState(defaultLimit);

  const urlWithParams = `${url}${url.includes('?') ? '&' : '?'}page=${page}&limit=${limit}`;

  const result = useApiFetch<{ data: T[]; pagination?: { total: number; totalPages: number } }>(
    urlWithParams,
    { ...fetchOptions, deps: [page, limit] }
  );

  return {
    ...result,
    data: result.data?.data ?? null,
    pagination: result.data?.pagination ?? null,
    page,
    limit,
    setPage,
    setLimit,
  };
}
