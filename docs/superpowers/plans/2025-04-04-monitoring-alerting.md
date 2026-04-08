# 监控告警系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现系统监控、性能指标收集和告警通知功能。

**Architecture:** 分层监控架构 - 指标收集层(Metrics Collector)、存储层(Metrics Store)、告警引擎(Alert Engine)、通知渠道(Notification Channel)。支持阈值告警和趋势分析。

**Tech Stack:** Next.js API Routes, Prisma ORM, SQLite, Server-Sent Events for real-time alerts

---

## 文件结构

```
src/lib/
├── metrics/
│   ├── collector.ts          # 指标收集器
│   ├── types.ts              # 指标类型定义
│   └── aggregator.ts         # 指标聚合器
├── monitoring/
│   ├── health-check.ts       # 健康检查
│   ├── alert-engine.ts       # 告警引擎
│   └── alert-notifier.ts     # 告警通知器
└── middleware/
    └── metrics-middleware.ts # 请求指标中间件

src/app/api/
├── admin/
│   ├── metrics/
│   │   ├── route.ts          # 指标查询API
│   │   └── [type]/route.ts   # 特定类型指标
│   ├── alerts/
│   │   ├── route.ts          # 告警规则管理
│   │   └── history/route.ts  # 告警历史
│   └── health/
│       └── route.ts          # 系统健康检查
└── admin/notifications/
    └── route.ts              # 通知配置管理

prisma/
└── schema.prisma             # 添加告警相关模型

src/types/
└── monitoring.ts             # 监控类型定义
```

---

### Task 1: 监控类型定义

**Files:**
- Create: `src/types/monitoring.ts`

- [ ] **Step 1: 创建监控和告警类型定义**

```typescript
// src/types/monitoring.ts

// 指标类型
export type MetricType = 
  | 'api_response_time'      // API响应时间
  | 'api_request_count'      // API请求计数
  | 'api_error_count'        // API错误计数
  | 'db_query_time'          // 数据库查询时间
  | 'db_connection_count'    // 数据库连接数
  | 'workflow_execution_time' // 工作流执行时间
  | 'workflow_success_rate'  // 工作流成功率
  | 'skill_execution_time'   // Skill执行时间
  | 'cache_hit_rate'         // 缓存命中率
  | 'memory_usage'           // 内存使用
  | 'cpu_usage';             // CPU使用率

// 指标值类型
export interface MetricValue {
  timestamp: Date;
  value: number;
  tags?: Record<string, string>;
}

// 指标数据点
export interface MetricDataPoint {
  name: string;
  type: MetricType;
  value: number;
  timestamp: Date;
  tags: Record<string, string>;
}

// 聚合指标
export interface AggregatedMetric {
  name: string;
  type: MetricType;
  min: number;
  max: number;
  avg: number;
  sum: number;
  count: number;
  p50: number;
  p95: number;
  p99: number;
  period: {
    start: Date;
    end: Date;
  };
  tags?: Record<string, string>;
}

// 告警严重级别
export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

// 告警状态
export type AlertStatus = 'active' | 'resolved' | 'acknowledged' | 'silenced';

// 告警规则条件
export type AlertCondition = 
  | { type: 'threshold'; operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq'; value: number }
  | { type: 'rate'; period: number; threshold: number }
  | { type: 'absence'; period: number };

// 告警规则
export interface AlertRule {
  id: string;
  name: string;
  description?: string;
  metricType: MetricType;
  condition: AlertCondition;
  severity: AlertSeverity;
  enabled: boolean;
  cooldownPeriod: number; // 冷却期(秒)
  notificationChannels: string[];
  tags?: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

// 告警实例
export interface AlertInstance {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: AlertSeverity;
  status: AlertStatus;
  message: string;
  value: number;
  threshold: number;
  triggeredAt: Date;
  resolvedAt?: Date;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  details?: Record<string, unknown>;
}

// 通知渠道类型
export type NotificationChannelType = 'email' | 'webhook' | 'slack' | 'dingtalk' | 'wechat';

// 通知渠道配置
export interface NotificationChannel {
  id: string;
  name: string;
  type: NotificationChannelType;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// 系统健康状态
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

// 健康检查结果
export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  message?: string;
  details?: Record<string, unknown>;
  responseTime?: number;
  checkedAt: Date;
}

// 系统健康报告
export interface SystemHealthReport {
  status: HealthStatus;
  version: string;
  uptime: number;
  timestamp: Date;
  checks: HealthCheckResult[];
  metrics: {
    cpu: number;
    memory: number;
    dbConnections: number;
    cacheHitRate: number;
  };
}

// 监控仪表盘数据
export interface DashboardMetrics {
  api: {
    totalRequests: number;
    avgResponseTime: number;
    errorRate: number;
    requestsPerMinute: number;
  };
  workflow: {
    totalExecutions: number;
    successRate: number;
    avgExecutionTime: number;
    activeExecutions: number;
  };
  skill: {
    totalExecutions: number;
    successRate: number;
    avgExecutionTime: number;
    findingsCount: number;
  };
  system: {
    uptime: number;
    memoryUsage: number;
    dbSize: number;
    cacheHitRate: number;
  };
  alerts: {
    active: number;
    critical: number;
    high: number;
    lastTriggered?: Date;
  };
}

// 时间范围
export interface TimeRange {
  start: Date;
  end: Date;
}

// 指标查询参数
export interface MetricsQueryParams {
  metricTypes?: MetricType[];
  timeRange: TimeRange;
  tags?: Record<string, string>;
  aggregation?: 'none' | '1m' | '5m' | '1h' | '1d';
}
```

