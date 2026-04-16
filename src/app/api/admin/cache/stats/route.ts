// src/app/api/admin/cache/stats/route.ts

import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { getAllCacheStats } from '@/lib/cache';

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

    const stats = getAllCacheStats();

    logger.access(LOG_MODULES.CONFIG, payload, 'cache_stats', {});
    return NextResponse.json({
      caches: stats,
      summary: {
        totalKeys: Object.values(stats).reduce((sum, s) => sum + s.keys, 0),
        totalHits: Object.values(stats).reduce((sum, s) => sum + s.hits, 0),
        totalMisses: Object.values(stats).reduce((sum, s) => sum + s.misses, 0),
        averageHitRate: Object.values(stats).reduce((sum, s) => sum + s.hitRate, 0) / Object.keys(stats).length,
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '获取缓存统计失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
