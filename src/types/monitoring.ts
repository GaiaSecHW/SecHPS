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
