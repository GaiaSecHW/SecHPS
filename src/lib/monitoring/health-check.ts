// src/lib/monitoring/health-check.ts

import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';
import type { HealthCheckResult, SystemHealthReport, HealthStatus, InfrastructureService, InfrastructureInfo } from '@/types/monitoring';
import { getAllCacheStats } from '@/lib/cache';
import { parseDatabaseName } from '@/lib/system-info';
import fs from 'fs';

const START_TIME = Date.now();

function maskPassword(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

async function checkInfrastructureDatabase(dbCheck: HealthCheckResult): Promise<InfrastructureService> {
  const databaseUrl = process.env.DATABASE_URL || '';
  const dbName = parseDatabaseName(databaseUrl);
  let host = 'unknown';
  let port = 'unknown';
  try {
    const parsed = new URL(databaseUrl);
    host = parsed.hostname;
    port = parsed.port;
  } catch {}

  return {
    name: 'PostgreSQL',
    type: 'database',
    host,
    port,
    database: dbName,
    configured: !!databaseUrl,
    status: dbCheck.status === 'healthy' ? 'connected' : dbCheck.status === 'degraded' ? 'connected' : 'unreachable',
    message: dbCheck.message,
    responseTime: dbCheck.responseTime,
  };
}

async function checkRedis(): Promise<InfrastructureService> {
  const redisUrl = process.env.REDIS_URL || '';
  if (!redisUrl) {
    return { name: 'Redis', type: 'cache-queue', host: '', configured: false, status: 'not_configured' };
  }
  let host = 'unknown';
  let port = 'unknown';
  try {
    const parsed = new URL(redisUrl);
    host = parsed.hostname;
    port = parsed.port;
  } catch {}

  const startTime = Date.now();
  try {
    const net = await import('net');
    const socket = new net.Socket();
    socket.setTimeout(3000);
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => { socket.destroy(); resolve(); });
      socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
      socket.on('error', reject);
      socket.connect(parseInt(port), host);
    });
    return { name: 'Redis', type: 'cache-queue', host, port, configured: true, status: 'connected', responseTime: Date.now() - startTime };
  } catch {
    return { name: 'Redis', type: 'cache-queue', host, port, configured: true, status: 'unreachable', message: '无法连接到 Redis 服务' };
  }
}

async function checkGitea(): Promise<InfrastructureService> {
  const giteaUrl = process.env.GITEA_URL || '';
  if (!giteaUrl) {
    return { name: 'Gitea', type: 'git-storage', host: '', configured: false, status: 'not_configured' };
  }
  let host = 'unknown';
  let port = 'unknown';
  try {
    const parsed = new URL(giteaUrl);
    host = parsed.hostname;
    port = parsed.port;
  } catch {}

  const startTime = Date.now();
  try {
    const res = await fetch(giteaUrl, { signal: AbortSignal.timeout(5000) });
    return { name: 'Gitea', type: 'git-storage', host, port, configured: true, status: res.ok ? 'connected' : 'unreachable', responseTime: Date.now() - startTime, message: res.ok ? 'Gitea 服务正常' : `HTTP ${res.status}` };
  } catch {
    return { name: 'Gitea', type: 'git-storage', host, port, configured: true, status: 'unreachable', message: '无法连接到 Gitea 服务' };
  }
}

async function checkMinIO(): Promise<InfrastructureService> {
  const endpoint = process.env.MINIO_ENDPOINT || '';
  const port = process.env.MINIO_PORT || '9000';
  if (!endpoint) {
    return { name: 'MinIO', type: 'object-storage', host: '', configured: false, status: 'not_configured' };
  }

  const startTime = Date.now();
  try {
    const mc = new (await import('minio')).Client({
      endPoint: endpoint,
      port: parseInt(port),
      accessKey: process.env.MINIO_ACCESS_KEY || '',
      secretKey: process.env.MINIO_SECRET_KEY || '',
      useSSL: process.env.MINIO_USE_SSL === 'true',
    });
    const bucket = process.env.MINIO_BUCKET || 'codedmap-dbs';
    await mc.bucketExists(bucket);
    return {
      name: 'MinIO', type: 'object-storage', host: endpoint, port,
      configured: true, status: 'connected', responseTime: Date.now() - startTime,
      message: `桶 "${bucket}" 可访问`,
    };
  } catch (err) {
    return { name: 'MinIO', type: 'object-storage', host: endpoint, port, configured: true, status: 'unreachable', message: `无法连接: ${err instanceof Error ? err.message : 'unknown'}` };
  }
}

async function checkNFS(): Promise<InfrastructureService> {
  const mountPath = process.env.NFS_MOUNT_PATH || '';
  if (!mountPath) {
    return { name: 'NFS', type: 'file-storage', host: '', configured: false, status: 'not_configured' };
  }
  try {
    fs.accessSync(mountPath, fs.constants.R_OK);
    return { name: 'NFS', type: 'file-storage', host: mountPath, configured: true, status: 'connected', message: `路径 "${mountPath}" 可访问` };
  } catch {
    return { name: 'NFS', type: 'file-storage', host: mountPath, configured: true, status: 'unreachable', message: `路径 "${mountPath}" 不可访问` };
  }
}

/**
 * 执行所有健康检查
 */
export async function runHealthChecks(): Promise<SystemHealthReport> {
  const checks = await Promise.all([
    checkDatabase(),
    checkMemory(),
    checkCache(),
  ]);

  const status = calculateOverallStatus(checks);
  const memoryUsage = process.memoryUsage();
  const cacheStats = getAllCacheStats();

  const dbCheck = checks.find(c => c.name === 'database')!;
  const infrastructure: InfrastructureInfo = {
    database: await checkInfrastructureDatabase(dbCheck),
    redis: await checkRedis(),
    gitea: await checkGitea(),
    minio: await checkMinIO(),
    nfs: await checkNFS(),
  };

  return {
    status,
    version: process.env.npm_package_version || '1.0.0',
    uptime: Date.now() - START_TIME,
    timestamp: new Date(),
    checks,
    metrics: {
      cpu: 0,
      memory: memoryUsage.heapUsed / memoryUsage.heapTotal,
      dbConnections: 0,
      cacheHitRate: Object.values(cacheStats).reduce(
        (sum, s) => sum + s.hitRate,
        0
      ) / Object.keys(cacheStats).length,
    },
    infrastructure,
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
    logger.error(LOG_MODULES.MONITOR, '数据库健康检查失败', { details: { error: error instanceof Error ? error.message : String(error) } });
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
