// src/hooks/useQueueStatus.ts
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * 排队评估信息
 */
export interface QueuedEvaluation {
  id: string;
  projectId: string;
  projectName: string;
  createdAt: Date;
  queuePosition: number;
}

/**
 * 队列状态
 */
export interface QueueStatus {
  activeCount: number;
  queuedCount: number;
  maxConcurrent: number;
  queuedEvaluations: QueuedEvaluation[];
}

/**
 * Hook 返回值
 */
export interface UseQueueStatusReturn {
  /** 队列状态 */
  status: QueueStatus | null;
  /** 是否正在加载 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 手动刷新队列状态 */
  refresh: () => Promise<void>;
  /** 是否有活动评估 */
  hasActiveEvaluations: boolean;
  /** 是否有排队评估 */
  hasQueuedEvaluations: boolean;
  /** 队列是否已满 */
  isQueueFull: boolean;
}

/**
 * 默认轮询间隔（毫秒）
 */
const DEFAULT_POLL_INTERVAL = 10000; // 10秒

/**
 * 队列状态轮询 Hook
 * 
 * 自动轮询队列状态，支持手动刷新
 * 
 * @param pollInterval - 轮询间隔（毫秒），默认 10 秒，设为 0 则不自动轮询
 * @param autoStart - 是否自动开始轮询，默认 true
 * 
 * @example
 * // 自动轮询（默认 10 秒）
 * const { status, loading, refresh } = useQueueStatus();
 * 
 * // 自定义轮询间隔
 * const { status } = useQueueStatus(5000);
 * 
 * // 手动控制轮询
 * const { status, refresh } = useQueueStatus(0);
 * useEffect(() => {
 *   refresh();
 * }, [someEvent]);
 */
export function useQueueStatus(
  pollInterval: number = DEFAULT_POLL_INTERVAL,
  autoStart: boolean = true
): UseQueueStatusReturn {
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<boolean>(autoStart);
  const mountedRef = useRef<boolean>(true);

  // 获取队列状态
  const fetchQueueStatus = useCallback(async () => {
    if (!mountedRef.current) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const token = localStorage.getItem('token');
      if (!token) {
        setError('未登录');
        setLoading(false);
        return;
      }
      
      const response = await fetch('/api/queue/status', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      
      if (!mountedRef.current) return;
      
      if (!response.ok) {
        const data = await response.json();
        setError(data.error || `获取队列状态失败 (${response.status})`);
        setLoading(false);
        return;
      }
      
      const data: QueueStatus = await response.json();
      setStatus(data);
      setLoading(false);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : '网络错误');
      setLoading(false);
    }
  }, []);

  // 手动刷新
  const refresh = useCallback(async () => {
    await fetchQueueStatus();
  }, [fetchQueueStatus]);

  // 自动轮询
  useEffect(() => {
    mountedRef.current = true;
    
    // 立即获取一次
    if (pollingRef.current || pollInterval === 0) {
      fetchQueueStatus();
    }
    
    // 设置轮询
    if (pollInterval > 0 && pollingRef.current) {
      const intervalId = setInterval(fetchQueueStatus, pollInterval);
      
      return () => {
        clearInterval(intervalId);
        mountedRef.current = false;
      };
    }
    
    return () => {
      mountedRef.current = false;
    };
  }, [pollInterval, fetchQueueStatus]);

  // 计算派生状态
  const hasActiveEvaluations = (status?.activeCount ?? 0) > 0;
  const hasQueuedEvaluations = (status?.queuedCount ?? 0) > 0;
  const isQueueFull = status ? (status.activeCount ?? 0) >= status.maxConcurrent : false;

  return {
    status,
    loading,
    error,
    refresh,
    hasActiveEvaluations,
    hasQueuedEvaluations,
    isQueueFull,
  };
}

/**
 * 仅检查是否有活动评估的 Hook
 * 
 * @example
 * const hasActive = useHasActiveEvaluations();
 * if (hasActive) {
 *   // 显示进度指示器
 * }
 */
export function useHasActiveEvaluations(): boolean {
  const { hasActiveEvaluations } = useQueueStatus();
  return hasActiveEvaluations;
}