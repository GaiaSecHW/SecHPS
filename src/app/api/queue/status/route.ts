// src/app/api/queue/status/route.ts
// 获取队列状态 API

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getQueueStatus } from '@/services/evaluation-queue';
import { logger } from '@/lib/logger';

/**
 * GET /api/queue/status
 * 获取当前队列状态（运行数量、排队数量、最大并发）
 */
export async function GET(request: Request) {
  try {
    // 验证登录状态
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的令牌' } }, { status: 401 });
    }

    const queueStatus = await getQueueStatus();
    
    return NextResponse.json(queueStatus);
  } catch (error) {
    logger.errorNoUser('QUEUE', '获取队列状态失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}