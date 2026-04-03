// src/lib/metrics/collector.ts

import type { MetricDataPoint, MetricType, AggregatedMetric } from '@/types/monitoring';
import type { MetricCollectorOptions, MetricCallback } from './types';

/**
 * 内存指标收集器
 * 收集和存储系统性能指标
 */
export class MetricsCollector {
  private metrics: Map<string, MetricDataPoint[]> = new Map();
  private maxDataPoints: number;
  private flushInterval: number;
  private flushTimer?: NodeJS.Timeout;
  private callbacks: MetricCallback[] = [];

  constructor(options: Partial<MetricCollectorOptions> = {}) {
    this.maxDataPoints = options.maxDataPoints ?? 10000;
    this.flushInterval = options.flushInterval ?? 60000; // 1分钟
  }

  /**
   * 记录指标
   */
  record(
    name: string,
    type: MetricType,
    value: number,
    tags: Record<string, string> = {}
  ): void {
    const dataPoint: MetricDataPoint = {
      name,
      type,
      value,
      timestamp: new Date(),
      tags,
    };

    const key = this.getMetricKey(name, type);
    const dataPoints = this.metrics.get(key) || [];
    dataPoints.push(dataPoint);

    // 限制数据点数量
    if (dataPoints.length > this.maxDataPoints) {
      dataPoints.shift();
    }

    this.metrics.set(key, dataPoints);
  }

  /**
   * 记录计时指标
   */
  recordTiming(name: string, type: MetricType, durationMs: number, tags?: Record<string, string>): void {
    this.record(name, type, durationMs, tags);
  }

  /**
   * 记录计数指标
   */
  increment(name: string, type: MetricType, value: number = 1, tags?: Record<string, string>): void {
    this.record(name, type, value, tags);
  }

  /**
   * 获取指标数据
   */
  getMetrics(name?: string, type?: MetricType, since?: Date): MetricDataPoint[] {
    let results: MetricDataPoint[] = [];

    for (const [key, dataPoints] of this.metrics.entries()) {
      if (name && !key.includes(name)) continue;
      if (type && !key.includes(type)) continue;

      const filtered = since
        ? dataPoints.filter((dp) => dp.timestamp >= since)
        : dataPoints;
      results = results.concat(filtered);
    }

    return results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * 获取指标聚合数据
   */
  getAggregatedMetrics(
    name: string,
    type: MetricType,
    periodSeconds: number
  ): AggregatedMetric | null {
    const key = this.getMetricKey(name, type);
    const dataPoints = this.metrics.get(key);

    if (!dataPoints || dataPoints.length === 0) {
      return null;
    }

    const now = new Date();
    const periodStart = new Date(now.getTime() - periodSeconds * 1000);
    const filtered = dataPoints.filter((dp) => dp.timestamp >= periodStart);

    if (filtered.length === 0) {
      return null;
    }

    const values = filtered.map((dp) => dp.value);
    const sorted = [...values].sort((a, b) => a - b);

    return {
      name,
      type,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      sum: values.reduce((a, b) => a + b, 0),
      count: values.length,
      p50: this.percentile(sorted, 50),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99),
      period: {
        start: periodStart,
        end: now,
      },
    };
  }

  /**
   * 计算百分位数
   */
  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0;
    if (sortedValues.length === 1) return sortedValues[0];

    const index = Math.ceil((p / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, index)];
  }

  /**
   * 生成指标键
   */
  private getMetricKey(name: string, type: MetricType): string {
    return `${type}:${name}`;
  }

  /**
   * 注册回调
   */
  onFlush(callback: MetricCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * 启动定时刷新
   */
  startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushInterval);
  }

  /**
   * 停止定时刷新
   */
  stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  /**
   * 刷新指标到回调
   */
  async flush(): Promise<void> {
    const allMetrics = this.getMetrics();
    for (const callback of this.callbacks) {
      await callback(allMetrics);
    }
  }

  /**
   * 清除所有指标
   */
  clear(): void {
    this.metrics.clear();
  }

  /**
   * 获取指标统计
   */
  getStats(): { totalDataPoints: number; metricCount: number; oldestDataPoint?: Date } {
    let totalDataPoints = 0;
    let oldestDataPoint: Date | undefined;

    for (const dataPoints of this.metrics.values()) {
      totalDataPoints += dataPoints.length;
      if (dataPoints.length > 0) {
        const oldest = dataPoints[0].timestamp;
        if (!oldestDataPoint || oldest < oldestDataPoint) {
          oldestDataPoint = oldest;
        }
      }
    }

    return {
      totalDataPoints,
      metricCount: this.metrics.size,
      oldestDataPoint,
    };
  }
}

// 全局指标收集器实例
export const metricsCollector = new MetricsCollector();

// 便捷方法
export function recordMetric(
  name: string,
  type: MetricType,
  value: number,
  tags?: Record<string, string>
): void {
  metricsCollector.record(name, type, value, tags);
}

export function recordTiming(
  name: string,
  type: MetricType,
  durationMs: number,
  tags?: Record<string, string>
): void {
  metricsCollector.recordTiming(name, type, durationMs, tags);
}

export function incrementMetric(
  name: string,
  type: MetricType,
  value?: number,
  tags?: Record<string, string>
): void {
  metricsCollector.increment(name, type, value, tags);
}
