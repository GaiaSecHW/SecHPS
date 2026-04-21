// src/app/api/projects/sdk/current/route.ts

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * GET /api/projects/sdk/current
 * 获取当前 SDK 项目（当前未使用，返回 null）
 */
export async function GET(request: Request) {
  try {
    // 使用统一认证中间件
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponseNested(auth);
    }
    const payload = auth.payload;

    // SDK 当前项目功能暂未实现
    // 返回 null
    return NextResponse.json({ project: null });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PROJECT, 'SDK Current Error', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
