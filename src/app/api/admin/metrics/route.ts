// src/app/api/admin/metrics/route.ts

import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { metricsCollector } from '@/lib/metrics/collector';
import { getAllCacheStats } from '@/lib/cache';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的令牌' } }, { status: 401 });
    }

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
      return NextResponse.json({ details: { error: '禁止访问' } }, { status: 403 });
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