- [ ] **Step 2: 提交类型定义**

```bash
git add src/types/monitoring.ts
git commit -m "feat: 添加监控和告警类型定义

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: 指标收集器

**Files:**
- Create: `src/lib/metrics/collector.ts`
- Create: `src/lib/metrics/types.ts`

- [ ] **Step 1: 创建指标收集器核心实现**

```typescript
// src/lib/metrics/types.ts

import type { MetricDataPoint, MetricType } from '@/types/monitoring';

export interface MetricCollectorOptions {
  maxDataPoints: number;
  flushInterval: number;
}

export type MetricCallback = (metrics: MetricDataPoint[]) => void | Promise<void>;

export { type MetricDataPoint, type MetricType };
```

```typescript
// src/lib/metrics/collector.ts

import type { MetricDataPoint, MetricType, AggregatedMetric, MetricValue } from '@/types/monitoring';
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
```

- [ ] **Step 2: 提交指标收集器**

```bash
git add src/lib/metrics/collector.ts src/lib/metrics/types.ts
git commit -m "feat: 实现指标收集器

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: API请求指标中间件

**Files:**
- Create: `src/lib/middleware/metrics-middleware.ts`

- [ ] **Step 1: 创建API请求指标收集中间件**

```typescript
// src/lib/middleware/metrics-middleware.ts

import { NextRequest, NextResponse } from 'next/server';
import { recordMetric, recordTiming, incrementMetric } from '@/lib/metrics/collector';

/**
 * 请求指标中间件
 * 收集API请求的响应时间、状态码等指标
 */
export function withMetrics(
  handler: (request: NextRequest) => Promise<NextResponse>
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest) => {
    const startTime = Date.now();
    const path = request.nextUrl.pathname;
    const method = request.method;

    try {
      const response = await handler(request);
      const duration = Date.now() - startTime;

      // 记录响应时间
      recordTiming(
        `api:${path}`,
        'api_response_time',
        duration,
        {
          method,
          status: response.status.toString(),
          path: normalizePath(path),
        }
      );

      // 记录请求计数
      incrementMetric(
        `api:${path}`,
        'api_request_count',
        1,
        {
          method,
          status: response.status.toString(),
          path: normalizePath(path),
        }
      );

      // 记录错误
      if (response.status >= 400) {
        incrementMetric(
          `api:${path}`,
          'api_error_count',
          1,
          {
            method,
            status: response.status.toString(),
            path: normalizePath(path),
          }
        );
      }

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;

      // 记录异常
      recordTiming(
        `api:${path}`,
        'api_response_time',
        duration,
        {
          method,
          status: '500',
          path: normalizePath(path),
          error: 'true',
        }
      );

      incrementMetric(
        `api:${path}`,
        'api_error_count',
        1,
        {
          method,
          status: '500',
          path: normalizePath(path),
          error: 'unhandled',
        }
      );

      throw error;
    }
  };
}

/**
 * 规范化路径（移除动态参数ID）
 */
function normalizePath(path: string): string {
  return path
    .replace(/\/[a-f0-9]{25,}(?=\/|$)/gi, '/:id') // CUID
    .replace(/\/[a-f0-9-]{36}(?=\/|$)/gi, '/:id') // UUID
    .replace(/\/\d+(?=\/|$)/g, '/:id'); // 数字ID
}

/**
 * 创建响应时间头
 */
export function addTimingHeaders(
  response: NextResponse,
  startTime: number
): NextResponse {
  const duration = Date.now() - startTime;
  response.headers.set('X-Response-Time', `${duration}ms`);
  return response;
}
```

- [ ] **Step 2: 提交中间件**

```bash
git add src/lib/middleware/metrics-middleware.ts
git commit -m "feat: 添加API请求指标收集中间件

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: 数据库模型更新

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: 添加告警规则和告警历史模型**

在 `prisma/schema.prisma` 文件末尾添加：

```prisma
// ============================================
// 监控告警系统
// ============================================

