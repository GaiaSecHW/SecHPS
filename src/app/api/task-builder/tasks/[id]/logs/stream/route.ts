import { NextRequest } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma } from '@/lib/prisma';
import eventBus from '@/lib/event-bus';
import { logger, LOG_MODULES } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
  if (!auth.success) return authErrorResponse(auth);

  const { payload, tenant } = auth as AuthSuccessResult;
  const { id } = await params;

  const encoder = new TextEncoder();
  let isClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: object) => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* stream already closed */ }
      };

      try {
        const task = await prisma.taskInstance.findUnique({
          where: { id },
          select: {
            id: true,
            name: true,
            status: true,
            startedAt: true,
            completedAt: true,
            errorMessage: true,
            createdAt: true,
            userId: true,
          },
        });

        if (!task) {
          sendEvent({ type: 'error', message: '任务不存在', timestamp: Date.now() });
          isClosed = true;
          controller.close();
          return;
        }

        // 权限校验
        if (!tenant.isPlatformAdmin && !tenant.isIcsTenant && !payload.roles?.includes('admin') && task.userId !== payload.userId) {
          sendEvent({ type: 'error', message: '无权访问此任务', timestamp: Date.now() });
          isClosed = true;
          controller.close();
          return;
        }

        const existingLogs = await prisma.taskExecutionLog.findMany({
          where: { taskId: id },
          orderBy: { timestamp: 'asc' },
        });

        sendEvent({
          type: 'initial',
          task: {
            id: task.id,
            name: task.name,
            status: task.status,
            startedAt: task.startedAt?.toISOString(),
            completedAt: task.completedAt?.toISOString(),
            errorMessage: task.errorMessage,
            createdAt: task.createdAt.toISOString(),
          },
          logs: existingLogs.map(log => ({
            id: log.id,
            taskId: log.taskId,
            timestamp: log.timestamp.toISOString(),
            level: log.level,
            message: log.message,
            details: log.details,
          })),
          timestamp: Date.now(),
        });

        if (task.status === 'completed' || task.status === 'failed' || task.status === 'error') {
          sendEvent({ type: 'completed', status: task.status, timestamp: Date.now() });
          isClosed = true;
          controller.close();
          return;
        }
      } catch (err) {
        logger.error(LOG_MODULES.WORKFLOW, 'SSE initial state fetch error', {
          details: { error: err instanceof Error ? err.message : String(err) },
        });
        sendEvent({ type: 'error', message: '获取任务状态失败', timestamp: Date.now() });
        isClosed = true;
        controller.close();
        return;
      }

      const handler = (event: any) => {
        if (isClosed) return;
        sendEvent({
          ...event,
          timestamp: event.timestamp || Date.now(),
        });
      };
      eventBus.on(`task:${id}`, handler);

      const heartbeat = setInterval(() => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch { /* stream already closed */ }
      }, 15000);

      request.signal.addEventListener('abort', () => {
        isClosed = true;
        eventBus.off(`task:${id}`, handler);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch { /* already closed */ }
        logger.info(LOG_MODULES.WORKFLOW, `SSE client disconnected from task ${id}`);
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}