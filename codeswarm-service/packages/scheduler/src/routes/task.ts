/**
 * 任务管理路由
 * POST   /api/task/submit       — 提交任务（核心入口）
 * GET    /api/task/list          — 任务列表
 * GET    /api/task/:taskId       — 任务详情
 * DELETE /api/task/:taskId       — 删除任务
 * POST   /api/task/:taskId/dispatch — 手动重新分发
 * POST   /api/task/:taskId/cancel   — 取消任务
 * DELETE /api/task/batch         — 批量删除
 */
import type { FastifyInstance } from 'fastify';
import { prisma, withDeadlockRetry } from '../prisma.js';
import { allocateWorkspacePath, ensureWorkspaceDir } from '../services/workspace.js';
import { metrics } from '../services/metrics.js';
import { logger } from '../logger.js';

export function registerTaskRoutes(server: FastifyInstance, dispatcher: any): void {

  // POST /api/task/submit
  server.post('/api/task/submit', async (request, reply) => {
    const body = request.body as {
      instruction: string;
      platformTaskId?: string;
      callbackUrl?: string;
      workspacePath?: string;
      projectPath?: string;
      engine?: string;
      agent?: string;
      model?: string;
      apiKey?: string;
      apiBaseUrl?: string;
      timeoutSec?: number;
      skills?: string[];
      mcps?: any[];
      env?: Record<string, string>;
      preferredWorkerNodeId?: string;
      targetProduct?: string;
      maxTokens?: number;
      contextWindow?: number;
    };

    if (!body.instruction) {
      return reply.status(400).send({ error: 'Missing instruction' });
    }

    // Generate taskId
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Allocate workspace path
    const workspacePath = allocateWorkspacePath(taskId, body.workspacePath);
    if (!body.workspacePath) {
      ensureWorkspaceDir(workspacePath);
    }

    try {
      const task = await withDeadlockRetry(() =>
        prisma.codeswarmTask.create({
          data: {
            taskId,
            state: 'queued',
            instruction: body.instruction,
            workspacePath,
            projectPath: body.projectPath || null,
            engine: body.engine || null,
            agent: body.agent || null,
            model: body.model || null,
            apiKey: body.apiKey || null,
            apiBaseUrl: body.apiBaseUrl || null,
            timeoutSec: body.timeoutSec || null,
            skills: body.skills ? JSON.stringify(body.skills) : null,
            mcps: body.mcps ? JSON.stringify(body.mcps) : null,
            env: body.env ? JSON.stringify(body.env) : null,
            preferredWorkerNodeId: body.preferredWorkerNodeId || null,
            targetProduct: body.targetProduct || null,
            maxTokens: body.maxTokens || null,
            contextWindow: body.contextWindow || null,
            platformTaskId: body.platformTaskId || null,
            platformCallbackUrl: body.callbackUrl || null,
          },
        })
      );

      // Submit to dispatcher (Redis Stream or DB queue)
      if (dispatcher?.submitTask) {
        await dispatcher.submitTask(task);
      }

      logger.info(`[Task] Submitted: ${taskId} (workspace: ${workspacePath})`);
      return reply.status(201).send({
        taskId: task.taskId,
        dbTaskId: task.id,
        workspacePath,
        queued: true,
      });
    } catch (error: any) {
      logger.error(`[Task] Submit error: ${error.message}`);
      return reply.status(500).send({ error: 'Task submission failed' });
    }
  });

  // GET /api/task/list
  server.get('/api/task/list', async (request) => {
    const query = request.query as { state?: string; limit?: string; offset?: string };
    const where = query.state ? { state: query.state } : {};
    const limit = Math.min(parseInt(query.limit || '50'), 200);
    const offset = parseInt(query.offset || '0');

    const [tasks, total] = await Promise.all([
      prisma.codeswarmTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true, taskId: true, state: true, instruction: true,
          engine: true, agent: true, model: true,
          platformTaskId: true, workspacePath: true,
          startedAt: true, completedAt: true, createdAt: true,
        },
      }),
      prisma.codeswarmTask.count({ where }),
    ]);

    return { tasks, total, limit, offset };
  });

  // GET /api/task/:taskId
  server.get<{ Params: { taskId: string } }>('/api/task/:taskId', async (request, reply) => {
    const task = await prisma.codeswarmTask.findUnique({
      where: { taskId: request.params.taskId },
    });
    if (!task) return reply.status(404).send({ error: 'Task not found' });

    // Fetch events separately (no Prisma relation — taskId is a soft link)
    const events = await prisma.codeswarmEvent.findMany({
      where: { taskId: request.params.taskId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return { ...task, events };
  });

  // DELETE /api/task/:taskId
  server.delete<{ Params: { taskId: string } }>('/api/task/:taskId', async (request, reply) => {
    const { taskId } = request.params;
    try {
      const task = await prisma.codeswarmTask.findUnique({ where: { taskId } });
      if (!task) return reply.status(404).send({ error: 'Task not found' });

      // Cancel on worker if running
      if (task.workerId && ['dispatched', 'running'].includes(task.state)) {
        const worker = await prisma.codeswarmWorker.findUnique({ where: { id: task.workerId } });
        if (worker) {
          try {
            await fetch(`http://${worker.address.split(',')[0]}/task/cancel`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId }),
              signal: AbortSignal.timeout(5000),
            });
          } catch {}
        }
      }

      // Delete task + events
      await prisma.codeswarmEvent.deleteMany({ where: { taskId } });
      await prisma.codeswarmTask.delete({ where: { taskId } });

      return { success: true };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // POST /api/task/:taskId/dispatch — manual re-dispatch
  server.post<{ Params: { taskId: string } }>('/api/task/:taskId/dispatch', async (request, reply) => {
    const { taskId } = request.params;
    try {
      const task = await prisma.codeswarmTask.findUnique({ where: { taskId } });
      if (!task) return reply.status(404).send({ error: 'Task not found' });

      if (dispatcher?.triggerDispatch) {
        dispatcher.triggerDispatch();
      }

      return { success: true, taskId, state: task.state };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // POST /api/task/:taskId/cancel
  server.post<{ Params: { taskId: string } }>('/api/task/:taskId/cancel', async (request, reply) => {
    const { taskId } = request.params;
    try {
      await prisma.codeswarmTask.update({
        where: { taskId },
        data: { state: 'cancelled', completedAt: new Date() },
      });
      return { success: true, taskId };
    } catch {
      return reply.status(404).send({ error: 'Task not found' });
    }
  });

  // DELETE /api/task/batch
  server.delete('/api/task/batch', async (request, reply) => {
    const body = request.body as { taskIds?: string[] };
    if (!body.taskIds?.length) {
      return reply.status(400).send({ error: 'Missing taskIds' });
    }
    const result = await prisma.codeswarmTask.deleteMany({
      where: { taskId: { in: body.taskIds } },
    });
    return { deleted: result.count };
  });
}