// 告警规则
model AlertRule {
  id          String   @id @default(cuid())
  name        String   @unique
  description String?
  
  // 指标配置
  metricType  String   // api_response_time, error_rate, etc.
  condition   String   // JSON: { type: 'threshold', operator: 'gt', value: 100 }
  
  // 告警配置
  severity    String   @default("medium") // critical, high, medium, low, info
  enabled     Boolean  @default(true)
  cooldownPeriod Int   @default(300) // 冷却期（秒）
  
  // 通知配置
  notificationChannels String // JSON: ["email", "webhook"]
  
  // 标签过滤
  tags        String?  // JSON: { path: "/api/workflows" }
  
  // 状态
  lastTriggeredAt DateTime?
  triggerCount Int     @default(0)
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // 关系
  alerts      AlertInstance[]

  @@index([metricType])
  @@index([enabled])
  @@index([severity])
}

// 告警实例
model AlertInstance {
  id          String   @id @default(cuid())
  ruleId      String
  
  // 告警信息
  ruleName    String
  severity    String   // critical, high, medium, low, info
  status      String   @default("active") // active, resolved, acknowledged, silenced
  message     String
  
  // 触发详情
  value       Float
  threshold   Float
  triggeredAt DateTime @default(now())
  
  // 处理信息
  resolvedAt  DateTime?
  acknowledgedAt DateTime?
  acknowledgedBy String?
  details     String?  // JSON: 额外详情
  
  // 通知状态
  notifiedChannels String? // JSON: 已通知的渠道
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // 关系
  rule        AlertRule @relation(fields: [ruleId], references: [id], onDelete: Cascade)

  @@index([ruleId])
  @@index([status])
  @@index([severity])
  @@index([triggeredAt])
}

// 通知渠道配置
model NotificationChannel {
  id          String   @id @default(cuid())
  name        String   @unique
  type        String   // email, webhook, slack, dingtalk, wechat
  config      String   // JSON: 渠道特定配置
  enabled     Boolean  @default(true)
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([type])
  @@index([enabled])
}

// 系统指标存储（用于历史查询）
model SystemMetric {
  id          String   @id @default(cuid())
  name        String
  type        String   // api_response_time, db_query_time, etc.
  value       Float
  tags        String?  // JSON: { path: "/api/workflows", method: "GET" }
  recordedAt  DateTime @default(now())

  @@index([type])
  @@index([name])
  @@index([recordedAt])
}
```

- [ ] **Step 2: 运行数据库迁移**

```bash
npx prisma db push
```

- [ ] **Step 3: 提交模型变更**

```bash
git add prisma/schema.prisma
git commit -m "feat: 添加告警规则和指标存储数据库模型

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: 告警引擎

**Files:**
- Create: `src/lib/monitoring/alert-engine.ts`

- [ ] **Step 1: 创建告警引擎核心实现**

