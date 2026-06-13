/**
 * Worker 节点管理路由
 * GET    /api/codeswarm/node/list
 * GET    /api/codeswarm/node/:nodeId
 * PATCH  /api/codeswarm/node/:nodeId
 * DELETE /api/codeswarm/node/:nodeId
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../prisma.js';
import { logger } from '../logger.js';

export function registerNodeRoutes(server: FastifyInstance): void {

  // GET /api/codeswarm/node/list
  server.get('/api/codeswarm/node/list', async () => {
    const workers = await prisma.codeswarmWorker.findMany({
      orderBy: { lastHeartbeat: 'desc' },
    });
    return { workers };
  });

  // GET /api/codeswarm/node/:nodeId
  server.get<{ Params: { nodeId: string } }>('/api/codeswarm/node/:nodeId', async (request, reply) => {
    const { nodeId } = request.params;
    const worker = await prisma.codeswarmWorker.findUnique({
      where: { nodeId },
      include: {
        CodeswarmTasks: {
          where: { state: { in: ['queued', 'dispatched', 'running'] } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!worker) {
      return reply.status(404).send({ error: 'Worker not found' });
    }
    return worker;
  });

  // PATCH /api/codeswarm/node/:nodeId — update maxConcurrent
  server.patch<{ Params: { nodeId: string } }>('/api/codeswarm/node/:nodeId', async (request, reply) => {
    const { nodeId } = request.params;
    const body = request.body as { maxConcurrent?: number };

    if (typeof body.maxConcurrent !== 'number' || !Number.isFinite(body.maxConcurrent)) {
      return reply.status(400).send({ error: 'Invalid maxConcurrent' });
    }

    const maxConcurrent = Math.max(1, Math.min(50, Math.floor(body.maxConcurrent)));

    try {
      const worker = await prisma.codeswarmWorker.update({
        where: { nodeId },
        data: { maxConcurrent },
      });

      // Push config to worker
      try {
        await fetch(`http://${worker.address.split(',')[0]}/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maxConcurrentOverride: maxConcurrent }),
          signal: AbortSignal.timeout(5000),
        });
      } catch (err) {
        logger.warn(`[Node] Failed to push config to ${nodeId}: ${err}`);
      }

      return { success: true, maxConcurrent };
    } catch {
      return reply.status(404).send({ error: 'Worker not found' });
    }
  });

  // DELETE /api/codeswarm/node/:nodeId
  server.delete<{ Params: { nodeId: string } }>('/api/codeswarm/node/:nodeId', async (request, reply) => {
    const { nodeId } = request.params;
    try {
      await prisma.codeswarmWorker.delete({ where: { nodeId } });
      return { success: true };
    } catch {
      return reply.status(404).send({ error: 'Worker not found' });
    }
  });
}
