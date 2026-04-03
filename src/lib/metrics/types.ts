// src/lib/metrics/types.ts

import type { MetricDataPoint, MetricType } from '@/types/monitoring';

export interface MetricCollectorOptions {
  maxDataPoints: number;
  flushInterval: number;
}

export type MetricCallback = (metrics: MetricDataPoint[]) => void | Promise<void>;

export { type MetricDataPoint, type MetricType };