```typescript
// src/lib/monitoring/alert-engine.ts

import { prisma } from '@/lib/prisma';
import type { AlertRule, AlertInstance, AlertCondition, MetricType } from '@/types/monitoring';
import { metricsCollector } from '@/lib/metrics/collector';
import { sendAlertNotification } from './alert-notifier';

/**
 * 告警引擎
 * 评估指标并触发告警
 */
export class AlertEngine {
  private checkInterval: number;
  private checkTimer?: NodeJS.Timeout;

  constructor(checkIntervalSeconds: number = 60) {
    this.checkInterval = checkIntervalSeconds * 1000;
  }

  /**
   * 启动告警检查
   */
  start(): void {
    this.checkTimer = setInterval(() => {
      this.checkAllRules().catch(console.error);
    }, this.checkInterval);
  }

  /**
   * 停止告警检查
   */
  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }
  }

  /**
   * 检查所有启用的规则
   */
  async checkAllRules(): Promise<void> {
    const rules = await prisma.alertRule.findMany({
      where: { enabled: true },
    });

    for (const rule of rules) {
      try {
        await this.checkRule(rule);
      } catch (error) {
        console.error(`Error checking rule ${rule.name}:`, error);
      }
    }
  }

  /**
   * 检查单个规则
   */
  async checkRule(rule: {
    id: string;
    name: string;
    metricType: string;
    condition: string;
    severity: string;
    cooldownPeriod: number;
    lastTriggeredAt: Date | null;
    notificationChannels: string;
    tags: string | null;
  }): Promise<void> {
    const condition = JSON.parse(rule.condition) as AlertCondition;
    const metricType = rule.metricType as MetricType;
    const tags = rule.tags ? JSON.parse(rule.tags) : undefined;

    // 检查冷却期
    if (rule.lastTriggeredAt) {
      const cooldownEnd = new Date(
        rule.lastTriggeredAt.getTime() + rule.cooldownPeriod * 1000
      );
      if (new Date() < cooldownEnd) {
        return; // 还在冷却期
      }
    }

    // 评估条件
    const evaluation = await this.evaluateCondition(metricType, condition, tags);

    if (evaluation.triggered) {
      await this.triggerAlert(rule, evaluation.value, evaluation.threshold);
    }
  }

  /**
   * 评估告警条件
   */
  private async evaluateCondition(
    metricType: MetricType,
    condition: AlertCondition,
    tags?: Record<string, string>
  ): Promise<{ triggered: boolean; value: number; threshold: number }> {
    // 获取最近5分钟的聚合数据
    const aggregationPeriod = 300; // 5分钟
    const metrics = metricsCollector.getMetrics(undefined, metricType);
    
    // 过滤时间范围内的数据
    const now = Date.now();
    const periodStart = now - aggregationPeriod * 1000;
    const recentMetrics = metrics.filter(
      (m) => m.timestamp.getTime() >= periodStart
    );

    // 过滤标签
    const filteredMetrics = tags
      ? recentMetrics.filter((m) =>
          Object.entries(tags).every(([k, v]) => m.tags[k] === v)
        )
      : recentMetrics;

    if (filteredMetrics.length === 0) {
      return { triggered: false, value: 0, threshold: 0 };
    }

    const values = filteredMetrics.map((m) => m.value);
    const avgValue = values.reduce((a, b) => a + b, 0) / values.length;

    switch (condition.type) {
      case 'threshold': {
        const threshold = condition.value;
        let triggered = false;

        switch (condition.operator) {
          case 'gt':
            triggered = avgValue > threshold;
            break;
          case 'lt':
            triggered = avgValue < threshold;
            break;
          case 'gte':
            triggered = avgValue >= threshold;
            break;
          case 'lte':
            triggered = avgValue <= threshold;
            break;
          case 'eq':
            triggered = avgValue === threshold;
            break;
        }

        return { triggered, value: avgValue, threshold };
      }

      case 'rate': {
        // 计算错误率等
        const threshold = condition.threshold;
        const errorCount = filteredMetrics.filter(
          (m) => m.tags.status?.startsWith('4') || m.tags.status?.startsWith('5')
        ).length;
        const rate = filteredMetrics.length > 0 ? errorCount / filteredMetrics.length : 0;
        return { triggered: rate > threshold, value: rate, threshold };
      }

      case 'absence': {
        // 检查是否有数据缺失
        const threshold = 0;
        const hasData = filteredMetrics.length > 0;
        return { triggered: !hasData, value: filteredMetrics.length, threshold };
      }

      default:
        return { triggered: false, value: 0, threshold: 0 };
    }
  }

  /**
   * 触发告警
   */
  private async triggerAlert(
    rule: {
      id: string;
      name: string;
      severity: string;
      notificationChannels: string;
    },
    value: number,
    threshold: number
  ): Promise<void> {
    // 创建告警实例
    const alert = await prisma.alertInstance.create({
      data: {
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        status: 'active',
        message: `${rule.name}: 当前值 ${value.toFixed(2)}, 阈值 ${threshold}`,
        value,
        threshold,
        triggeredAt: new Date(),
      },
    });

    // 更新规则触发时间
    await prisma.alertRule.update({
      where: { id: rule.id },
      data: {
        lastTriggeredAt: new Date(),
        triggerCount: { increment: 1 },
      },
    });

    // 发送通知
    const channels = JSON.parse(rule.notificationChannels) as string[];
    await sendAlertNotification(alert, channels);
  }

  /**
   * 确认告警
   */
  async acknowledgeAlert(alertId: string, userId: string): Promise<AlertInstance | null> {
    const alert = await prisma.alertInstance.update({
      where: { id: alertId },
      data: {
        status: 'acknowledged',
        acknowledgedAt: new Date(),
        acknowledgedBy: userId,
      },
    });

    return alert;
  }

  /**
   * 解决告警
   */
  async resolveAlert(alertId: string): Promise<AlertInstance | null> {
    const alert = await prisma.alertInstance.update({
      where: { id: alertId },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
      },
    });

    return alert;
  }
}

// 全局告警引擎实例
export const alertEngine = new AlertEngine();
```

- [ ] **Step 2: 提交告警引擎**

```bash
git add src/lib/monitoring/alert-engine.ts
git commit -m "feat: 实现告警引擎

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: 告警通知器

**Files:**
- Create: `src/lib/monitoring/alert-notifier.ts`

- [ ] **Step 1: 创建告警通知发送器**

```typescript
// src/lib/monitoring/alert-notifier.ts

import { prisma } from '@/lib/prisma';
import type { AlertInstance, NotificationChannelType } from '@/types/monitoring';

/**
 * 发送告警通知
 */
export async function sendAlertNotification(
  alert: AlertInstance,
  channels: string[]
): Promise<void> {
  // 获取启用的通知渠道配置
  const channelConfigs = await prisma.notificationChannel.findMany({
    where: {
      name: { in: channels },
      enabled: true,
    },
  });

  const notifiedChannels: string[] = [];

  for (const config of channelConfigs) {
    try {
      const success = await sendToChannel(config.type as NotificationChannelType, config.config, alert);
      if (success) {
        notifiedChannels.push(config.name);
      }
    } catch (error) {
      console.error(`Failed to send alert to ${config.name}:`, error);
    }
  }

  // 更新已通知渠道
  if (notifiedChannels.length > 0) {
    await prisma.alertInstance.update({
      where: { id: alert.id },
      data: {
        notifiedChannels: JSON.stringify(notifiedChannels),
      },
    });
  }
}

