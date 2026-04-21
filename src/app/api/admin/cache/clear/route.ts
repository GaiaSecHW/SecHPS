// src/app/api/admin/cache/clear/route.ts

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { clearAllCaches, invalidateUserCaches } from '@/lib/cache';
import { prisma } from '@/lib/prisma';
import { generateId } from '@/lib/id-generator';

export async function POST(request: Request) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_UPDATE });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    const body = await request.json().catch(() => ({}));
    const { cacheType, userId } = body;

    if (cacheType === 'user' && userId) {
      invalidateUserCaches(userId);
      return NextResponse.json({ message: '用户缓存已清除', cacheType: 'user', userId });
    }

    // Clear all caches
    clearAllCaches();

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        id: generateId('audit'),
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
