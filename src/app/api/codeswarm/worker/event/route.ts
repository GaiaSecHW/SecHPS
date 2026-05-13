import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { codeswarmDispatcher } from '@/services/codeswarm-dispatcher';
import eventBus from '@/lib/event-bus';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { taskId, nodeId, events } = body;

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    const taskInstance = await prisma.taskInstance.findFirst({
      where: { codeswarmTaskId: taskId },
      select: { id: true },
    });

    if (events?.length) {
      const eventRows = events.map((event: { type: string; data?: any; content?: string; message?: string; timestamp?: string }) => ({
        taskId,
        type: event.type || 'unknown',
        data: JSON.stringify(event),
      }));

      await prisma.codeswarmEvent.createMany({ data: eventRows });

      for (const event of events) {
        codeswarmDispatcher.publishTaskEvent(taskId, {
          type: 'task_event',
          data: event,
        }).catch(() => {});
      }

      if (taskInstance) {
        for (const event of events) {
          let level = 'info';
          let message = '';
          let details = '';

          if (event.type === 'agent_message_chunk') {
            level = 'info';
            message = 'Agent 输出';
            details = event.content || '';
          } else if (event.type === 'tool_call') {
            level = 'info';
            message = '工具调用';
            details = event.tool || JSON.stringify(event.input) || '';
          } else if (event.type === 'tool_call_update') {
            level = 'info';
            message = '工具结果';
            details = event.output || '';
          } else if (event.type === 'error') {
            level = 'error';
            message = '执行错误';
            details = event.message || JSON.stringify(event);
          }

          if (message) {
            const logEntry = await prisma.taskExecutionLog.create({
              data: {
                id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                taskId: taskInstance.id,
                level,
                message,
                details,
                timestamp: new Date(),
              },
            });

            eventBus.emit(`task:${taskInstance.id}`, {
              id: logEntry.id,
              level: logEntry.level,
              message: logEntry.message,
              details: logEntry.details,
              timestamp: logEntry.timestamp.toISOString(),
            });
          }
        }
      }

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