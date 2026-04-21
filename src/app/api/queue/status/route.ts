// src/app/api/queue/status/route.ts
// 获取队列状态 API

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { getQueueStatus } from '@/services/evaluation-queue';
import { logger } from '@/lib/logger';

/**
 * GET /api/queue/status
 * 获取当前队列状态（运行数量、排队数量、最大并发）
 */
export async function GET(request: Request) {
  try {
    // 验证登录状态
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponseNested(auth);
    }
    const payload = auth.payload;

    const queueStatus = await getQueueStatus();
    
    return NextResponse.json(queueStatus);
  } catch (error) {
    logger.errorNoUser('QUEUE', '获取队列状态失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}