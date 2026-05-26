import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  const encoder = new TextEncoder();
  let isClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      let lastEventDbId: string | null = null;

      const sendEvent = (data: object) => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* ignore */ }
      };

      // Send initial connection event
      sendEvent({ type: 'connected', taskId });

      const interval = setInterval(async () => {
        try {
          // Fetch new events since last check (using DB id as cursor)
          const where: any = { taskId };
          if (lastEventDbId !== null) {
            where.id = { gt: lastEventDbId };
          }
          
          const events = await prisma.codeswarmEvent.findMany({
            where,
            orderBy: { createdAt: 'asc' },
          });

          for (const event of events) {
            const eventData = JSON.parse(event.data);
            sendEvent({
              type: event.type,
              data: eventData,
              timestamp: event.createdAt.toISOString(),
            });
            lastEventDbId = event.id;
          }

          // Check if task is completed
          const task = await prisma.codeswarmTask.findUnique({
            where: { taskId },
            select: { state: true, result: true, error: true },
          });

          if (task && (task.state === 'completed' || task.state === 'failed')) {
            sendEvent({ type: 'task_complete', state: task.state, result: task.result, error: task.error });
            isClosed = true;
            controller.close();
            clearInterval(interval);
          }
        } catch (err) {
          logger.error(LOG_MODULES.CODESWARM, 'SSE Error', { details: { error: err instanceof Error ? err.message : String(err) } });
        }
      }, 500);

      request.signal.addEventListener('abort', () => {
        isClosed = true;
        clearInterval(interval);
        controller.close();
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