import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { codeswarmDispatcher } from '@/services/codeswarm-dispatcher';
import { verifyWorkerToken, extractBearerToken } from '@/lib/codeswarm-worker-auth';

export async function POST(request: Request) {
  try {
    // 验证 Worker Token
    const bearerToken = extractBearerToken(request);
    if (!bearerToken) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }
    const payload = verifyWorkerToken(bearerToken);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const body = await request.json();
    const { taskId, nodeId, status, result, error, reportContent } = body;

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    const finalState = status === 'completed' ? 'completed' : 'failed';

    await prisma.codeswarmTask.update({
      where: { taskId },
      data: {
        state: finalState,
        result: result || null,
        error: error || null,
        reportContent: reportContent || null,
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    if (nodeId) {
      await prisma.codeswarmWorker.updateMany({
        where: { nodeId },
        data: {
          currentTasks: { decrement: 1 },
          status: 'online',
        },
      });
    }

    // 通知 dispatcher 释放 Worker 槽位
    if (nodeId) {
      codeswarmDispatcher.onTaskCompleted(nodeId);
    }

    // 发布任务完成事件（供 Task Builder 等订阅者接收）
    await codeswarmDispatcher.publishTaskEvent(taskId, {
      type: 'task_completed',
      status: finalState,
    });

    return NextResponse.json({ success: true, taskId, status: finalState });
  } catch (error) {
    console.error('[CodeSwarm] Result callback error:', error);
    return NextResponse.json(
      { error: 'Failed to record result' },
      { status: 500 }
    );
  }
}