/**
 * 发送到指定渠道
 */
async function sendToChannel(
  type: NotificationChannelType,
  configStr: string,
  alert: AlertInstance
): Promise<boolean> {
  const config = JSON.parse(configStr);

  switch (type) {
    case 'webhook':
      return sendWebhook(config, alert);
    case 'email':
      return sendEmail(config, alert);
    case 'slack':
      return sendSlack(config, alert);
    case 'dingtalk':
      return sendDingTalk(config, alert);
    case 'wechat':
      return sendWeChat(config, alert);
    default:
      console.warn(`Unknown notification channel type: ${type}`);
      return false;
  }
}

/**
 * Webhook 通知
 */
async function sendWebhook(
  config: { url: string; headers?: Record<string, string> },
  alert: AlertInstance
): Promise<boolean> {
  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body: JSON.stringify({
        alertId: alert.id,
        ruleName: alert.ruleName,
        severity: alert.severity,
        status: alert.status,
        message: alert.message,
        value: alert.value,
        threshold: alert.threshold,
        triggeredAt: alert.triggeredAt,
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('Webhook notification failed:', error);
    return false;
  }
}

/**
 * 邮件通知
 */
async function sendEmail(
  config: { recipients: string[]; smtpConfig?: Record<string, unknown> },
  alert: AlertInstance
): Promise<boolean> {
  // 邮件发送需要配置 SMTP，这里仅记录日志
  console.log(`[EMAIL ALERT] To: ${config.recipients.join(', ')}`);
  console.log(`[EMAIL ALERT] Subject: [${alert.severity.toUpperCase()}] ${alert.ruleName}`);
  console.log(`[EMAIL ALERT] Body: ${alert.message}`);
  
  // TODO: 实现实际邮件发送逻辑
  // 需要配置 nodemailer 或其他邮件服务
  return true;
}

/**
 * Slack 通知
 */
async function sendSlack(
  config: { webhookUrl: string },
  alert: AlertInstance
): Promise<boolean> {
  try {
    const color = getSeverityColor(alert.severity);
    
    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attachments: [{
          color,
          title: `[${alert.severity.toUpperCase()}] ${alert.ruleName}`,
          text: alert.message,
          fields: [
            { title: '当前值', value: alert.value.toFixed(2), short: true },
            { title: '阈值', value: alert.threshold.toFixed(2), short: true },
            { title: '触发时间', value: alert.triggeredAt.toISOString(), short: false },
          ],
        }],
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('Slack notification failed:', error);
    return false;
  }
}

/**
 * 钉钉通知
 */
async function sendDingTalk(
  config: { webhookUrl: string; secret?: string },
  alert: AlertInstance
): Promise<boolean> {
  try {
    const body: Record<string, unknown> = {
      msgtype: 'markdown',
      markdown: {
        title: `[${alert.severity.toUpperCase()}] ${alert.ruleName}`,
        text: `### ${alert.ruleName}\n\n` +
              `**严重级别**: ${alert.severity}\n\n` +
              `**消息**: ${alert.message}\n\n` +
              `**当前值**: ${alert.value.toFixed(2)}\n\n` +
              `**阈值**: ${alert.threshold.toFixed(2)}\n\n` +
              `**触发时间**: ${alert.triggeredAt.toISOString()}`,
      },
    };

    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    return response.ok;
  } catch (error) {
    console.error('DingTalk notification failed:', error);
    return false;
  }
}

/**
 * 企业微信通知
 */
async function sendWeChat(
  config: { webhookUrl: string },
  alert: AlertInstance
): Promise<boolean> {
  try {
    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          content: `### ${alert.ruleName}\n` +
                   `> **严重级别**: ${alert.severity}\n` +
                   `> **消息**: ${alert.message}\n` +
                   `> **当前值**: ${alert.value.toFixed(2)}\n` +
                   `> **阈值**: ${alert.threshold.toFixed(2)}\n` +
                   `> **触发时间**: ${alert.triggeredAt.toISOString()}`,
        },
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('WeChat notification failed:', error);
    return false;
  }
}

/**
 * 获取严重级别颜色
 */
function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'critical':
      return '#FF0000';
    case 'high':
      return '#FF6600';
    case 'medium':
      return '#FFCC00';
    case 'low':
      return '#3399FF';
    case 'info':
      return '#999999';
    default:
      return '#999999';
  }
}
```

- [ ] **Step 2: 提交告警通知器**

```bash
git add src/lib/monitoring/alert-notifier.ts
git commit -m "feat: 实现告警通知器（支持Webhook/Slack/钉钉/企业微信）

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: 健康检查

