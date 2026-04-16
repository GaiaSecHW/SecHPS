// src/app/api/admin/cache/clear/route.ts

import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { clearAllCaches, invalidateUserCaches, invalidateWorkflowCaches } from '@/lib/cache';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
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

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ details: { error: '禁止访问' } }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { cacheType, userId, workflowId } = body;

    if (cacheType === 'user' && userId) {
      invalidateUserCaches(userId);
      return NextResponse.json({ message: '用户缓存已清除', cacheType: 'user', userId });
    }

    if (cacheType === 'workflow' && workflowId) {
      invalidateWorkflowCaches(workflowId, userId);
      return NextResponse.json({ message: '工作流缓存已清除', cacheType: 'workflow', workflowId });
    }

    // Clear all caches
    clearAllCaches();

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'cache_clear',
        details: JSON.stringify({ cacheType: cacheType || 'all' }),
      },
    });

    logger.create(LOG_MODULES.CONFIG, payload, 'cache', { cacheType: cacheType || 'all' });
    return NextResponse.json({ message: '所有缓存已清除' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '清除缓存失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
