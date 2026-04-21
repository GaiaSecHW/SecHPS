// src/app/api/admin/metrics/route.ts

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { metricsCollector } from '@/lib/metrics/collector';
import { getAllCacheStats } from '@/lib/cache';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_READ });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
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
      vulnerabilityCount,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.vulnerability.count({ where: { status: 'new' } }),
    ]);

    logger.access(LOG_MODULES.CONFIG, payload, 'metrics', { type, since });
    return NextResponse.json({
      metrics: metrics.slice(0, 100), // 限制返回数量
      stats,
      cache: cacheStats,
      database: {
        users: userCount,
        newVulnerabilities: vulnerabilityCount,
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '获取指标数据失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
