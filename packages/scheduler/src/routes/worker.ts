/**
 * Worker → Scheduler 路由
 * POST /api/worker/heartbeat — 心跳注册
 * POST /api/worker/event — 事件上报
 * POST /api/worker/result — 任务结果回调
 */
import type { FastifyInstance } from 'fastify';
import { prisma, withDeadlockRetry } from '../prisma.js';
import { verifyWorkerToken, generateWorkerToken, extractBearerToken } from '../auth.js';
import { logger } from '../logger.js';

export function registerWorkerRoutes(server: FastifyInstance, dispatcher: any): void {

  // POST /api/worker/heartbeat
  server.post('/api/worker/heartbeat', async (request, reply) => {
    const body = request.body as {
      nodeId: string;
      maxConcurrent: number;
      currentTasks: number;
      address: string;
      systemType?: string;
      arch?: string;
      status?: string; // online | draining
    };

    if (!body.nodeId) {
      return reply.status(400).send({ error: 'Missing nodeId' });
    }

    try {
      const token = extractBearerToken(request.headers.authorization as string);
      const existingWorker = token ? verifyWorkerToken(token) : null;

      // Upsert worker
      const worker = await withDeadlockRetry(() =>
        prisma.codeswarmWorker.upsert({
          where: { nodeId: body.nodeId },
          create: {
            nodeId: body.nodeId,
            address: body.address || '',
            systemType: body.systemType || null,
            arch: body.arch || null,
            status: body.status === 'draining' ? 'draining' : 'online',
            maxConcurrent: body.maxConcurrent || 5,
            currentTasks: body.currentTasks || 0,
            lastHeartbeat: new Date(),
          },
          update: {
            address: body.address || '',
            systemType: body.systemType || null,
            arch: body.arch || null,
            status: body.status === 'draining' ? 'draining' : 'online',
            maxConcurrent: body.maxConcurrent || 5,
            currentTasks: Math.max(body.currentTasks || 0, 0), // GREATEST protection
            lastHeartbeat: new Date(),
          },
        })
      );

      // Generate token for new workers
      const newToken = !existingWorker
        ? generateWorkerToken(worker.id, worker.nodeId)
        : undefined;

      // Sync in-memory topology (dispatcher.selectWorker depends on this)
      dispatcher?.onHeartbeat?.({
        nodeId: worker.nodeId,
        id: worker.id,
        address: worker.address,
        maxConcurrent: worker.maxConcurrent,
        currentTasks: worker.currentTasks,
        status: worker.status,
      });

      // Trigger dispatch check on capacity change
      dispatcher?.triggerDispatch?.().catch((err: unknown) =>
        logger.warn(`[Heartbeat] Trigger dispatch failed: ${err instanceof Error ? err.message : String(err)}`)
      );

      return reply.send({
        workerId: worker.id,
        token: newToken,
        maxConcurrentOverride: worker.maxConcurrent,
      });
    } catch (error: any) {
      logger.error(`[Heartbeat] Error: ${error.message}`);
      return reply.status(500).send({ error: 'Heartbeat processing failed' });
    }
  });

  // POST /api/worker/event
  server.post('/api/worker/event', async (request, reply) => {
    const body = request.body as {
      taskId: string;
      nodeId: string;
      // 对齐 worker 端 AgentEvent（process-manager.ts）。除 type/level/stream 有独立列外，
      // 其余字段原样落入 CodeswarmEvent.data，供调试 UI 渲染完整正文。
      events: Array<{
        type: string;
        data?: any;
        timestamp: string;
        level?: string;
        stream?: string;
        content?: string;
        message?: string;
        phase?: string;
        skill?: string;
        tool?: string;
        output?: string;
        title?: string;
        input?: unknown;
        success?: boolean;
      }>;
    };

    if (!body.taskId || !body.events?.length) {
      return reply.status(400).send({ error: 'Missing taskId or events' });
    }

    try {
      // Write events to DB. Only type/level/stream have their own columns;
      // everything else (content/phase/skill/tool/output/message/timestamp/...)
      // is preserved verbatim inside the JSON `data` so the debug UI can render
      // the full payload. Previously only content/message were cherry-picked and
      // phase/skill/tool/timestamp were silently dropped — which is why the
      // execution log showed "Invalid Date" and empty detail text.
      await prisma.codeswarmEvent.createMany({
        data: body.events.map(e => {
          const { type, level, stream, ...rest } = e;
          return {
            taskId: body.taskId,
            type,
            data: JSON.stringify(rest),
            level: level || null,
            stream: stream || null,
          };
        }),
      });

      // Update task state on key events
      const stateTransitions: Record<string, string> = {
        task_started: 'running',
        task_completed: 'completed',
      };

      for (const event of body.events) {
        const newState = stateTransitions[event.type];
        if (newState) {
          await prisma.codeswarmTask.update({
            where: { taskId: body.taskId },
            data: {
              state: newState,
              ...(newState === 'running' ? { startedAt: new Date() } : {}),
              ...(newState === 'completed' ? { completedAt: new Date() } : {}),
            },
          }).catch(() => {
            // Task may not exist — non-critical
          });
        }
      }

      return reply.send({ ok: true });
    } catch (error: any) {
      logger.error(`[Event] Error: ${error.message}`);
      return reply.status(500).send({ error: 'Event processing failed' });
    }
  });

  // POST /api/worker/result
  server.post('/api/worker/result', async (request, reply) => {
    const body = request.body as {
      taskId: string;
      nodeId: string;
      status: 'completed' | 'failed';
      result?: string;
      error?: string;
      reportContent?: string;
    };

    if (!body.taskId || !body.status) {
      return reply.status(400).send({ error: 'Missing taskId or status' });
    }

    try {
      // Transactional update: task state + worker currentTasks decrement
      await withDeadlockRetry(() =>
        prisma.$transaction(async (tx) => {
          // Update task
          const task = await tx.codeswarmTask.update({
            where: { taskId: body.taskId },
            data: {
              state: body.status,
              result: body.result || null,
              error: body.error || null,
              reportContent: body.reportContent || null,
              completedAt: new Date(),
            },
          });

          // Decrement worker currentTasks
          if (task.workerId) {
            await tx.codeswarmWorker.update({
              where: { id: task.workerId },
              data: { currentTasks: { decrement: 1 } },
            });
          }

          // Notify platform via callback
          if (task.platformCallbackUrl && task.platformTaskId) {
            try {
              await fetch(task.platformCallbackUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  event: body.status === 'completed' ? 'task_completed' : 'task_failed',
                  taskId: task.taskId,
                  platformTaskId: task.platformTaskId,
                  status: body.status,
                  result: body.result,
                  error: body.error,
                  reportContent: body.reportContent,
                }),
                signal: AbortSignal.timeout(10000),
              });
            } catch (err) {
              logger.error(`[Result] Platform callback failed: ${err}`);
            }
          }

          return task;
        })
      );

      // Trigger dispatch after capacity freed
      dispatcher?.triggerDispatch?.().catch((err: unknown) =>
        logger.warn(`[Result] Trigger dispatch failed: ${err instanceof Error ? err.message : String(err)}`)
      );

      logger.info(`[Result] Task ${body.taskId} → ${body.status}`);
      return reply.send({ ok: true });
    } catch (error: any) {
      logger.error(`[Result] Error: ${error.message}`);
      return reply.status(500).send({ error: 'Result processing failed' });
    }
  });
}
