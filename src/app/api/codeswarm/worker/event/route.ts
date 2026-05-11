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
    const { taskId, nodeId, events } = body;

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    if (events?.length) {
      // 批量插入到 CodeswarmEvent 表
      const eventRows = events.map((event: { type: string; data?: any }) => ({
        taskId,
        type: event.type || 'unknown',
        data: JSON.stringify(event),
      }));

      await prisma.codeswarmEvent.createMany({ data: eventRows });

      // 通过 Redis Pub/Sub 实时推送事件
      for (const event of events) {
        codeswarmDispatcher.publishTaskEvent(taskId, {
          type: 'task_event',
          data: event,
        }).catch(() => {});
      }

      // 如果有错误事件，更新任务状态
      if (events.some((e: { type: string }) => e.type === 'error')) {
        await prisma.codeswarmTask.update({
          where: { taskId },
          data: { state: 'running', updatedAt: new Date() },
        });
      }
    }

    return NextResponse.json({ success: true, eventCount: events?.length || 0 });
  } catch (error) {
    console.error('[CodeSwarm] Event callback error:', error);
    return NextResponse.json(
      { error: 'Failed to record events' },
      { status: 500 }
    );
  }
}
