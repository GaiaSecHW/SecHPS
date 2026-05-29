'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiGet } from '@/lib/api-client';
import {
  Activity,
  Database,
  MemoryStick,
  Server,
  Clock,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Loader2,
  HardDrive,
  Zap,
  Network,
  GitBranch,
  FolderOpen,
} from 'lucide-react';
import { PERMISSIONS } from '@/types/permissions';

// ===== 类型定义 =====

interface HealthCheckResult {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  details?: Record<string, unknown>;
  responseTime?: number;
  checkedAt: string;
}

interface InfrastructureService {
  name: string;
  type: string;
  host: string;
  port?: string;
  database?: string;
  configured: boolean;
  status: 'connected' | 'unreachable' | 'not_configured';
  message?: string;
  responseTime?: number;
}

interface InfrastructureInfo {
  database: InfrastructureService;
  redis: InfrastructureService;
  gitea: InfrastructureService;
  minio: InfrastructureService;
  nfs: InfrastructureService;
}

interface SystemHealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  timestamp: string;
  checks: HealthCheckResult[];
  metrics: {
    cpu: number;
    memory: number;
    dbConnections: number;
    cacheHitRate: number;
  };
  infrastructure: InfrastructureInfo;
}

interface CacheStats {
  keys: number;
  hits: number;
  misses: number;
  hitRate: number;
  ksize: number;
  vsize: number;
}

interface MetricsResponse {
  stats: {
    totalDataPoints: number;
    metricCount: number;
    oldestDataPoint?: string;
  };
  database: {
    users: number;
    newVulnerabilities: number;
  };
  cache: Record<string, CacheStats>;
}

// ===== 工具函数 =====

