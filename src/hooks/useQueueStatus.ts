import { useState, useEffect, useCallback, useRef } from 'react';

export interface QueuedEvaluation {
  id: string;
  taskName: string;
  createdAt: Date;
  queuePosition: number;
}

export interface QueueStatus {
  activeCount: number;
  queuedCount: number;
  maxConcurrent: number;
  queuedEvaluations: QueuedEvaluation[];
}

export interface UseQueueStatusReturn {
  status: QueueStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  hasActiveEvaluations: boolean;
  hasQueuedEvaluations: boolean;
  isQueueFull: boolean;
}

const DEFAULT_POLL_INTERVAL = 10000;

export function useQueueStatus(
  pollInterval: number = DEFAULT_POLL_INTERVAL,
  autoStart: boolean = true
): UseQueueStatusReturn {
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<boolean>(autoStart);
  const mountedRef = useRef<boolean>(true);

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

  const refresh = useCallback(async () => {
    await fetchQueueStatus();
  }, [fetchQueueStatus]);

  useEffect(() => {
    mountedRef.current = true;

    if (pollingRef.current || pollInterval === 0) {
      fetchQueueStatus();
    }

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

  const hasActiveEvaluations = (status?.activeCount ?? 0) > 0;
  const hasQueuedEvaluations = (status?.queuedCount ?? 0) > 0;
  const isQueueFull = status ? status.maxConcurrent > 0 && (status.activeCount ?? 0) >= status.maxConcurrent : false;

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

export function useHasActiveEvaluations(): boolean {
  const { hasActiveEvaluations } = useQueueStatus();
  return hasActiveEvaluations;
}