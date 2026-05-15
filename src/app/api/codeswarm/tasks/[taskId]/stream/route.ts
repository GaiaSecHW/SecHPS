import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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
      let lastEventId = 0;

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
          // Fetch new events since last check
          const events = await prisma.codeswarmEvent.findMany({
            where: { taskId },
            orderBy: { createdAt: 'asc' },
            take: 100,
          });

          if (events.length > lastEventId) {
            const newEvents = events.slice(lastEventId);
            for (const event of newEvents) {
              const eventData = JSON.parse(event.data);
              sendEvent({
                type: event.type,
                data: eventData,
                timestamp: event.createdAt.toISOString(),
              });
            }
            lastEventId = events.length;
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
          console.error('[CodeSwarm SSE] Error:', err);
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