import { useState, useEffect, useCallback, useRef } from 'react';

export interface UseApiFetchOptions {
  immediate?: boolean;
  deps?: unknown[];
  onBefore?: () => boolean | void;
  onSuccess?: (data: unknown) => void;
  onError?: (error: string) => void;
  onFinally?: () => void;
}

export interface UseApiFetchReturn<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useApiFetch<T = unknown>(
  path: string | null,
  options?: UseApiFetchOptions,
): UseApiFetchReturn<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetcher = useCallback(async () => {
    if (!path) return;

    if (options?.onBefore?.() === false) return;

    // Cancel previous request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const resp = await fetch(path, { signal: controller.signal });
      if (controller.signal.aborted) return;

      if (!resp.ok) {
        let msg = `HTTP ${resp.status}`;
        try {
          const errData = await resp.json();
          if (typeof errData.error === 'string') msg = errData.error;
        } catch {}
        throw new Error(msg);
      }

      const json = await resp.json();
      if (controller.signal.aborted) return;

      setData(json as T);
      options?.onSuccess?.(json);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      const msg = err.message || '请求失败';
      setError(msg);
      options?.onError?.(msg);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        options?.onFinally?.();
      }
    }
  }, [path]);

  useEffect(() => {
    if (options?.immediate === false) return;
    fetcher();
    return () => {
      abortRef.current?.abort();
    };
  }, [fetcher, ...(options?.deps || [])]);

  return { data, loading, error, refetch: fetcher };
}
