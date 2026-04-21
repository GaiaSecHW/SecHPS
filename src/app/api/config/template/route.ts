// src/app/api/config/template/route.ts
// 获取 skillOutputTemplate（全局共享，所有登录用户可访问）

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// 全局配置的特殊 userId（用于存储系统级配置）
const SYSTEM_USER_ID = 'system';

export async function GET(request: Request) {
  // 使用统一认证中间件（无权限要求，只需登录）
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const { payload } = auth;

  try {

    // skillOutputTemplate 是全局共享的模板，所有登录用户都可以获取
    // 查询策略：优先用户配置 -> 全局系统配置 -> 任何一个有模板的配置
    
    // 1. 获取用户自己的激活配置
    const userConfig = await prisma.opencodeConfig.findFirst({
      where: { 
        userId: payload.userId,
        isActive: true,
      },
      select: {
        skillOutputTemplate: true,
      },
    });

    // 2. 如果用户有配置且有 skillOutputTemplate，直接返回
    if (userConfig?.skillOutputTemplate) {
      return NextResponse.json({ 
        skillOutputTemplate: userConfig.skillOutputTemplate 
      });
    }

    // 3. 回退到全局系统配置（userId: 'system')
    const systemConfig = await prisma.opencodeConfig.findFirst({
      where: { 
        userId: SYSTEM_USER_ID,
        isActive: true,
      },
      select: {
        skillOutputTemplate: true,
      },
    });

    if (systemConfig?.skillOutputTemplate) {
      return NextResponse.json({ 
        skillOutputTemplate: systemConfig.skillOutputTemplate 
      });
    }

    // 4. 最后回退：查找任何一个有 skillOutputTemplate 的激活配置（共享模板）
    const anyConfig = await prisma.opencodeConfig.findFirst({
      where: { 
        isActive: true,
        skillOutputTemplate: { not: null },
      },
      select: {
        skillOutputTemplate: true,
      },
    });

    return NextResponse.json({ 
      skillOutputTemplate: anyConfig?.skillOutputTemplate || null 
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '获取模板失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}