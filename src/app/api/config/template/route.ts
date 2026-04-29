// src/app/api/config/template/route.ts
// 获取 skillOutputTemplate（全局共享，所有登录用户可访问）

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function GET(request: Request) {
  // 使用统一认证中间件（无权限要求，只需登录）
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }

  try {
    // OpencodeConfig 是全局配置（不再绑定用户）
    // 查找激活的配置中的 skillOutputTemplate
    const config = await prisma.opencodeConfig.findFirst({
      where: { 
        isActive: true,
        skillOutputTemplate: { not: null },
      },
      select: {
        skillOutputTemplate: true,
      },
    });

    return NextResponse.json({ 
      skillOutputTemplate: config?.skillOutputTemplate || null 
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '获取模板失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}