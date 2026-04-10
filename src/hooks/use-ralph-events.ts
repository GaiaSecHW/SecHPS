'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface RalphIteration {
  id: string;
  iterationNumber: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string | null;
  completedAt: string | null;
  duration: number | null;
  responseText: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  toolCallCount: number;
  verificationComplete: boolean | null;
  verificationReason: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface RalphIterationSummary {
  total: number;
  completed: number;
  failed: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDuration: number;
  verifiedCount: number;
}

export interface UseRalphEventsOptions {
  evaluationId: string;
  token: string;
  enabled?: boolean;
  pollInterval?: number;
}

export interface UseRalphEventsResult {
  iterations: RalphIteration[];
  summary: RalphIterationSummary | null;
  evaluationStatus: string | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * 轮询 Ralph Loop Agent 迭代进度
 * 当评估状态变为 completed/failed 时自动停止轮询
 */
export function useRalphEvents({
  evaluationId,
  token,
  enabled = true,
  pollInterval = 3000,
}: UseRalphEventsOptions): UseRalphEventsResult {
  const [iterations, setIterations] = useState<RalphIteration[]>([]);
  const [summary, setSummary] = useState<RalphIterationSummary | null>(null);
  const [evaluationStatus, setEvaluationStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchIterations = useCallback(async () => {
    if (!evaluationId || !token) return;
    try {
      const res = await fetch(`/api/evaluations/${evaluationId}/iterations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setIterations(data.iterations ?? []);
      setSummary(data.summary ?? null);
      setEvaluationStatus(data.evaluationStatus ?? null);
      setError(null);
      // 评估结束后停止轮询
      if (data.evaluationStatus === 'completed' || data.evaluationStatus === 'failed') {
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [evaluationId, token]);

  const refresh = useCallback(() => {
    setIsLoading(true);
    fetchIterations();
  }, [fetchIterations]);

  useEffect(() => {
    if (!enabled) return;
    setIsLoading(true);
    fetchIterations();
    intervalRef.current = setInterval(fetchIterations, pollInterval);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled, fetchIterations, pollInterval]);

  return { iterations, summary, evaluationStatus, isLoading, error, refresh };
}