**Files:**
- Create: `src/lib/monitoring/health-check.ts`

- [ ] **Step 1: 创建系统健康检查模块**

```typescript
// src/lib/monitoring/health-check.ts

import { prisma } from '@/lib/prisma';
import type { HealthCheckResult, SystemHealthReport, HealthStatus } from '@/types/monitoring';
import { getAllCacheStats } from '@/lib/cache';

const START_TIME = Date.now();

/**
 * 执行所有健康检查
 */
export async function runHealthChecks(): Promise<SystemHealthReport> {
  const checks = await Promise.all([
    checkDatabase(),
    checkMemory(),
    checkCache(),
  ]);

  // 计算整体状态
  const status = calculateOverallStatus(checks);

  // 收集系统指标
  const memoryUsage = process.memoryUsage();
  const cacheStats = getAllCacheStats();

  return {
    status,
    version: process.env.npm_package_version || '1.0.0',
    uptime: Date.now() - START_TIME,
    timestamp: new Date(),
    checks,
    metrics: {
      cpu: 0, // Node.js 不直接提供 CPU 使用率
      memory: memoryUsage.heapUsed / memoryUsage.heapTotal,
      dbConnections: 1, // SQLite 只有一个连接
      cacheHitRate: Object.values(cacheStats).reduce(
        (sum, s) => sum + s.hitRate,
        0
      ) / Object.keys(cacheStats).length,
    },
  };
}

/**
 * 数据库健康检查
 */
async function checkDatabase(): Promise<HealthCheckResult> {
  const startTime = Date.now();
  
  try {
    // 执行简单查询
    await prisma.$queryRaw`SELECT 1`;
    
    const responseTime = Date.now() - startTime;
    
    return {
      name: 'database',
      status: responseTime < 1000 ? 'healthy' : 'degraded',
      message: `数据库连接正常`,
      responseTime,
      checkedAt: new Date(),
    };
  } catch (error) {
    return {
      name: 'database',
      status: 'unhealthy',
      message: `数据库连接失败: ${error instanceof Error ? error.message : 'Unknown error'}`,
      responseTime: Date.now() - startTime,
      checkedAt: new Date(),
    };
  }
}

/**
 * 内存健康检查
 */
async function checkMemory(): Promise<HealthCheckResult> {
  const memory = process.memoryUsage();
  const heapUsedMB = memory.heapUsed / 1024 / 1024;
  const heapTotalMB = memory.heapTotal / 1024 / 1024;
  const usagePercent = memory.heapUsed / memory.heapTotal;
  
  let status: HealthStatus = 'healthy';
  let message = `内存使用: ${heapUsedMB.toFixed(2)}MB / ${heapTotalMB.toFixed(2)}MB (${(usagePercent * 100).toFixed(1)}%)`;
  
  if (usagePercent > 0.9) {
    status = 'unhealthy';
    message = `内存使用过高: ${(usagePercent * 100).toFixed(1)}%`;
  } else if (usagePercent > 0.75) {
    status = 'degraded';
    message = `内存使用警告: ${(usagePercent * 100).toFixed(1)}%`;
  }
  
  return {
    name: 'memory',
    status,
    message,
    details: {
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      rss: memory.rss,
      external: memory.external,
    },
    checkedAt: new Date(),
  };
}

/**
 * 缓存健康检查
 */
async function checkCache(): Promise<HealthCheckResult> {
  const stats = getAllCacheStats();
  const totalKeys = Object.values(stats).reduce((sum, s) => sum + s.keys, 0);
  const avgHitRate = Object.values(stats).reduce((sum, s) => sum + s.hitRate, 0) / Object.keys(stats).length;
  
  let status: HealthStatus = 'healthy';
  let message = `缓存正常, ${totalKeys} 个键, 平均命中率 ${(avgHitRate * 100).toFixed(1)}%`;
  
  if (avgHitRate < 0.3 && totalKeys > 100) {
    status = 'degraded';
    message = `缓存命中率偏低: ${(avgHitRate * 100).toFixed(1)}%`;
  }
  
  return {
    name: 'cache',
    status,
    message,
    details: stats,
    checkedAt: new Date(),
  };
}

/**
 * 计算整体状态
 */
function calculateOverallStatus(checks: HealthCheckResult[]): HealthStatus {
  if (checks.some((c) => c.status === 'unhealthy')) {
    return 'unhealthy';
  }
  if (checks.some((c) => c.status === 'degraded')) {
    return 'degraded';
  }
  return 'healthy';
}

/**
 * 获取系统启动时间
 */
export function getUptime(): number {
  return Date.now() - START_TIME;
}
```

- [ ] **Step 2: 提交健康检查模块**

