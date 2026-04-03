// src/app/api/executions/[id]/progress/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { getExecutionProgress } from '@/lib/workflow-execution-service';

// GET /api/executions/:id/progress - SSE 进度流
export async function GET(
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

    const { id: executionId } = await params;

    // 验证执行记录
    const execution = await prisma.workflowExecution.findUnique({
      where: { id: executionId },
    });

    if (!execution) {
      return NextResponse.json({ error: '执行记录不存在' }, { status: 404 });
    }

    if (execution.userId !== payload.userId) {
      return NextResponse.json({ error: '无权访问此执行' }, { status: 403 });
    }

    // 创建 SSE 流
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let lastStatus = '';
        let lastCompletedNodes = -1;

        const sendProgress = async () => {
          try {
            const progress = await getExecutionProgress(executionId);
            if (!progress) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '执行不存在' })}\n\n`));
              controller.close();
              return;
            }

            // 只在状态或进度变化时发送
            if (progress.status !== lastStatus || progress.completedNodes !== lastCompletedNodes) {
              lastStatus = progress.status;
              lastCompletedNodes = progress.completedNodes;

              controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
            }

            // 检查是否已完成
            if (progress.status === 'completed' || progress.status === 'failed' || progress.status === 'cancelled') {
              controller.close();
              return;
            }
          } catch (error) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '获取进度失败' })}\n\n`));
            controller.close();
          }
        };

        // 初始发送
        await sendProgress();

        // 定期轮询
        const interval = setInterval(async () => {
          await sendProgress();
        }, 500);

        // 清理
        const cleanup = () => {
          clearInterval(interval);
        };

        // 设置超时（5分钟）
        setTimeout(() => {
          cleanup();
          controller.close();
        }, 5 * 60 * 1000);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Get execution progress error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
