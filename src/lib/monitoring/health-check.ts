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
    console.error('[health-check] 数据库健康检查失败:', error instanceof Error ? error.message : String(error));
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