```bash
git add src/lib/monitoring/health-check.ts
git commit -m "feat: 实现系统健康检查模块

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 8: 监控API端点

**Files:**
- Create: `src/app/api/admin/health/route.ts`
- Create: `src/app/api/admin/metrics/route.ts`
- Create: `src/app/api/admin/alerts/route.ts`
- Create: `src/app/api/admin/alerts/history/route.ts`

- [ ] **Step 1: 创建健康检查API**

```typescript
// src/app/api/admin/health/route.ts

import { NextResponse } from 'next/server';
import { runHealthChecks } from '@/lib/monitoring/health-check';

export async function GET() {
  try {
    const healthReport = await runHealthChecks();
    
    const statusCode = healthReport.status === 'healthy' ? 200 
      : healthReport.status === 'degraded' ? 200 
      : 503;
    
    return NextResponse.json(healthReport, { status: statusCode });
  } catch (error) {
    console.error('Health check error:', error);
    return NextResponse.json(
      { 
        status: 'unhealthy', 
        error: 'Health check failed',
        timestamp: new Date(),
      },
      { status: 503 }
    );
  }
}
```

- [ ] **Step 2: 创建指标查询API**

```typescript
// src/app/api/admin/metrics/route.ts

import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { metricsCollector } from '@/lib/metrics/collector';
import { getAllCacheStats } from '@/lib/cache';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || undefined;
    const since = searchParams.get('since') ? new Date(searchParams.get('since')!) : undefined;

    // 获取指标数据
    const metrics = metricsCollector.getMetrics(undefined, type as any, since);
    const stats = metricsCollector.getStats();
    const cacheStats = getAllCacheStats();

    // 获取数据库统计
    const [
      userCount,
      workflowCount,
      executionCount,
      activeExecutions,
      vulnerabilityCount,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.workflow.count(),
      prisma.workflowExecution.count(),
      prisma.workflowExecution.count({ where: { status: 'running' } }),
      prisma.vulnerability.count({ where: { status: 'new' } }),
    ]);

    return NextResponse.json({
      metrics: metrics.slice(0, 100), // 限制返回数量
      stats,
      cache: cacheStats,
      database: {
        users: userCount,
        workflows: workflowCount,
        executions: executionCount,
        activeExecutions,
        newVulnerabilities: vulnerabilityCount,
      },
    });
  } catch (error) {
    console.error('Get metrics error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 3: 创建告警规则管理API**

```typescript
// src/app/api/admin/alerts/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import type { AlertCondition } from '@/types/monitoring';

// GET /api/admin/alerts - 获取告警规则列表
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const rules = await prisma.alertRule.findMany({
      include: {
        _count: {
          select: { alerts: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      rules: rules.map((rule) => ({
        ...rule,
        condition: JSON.parse(rule.condition),
        notificationChannels: JSON.parse(rule.notificationChannels),
        tags: rule.tags ? JSON.parse(rule.tags) : null,
        alertCount: rule._count.alerts,
      })),
    });
  } catch (error) {
    console.error('Get alert rules error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/admin/alerts - 创建告警规则
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const body = await request.json();
    const { name, description, metricType, condition, severity, cooldownPeriod, notificationChannels, tags } = body;

    if (!name || !metricType || !condition || !notificationChannels) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    const rule = await prisma.alertRule.create({
      data: {
        name,
        description,
        metricType,
        condition: JSON.stringify(condition as AlertCondition),
        severity: severity || 'medium',
        cooldownPeriod: cooldownPeriod || 300,
        notificationChannels: JSON.stringify(notificationChannels),
        tags: tags ? JSON.stringify(tags) : null,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'alert_rule_create',
        resource: rule.id,
        details: JSON.stringify({ name, metricType }),
      },
    });

    return NextResponse.json({
      message: '告警规则已创建',
      rule,
    }, { status: 201 });
  } catch (error) {
    console.error('Create alert rule error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 4: 创建告警历史API**

```typescript
// src/app/api/admin/alerts/history/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';

// GET /api/admin/alerts/history - 获取告警历史
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status') || undefined;
    const severity = searchParams.get('severity') || undefined;
    const ruleId = searchParams.get('ruleId') || undefined;

    const { skip, take, page: pageNum, limit: pageLimit } = getOffsetPagination({ page, limit });

    const where = {
      ...(status && { status }),
      ...(severity && { severity }),
      ...(ruleId && { ruleId }),
    };

    const [total, alerts] = await Promise.all([
      prisma.alertInstance.count({ where }),
      prisma.alertInstance.findMany({
        where,
        skip,
        take,
        orderBy: { triggeredAt: 'desc' },
      }),
    ]);

    return NextResponse.json(createPaginatedResponse(alerts, total, pageNum, pageLimit));
  } catch (error) {
    console.error('Get alert history error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 5: 提交监控API**

```bash
git add src/app/api/admin/health/route.ts src/app/api/admin/metrics/route.ts src/app/api/admin/alerts/route.ts src/app/api/admin/alerts/history/route.ts
git commit -m "feat: 添加健康检查、指标查询和告警管理API

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 9: 通知渠道管理API

**Files:**
- Create: `src/app/api/admin/notifications/route.ts`
- Create: `src/app/api/admin/notifications/[id]/route.ts`

- [ ] **Step 1: 创建通知渠道管理API**

```typescript
// src/app/api/admin/notifications/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import type { NotificationChannelType } from '@/types/monitoring';

// GET /api/admin/notifications - 获取通知渠道列表
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const channels = await prisma.notificationChannel.findMany({
      orderBy: { createdAt: 'desc' },
    });

    // 隐藏敏感配置
    const sanitizedChannels = channels.map((channel) => ({
      ...channel,
      config: maskSensitiveConfig(channel.type, channel.config),
    }));

    return NextResponse.json({ channels: sanitizedChannels });
  } catch (error) {
    console.error('Get notification channels error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/admin/notifications - 创建通知渠道
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const body = await request.json();
    const { name, type, config, enabled } = body;

    if (!name || !type || !config) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    // 验证渠道类型
    const validTypes: NotificationChannelType[] = ['email', 'webhook', 'slack', 'dingtalk', 'wechat'];
    if (!validTypes.includes(type)) {
      return NextResponse.json({ error: '无效的渠道类型' }, { status: 400 });
    }

    const channel = await prisma.notificationChannel.create({
      data: {
        name,
        type,
        config: JSON.stringify(config),
        enabled: enabled ?? true,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'notification_channel_create',
        resource: channel.id,
        details: JSON.stringify({ name, type }),
      },
    });

    return NextResponse.json({
      message: '通知渠道已创建',
      channel: {
        ...channel,
        config: maskSensitiveConfig(channel.type, channel.config),
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Create notification channel error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * 隐藏敏感配置信息
 */
function maskSensitiveConfig(type: string, configStr: string): Record<string, unknown> {
  const config = JSON.parse(configStr);
  
  switch (type) {
    case 'webhook':
    case 'slack':
    case 'dingtalk':
    case 'wechat':
      if (config.webhookUrl) {
        config.webhookUrl = maskUrl(config.webhookUrl);
      }
      break;
    case 'email':
      if (config.smtpPassword) {
        config.smtpPassword = '******';
      }
      break;
  }
  
  return config;
}

/**
 * 遮蔽URL中的敏感部分
 */
function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // 保留协议和域名，遮蔽路径
    return `${parsed.protocol}//${parsed.host}/***`;
  } catch {
    return '***';
  }
}
```

```typescript
// src/app/api/admin/notifications/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/admin/notifications/[id] - 获取单个通知渠道
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;

    const channel = await prisma.notificationChannel.findUnique({
      where: { id },
    });

    if (!channel) {
      return NextResponse.json({ error: '通知渠道不存在' }, { status: 404 });
    }

    return NextResponse.json({ channel });
  } catch (error) {
    console.error('Get notification channel error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PUT /api/admin/notifications/[id] - 更新通知渠道
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { name, config, enabled } = body;

    const channel = await prisma.notificationChannel.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(config && { config: JSON.stringify(config) }),
        ...(enabled !== undefined && { enabled }),
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'notification_channel_update',
        resource: id,
        details: JSON.stringify({ name }),
      },
    });

    return NextResponse.json({
      message: '通知渠道已更新',
      channel,
    });
  } catch (error) {
    console.error('Update notification channel error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/admin/notifications/[id] - 删除通知渠道
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_DELETE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;

    await prisma.notificationChannel.delete({
      where: { id },
    });

    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'notification_channel_delete',
        resource: id,
      },
    });

    return NextResponse.json({ message: '通知渠道已删除' });
  } catch (error) {
    console.error('Delete notification channel error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
```

- [ ] **Step 2: 提交通知渠道API**

```bash
git add src/app/api/admin/notifications/route.ts src/app/api/admin/notifications/[id]/route.ts
git commit -m "feat: 添加通知渠道管理API

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 10: 构建验证

**Files:**
- None (测试验证)

- [ ] **Step 1: 运行构建验证无错误**

```bash
npm run build
```

- [ ] **Step 2: 测试健康检查API**

```bash
curl http://localhost:3000/api/admin/health
```

预期: 返回系统健康状态JSON

- [ ] **Step 3: 测试告警规则API**

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/admin/alerts
```

预期: 返回告警规则列表

---

## 总结

本计划实现了:
1. **指标类型定义** - 完整的监控和告警类型系统
2. **指标收集器** - 内存指标收集和聚合
3. **请求中间件** - API请求指标自动收集
4. **数据库模型** - 告警规则、告警实例、通知渠道、系统指标
5. **告警引擎** - 规则评估和告警触发
6. **告警通知器** - 多渠道通知发送（Webhook/Slack/钉钉/企业微信）
7. **健康检查** - 数据库、内存、缓存状态检查
8. **监控API** - 健康检查、指标查询、告警管理、通知渠道管理
