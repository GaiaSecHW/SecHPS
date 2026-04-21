// src/app/api/agent/executions/[id]/cancel/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// POST /api/agent/executions/:id/cancel - 取消执行
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id } = await params;

    const execution = await prisma.skillExecution.findUnique({ where: { id } });

    if (!execution) {
      return NextResponse.json({ error: '执行记录不存在' }, { status: 404 });
    }

    if (execution.status !== 'running' && execution.status !== 'pending') {
      return NextResponse.json({ error: '只能取消运行中或待执行的记录' }, { status: 400 });
    }

    const updated = await prisma.skillExecution.update({
      where: { id },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
      },
    });

    return NextResponse.json({
      execution: {
        ...updated,
        input: JSON.parse(updated.input),
        output: updated.output ? JSON.parse(updated.output) : null,
      },
      message: '执行已取消',
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AGENT, '取消执行错误:', { details: error });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