function formatUptime(ms: number): string {
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  if (days > 0) return `${days}天 ${hours}小时`;
  if (hours > 0) return `${hours}小时 ${minutes}分钟`;
  if (minutes > 0) return `${minutes}分钟 ${seconds}秒`;
  return `${seconds}秒`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

const statusConfig = {
  healthy: { color: 'text-green-400', bg: 'bg-green-900/20', border: 'border-green-800/40', icon: CheckCircle2, label: '正常' },
  degraded: { color: 'text-yellow-400', bg: 'bg-yellow-900/20', border: 'border-yellow-800/40', icon: AlertTriangle, label: '警告' },
  unhealthy: { color: 'text-red-400', bg: 'bg-red-900/20', border: 'border-red-800/40', icon: AlertCircle, label: '异常' },
};

const infraStatusConfig = {
  connected: { color: 'text-green-400', bg: 'bg-green-900/20', border: 'border-green-800/40', icon: CheckCircle2, label: '已连接' },
  unreachable: { color: 'text-red-400', bg: 'bg-red-900/20', border: 'border-red-800/40', icon: AlertCircle, label: '不可达' },
  not_configured: { color: 'text-dark-text-muted', bg: 'bg-gray-900/20', border: 'border-gray-800/40', icon: AlertTriangle, label: '未配置' },
};

const infraIconMap: Record<string, typeof Database> = {
  database: Database,
  'cache-queue': Zap,
  'git-storage': GitBranch,
  'object-storage': HardDrive,
  'file-storage': FolderOpen,
};

// ===== 主组件 =====

export default function MonitoringPage() {
  const [user, setUser] = useState<any>(null);
  const [health, setHealth] = useState<SystemHealthReport | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const hasPermission = (permission: string) =>
    user?.permissions?.includes(permission) || user?.roles?.includes('admin');

  const fetchData = useCallback(async (showRefresh = false) => {
    try {
      if (showRefresh) setRefreshing(true);
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

      // health API returns 503 when system is unhealthy — that's valid data, not an error
      const [healthRes, metricsResult] = await Promise.all([
        fetch('/api/admin/health', { headers }),
        apiGet<MetricsResponse>('/api/admin/metrics'),
      ]);

      if (!healthRes.ok && healthRes.status !== 503) {
        throw new Error('获取健康数据失败');
      }
      if (metricsResult.error) {
        throw new Error(metricsResult.error);
      }

      setHealth(await healthRes.json());
      setMetrics(metricsResult.data);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) setUser(JSON.parse(userData));
    fetchData();
    // 每 30 秒自动刷新
    const timer = setInterval(() => fetchData(), 30000);
    return () => clearInterval(timer);
  }, [fetchData]);

  if (!hasPermission(PERMISSIONS.CONFIG_READ)) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-dark-text mb-2">访问被拒绝</h2>
          <p className="text-dark-text-muted">您没有查看系统监控的权限。</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const overallStatus = health ? statusConfig[health.status] : statusConfig.unhealthy;
  const OverallIcon = overallStatus.icon;

  // 提取检查结果
  const dbCheck = health?.checks?.find(c => c.name === 'database');
  const memCheck = health?.checks?.find(c => c.name === 'memory');
  const cacheCheck = health?.checks?.find(c => c.name === 'cache');

  // 缓存统计汇总
  const cacheEntries = metrics?.cache ? Object.entries(metrics.cache) : [];
  const totalCacheKeys = cacheEntries.reduce((sum, [, s]) => sum + s.keys, 0);
  const totalCacheHits = cacheEntries.reduce((sum, [, s]) => sum + s.hits, 0);
  const totalCacheMisses = cacheEntries.reduce((sum, [, s]) => sum + s.misses, 0);
  const avgHitRate = cacheEntries.length > 0
    ? cacheEntries.reduce((sum, [, s]) => sum + s.hitRate, 0) / cacheEntries.length
    : 0;

  // 内存详情
  const memDetails = memCheck?.details as { heapUsed: number; heapTotal: number; rss: number; external: number } | undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-3">
        {lastRefresh && (
          <span className="text-sm text-dark-text-muted">
            上次刷新 {lastRefresh.toLocaleTimeString('zh-CN')}
          </span>
        )}
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 border border-dark-border text-dark-text-secondary rounded-md hover:bg-dark-surface-hover transition-colors disabled:opacity-50"
        >
          {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          刷新
        </button>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-800/40 text-red-300 px-4 py-3 rounded-md flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      )}

      {/* ===== 整体状态概览 ===== */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* 系统状态 */}
        <div className={`${overallStatus.bg} border ${overallStatus.border} rounded-xl px-4 py-4`}>
          <div className="flex items-center gap-3">
            <OverallIcon size={24} className={overallStatus.color} />
            <div>
              <p className="text-xs text-dark-text-muted">系统状态</p>
              <p className={`text-lg font-semibold ${overallStatus.color}`}>{overallStatus.label}</p>
            </div>
          </div>
        </div>

        {/* 运行时间 */}
        <div className="bg-dark-surface border border-dark-border rounded-xl px-4 py-4">
          <div className="flex items-center gap-3">
            <Clock size={20} className="text-blue-400" />
            <div>
              <p className="text-xs text-dark-text-muted">运行时间</p>
              <p className="text-sm font-medium text-gray-200">
                {health ? formatUptime(health.uptime) : '--'}
              </p>
              {health?.version && (
                <p className="text-xs text-dark-text-muted">v{health.version}</p>
              )}
            </div>
          </div>
        </div>

        {/* 内存使用 */}
        <div className="bg-dark-surface border border-dark-border rounded-xl px-4 py-4">
          <div className="flex items-center gap-3">
            <MemoryStick size={20} className="text-purple-400" />
            <div>
              <p className="text-xs text-dark-text-muted">内存使用</p>
              <p className="text-sm font-medium text-gray-200">
                {memDetails
                  ? `${formatBytes(memDetails.heapUsed)} / ${formatBytes(memDetails.heapTotal)}`
                  : '--'}
              </p>
              {health?.metrics.memory !== undefined && (
                <p className="text-xs text-dark-text-muted">{formatPercent(health.metrics.memory)}</p>
              )}
            </div>
          </div>
        </div>

        {/* 缓存命中率 */}
        <div className="bg-dark-surface border border-dark-border rounded-xl px-4 py-4">
          <div className="flex items-center gap-3">
            <Zap size={20} className="text-amber-400" />
            <div>
              <p className="text-xs text-dark-text-muted">缓存命中率</p>
              <p className="text-sm font-medium text-gray-200">
                {formatPercent(avgHitRate)}
              </p>
              <p className="text-xs text-dark-text-muted">{totalCacheKeys} 个键</p>
            </div>
          </div>
        </div>
      </div>

      {/* ===== 健康检查详情 ===== */}
      <div>
        <h2 className="text-base font-semibold text-dark-text-secondary mb-3 flex items-center gap-2 uppercase tracking-wider">
          <Server size={16} className="text-blue-400" />
          健康检查
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { check: dbCheck, icon: Database, label: '数据库', fallback: '数据库连接检查' },
            { check: memCheck, icon: MemoryStick, label: '内存', fallback: '内存使用检查' },
            { check: cacheCheck, icon: HardDrive, label: '缓存', fallback: '缓存状态检查' },
          ].map(({ check, icon: Icon, label, fallback }) => {
            const status = check ? statusConfig[check.status] : statusConfig.unhealthy;
            const StatusIcon = status.icon;
            return (
              <div key={label} className="bg-dark-surface border border-dark-border rounded-lg p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Icon size={18} className="text-dark-text-muted" />
                    <h3 className="text-sm font-medium text-gray-200">{label}</h3>
                  </div>
                  <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${status.bg} ${status.border} border ${status.color}`}>
                    <StatusIcon size={12} />
                    {status.label}
                  </div>
                </div>
                <p className="text-xs text-dark-text-muted mb-2">
                  {check?.message || fallback}
                </p>
                {check?.responseTime !== undefined && (
                  <p className="text-xs text-dark-text-muted">
                    响应时间: {formatDuration(check.responseTime)}
                  </p>
                )}
                {check?.status === 'unhealthy' && (
                  <p className="text-xs text-red-400 mt-1">
                    请检查服务是否正常运行
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ===== 基础设施连接 ===== */}
      {health?.infrastructure && (
        <div>
          <h2 className="text-base font-semibold text-dark-text-secondary mb-3 flex items-center gap-2 uppercase tracking-wider">
            <Network size={16} className="text-cyan-400" />
            基础设施连接
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {(['database', 'redis', 'gitea', 'minio', 'nfs'] as const).map(key => {
              const svc = health.infrastructure[key];
              const infra = infraStatusConfig[svc.status];
              const InfraIcon = infra.icon;
              const TypeIcon = infraIconMap[svc.type] || Server;
              return (
                <div key={key} className="bg-dark-surface border border-dark-border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <TypeIcon size={16} className="text-dark-text-muted" />
                      <h3 className="text-sm font-medium text-gray-200">{svc.name}</h3>
                    </div>
                    <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${infra.bg} ${infra.border} border ${infra.color}`}>
                      <InfraIcon size={12} />
                      {infra.label}
                    </div>
                  </div>
                  <div className="space-y-1 text-xs">
                    {svc.database && (
                      <div className="flex justify-between">
                        <span className="text-dark-text-muted">数据库</span>
                        <span className="text-dark-text-secondary font-medium">{svc.database}</span>
                      </div>
                    )}
                    {svc.host && (
                      <div className="flex justify-between">
                        <span className="text-dark-text-muted">地址</span>
                        <span className="text-dark-text-secondary">{svc.port ? `${svc.host}:${svc.port}` : svc.host}</span>
                      </div>
                    )}
                    {svc.responseTime !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-dark-text-muted">响应</span>
                        <span className="text-dark-text-secondary">{formatDuration(svc.responseTime)}</span>
                      </div>
                    )}
                    {svc.message && svc.status !== 'connected' && (
                      <p className="text-dark-text-muted mt-1">{svc.message}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== 缓存与数据库 ===== */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 缓存统计 */}
        <div>
          <h2 className="text-base font-semibold text-dark-text-secondary mb-3 flex items-center gap-2 uppercase tracking-wider">
            <HardDrive size={16} className="text-amber-400" />
            缓存统计
          </h2>
          <div className="bg-dark-surface border border-dark-border rounded-lg p-5">
            {cacheEntries.length > 0 ? (
              <div className="space-y-4">
                {/* 汇总 */}
                <div className="grid grid-cols-3 gap-4 pb-4 border-b border-gray-700/30">
                  <div>
                    <p className="text-xs text-dark-text-muted">总键数</p>
                    <p className="text-lg font-semibold text-gray-200">{totalCacheKeys}</p>
                  </div>
                  <div>
                    <p className="text-xs text-dark-text-muted">命中次数</p>
                    <p className="text-lg font-semibold text-green-400">{totalCacheHits}</p>
                  </div>
                  <div>
                    <p className="text-xs text-dark-text-muted">未命中次数</p>
                    <p className="text-lg font-semibold text-yellow-400">{totalCacheMisses}</p>
                  </div>
                </div>

                {/* 各缓存详情 */}
                {cacheEntries.map(([name, stats]) => (
                  <div key={name} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-dark-text-secondary">{name}</p>
                      <p className="text-xs text-dark-text-muted">{stats.keys} 个键</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-medium ${stats.hitRate >= 0.7 ? 'text-green-400' : stats.hitRate >= 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {formatPercent(stats.hitRate)}
                      </p>
                      <p className="text-xs text-dark-text-muted">命中率</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-dark-text-muted text-center py-6">暂无缓存数据</p>
            )}
          </div>
        </div>

        {/* 数据库统计 */}
        <div>
          <h2 className="text-base font-semibold text-dark-text-secondary mb-3 flex items-center gap-2 uppercase tracking-wider">
            <Database size={16} className="text-purple-400" />
            数据库统计
          </h2>
          <div className="bg-dark-surface border border-dark-border rounded-lg p-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-dark-surface-hover rounded-lg px-4 py-3">
                <p className="text-xs text-dark-text-muted">注册用户</p>
                <p className="text-2xl font-semibold text-gray-200">
                  {metrics?.database?.users ?? '--'}
                </p>
              </div>
              <div className="bg-dark-surface-hover rounded-lg px-4 py-3">
                <p className="text-xs text-dark-text-muted">待处理漏洞</p>
                <p className="text-2xl font-semibold text-orange-400">
                  {metrics?.database?.newVulnerabilities ?? '--'}
                </p>
              </div>
            </div>

            {/* 内存分配详情 */}
            {memDetails && (
              <div className="mt-4 pt-4 border-t border-gray-700/30 space-y-2">
                <p className="text-xs text-dark-text-muted font-medium mb-2">内存分配详情</p>
                {[
                  { label: '堆已用', value: formatBytes(memDetails.heapUsed) },
                  { label: '堆总量', value: formatBytes(memDetails.heapTotal) },
                  { label: 'RSS', value: formatBytes(memDetails.rss) },
                  { label: '外部', value: formatBytes(memDetails.external) },
                ].map(item => (
                  <div key={item.label} className="flex justify-between text-xs">
                    <span className="text-dark-text-muted">{item.label}</span>
                    <span className="text-dark-text-secondary">{item.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== 指标概览 ===== */}
      {metrics?.stats && (
        <div>
          <h2 className="text-base font-semibold text-dark-text-secondary mb-3 flex items-center gap-2 uppercase tracking-wider">
            <Activity size={16} className="text-green-400" />
            指标收集
          </h2>
          <div className="bg-dark-surface border border-dark-border rounded-lg p-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-dark-text-muted">收集的数据点</p>
                <p className="text-lg font-semibold text-gray-200">
                  {metrics.stats.totalDataPoints.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-dark-text-muted">指标类型数量</p>
                <p className="text-lg font-semibold text-gray-200">
                  {metrics.stats.metricCount ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs text-dark-text-muted">最早数据点</p>
                <p className="text-sm text-dark-text-secondary">
                  {metrics.stats.oldestDataPoint
                    ? new Date(metrics.stats.oldestDataPoint).toLocaleString('zh-CN')
                    : '暂无数据'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
