/**
 * SSE 事件流路由
 * GET /api/task/:taskId/stream
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../prisma.js';

export function registerStreamRoutes(server: FastifyInstance): void {

  server.get<{ Params: { taskId: string } }>('/api/task/:taskId/stream', async (request, reply) => {
    const { taskId } = request.params;

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Send initial connected event
    reply.raw.write(`data: ${JSON.stringify({ type: 'connected', taskId })}\n\n`);

    let lastEventId = '';
    let closed = false;

    // Poll for new events
    const interval = setInterval(async () => {
      if (closed) return;

      try {
        const where: any = { taskId };
        if (lastEventId) {
          const lastEvent = await prisma.codeswarmEvent.findUnique({ where: { id: lastEventId } });
          if (lastEvent) {
            where.createdAt = { gt: lastEvent.createdAt };
          }
        }

        const events = await prisma.codeswarmEvent.findMany({
          where,
          orderBy: { createdAt: 'asc' },
          take: 50,
        });

        for (const event of events) {
          reply.raw.write(`data: ${JSON.stringify({
            type: event.type,
            data: event.data ? JSON.parse(event.data) : null,
            level: event.level,
            stream: event.stream,
            timestamp: event.createdAt,
          })}\n\n`);
          lastEventId = event.id;
        }

        // Check if task is in terminal state
        const task = await prisma.codeswarmTask.findUnique({
          where: { taskId },
          select: { state: true },
        });

        if (task && ['completed', 'failed', 'cancelled'].includes(task.state)) {
          reply.raw.write(`data: ${JSON.stringify({ type: 'task_complete', state: task.state })}\n\n`);
          closed = true;
          clearInterval(interval);
          reply.raw.end();
        }
      } catch (err) {
        // Non-fatal — keep polling
      }
    }, 500);

    // Clean up on client disconnect
    request.raw.on('close', () => {
      closed = true;
      clearInterval(interval);
    });

    // Keep the reply open (don't call reply.send())
    await new Promise(() => {});
  });
}
