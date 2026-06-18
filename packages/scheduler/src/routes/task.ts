/**
 * 任务管理路由
 * POST   /api/codeswarm/task/submit       — 提交任务（核心入口）
 * GET    /api/codeswarm/task/list          — 任务列表
 * GET    /api/codeswarm/task/:taskId       — 任务详情
 * DELETE /api/codeswarm/task/:taskId       — 删除任务
 * POST   /api/codeswarm/task/:taskId/dispatch — 手动重新分发
 * POST   /api/codeswarm/task/:taskId/cancel   — 取消任务
 * DELETE /api/codeswarm/task/batch         — 批量删除
 */
import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { prisma, withDeadlockRetry } from '../prisma.js';
import { allocateWorkspacePath, allocateToolWorkspacePath, ensureWorkspaceDir } from '../services/workspace.js';
import { metrics } from '../services/metrics.js';
import { logger } from '../logger.js';

type SubmitTaskEnvInput = {
  env?: Record<string, string>;
  projectPath?: string;
  toolWorkDir?: string;
  platformTaskId?: string;
};

export function normalizeSubmitTaskEnv(input: SubmitTaskEnvInput): {
  env: Record<string, string>;
  projectDir: string;
  toolWorkDir: string | undefined;
  platformTaskId: string | undefined;
} {
  const env = { ...(input.env || {}) };
  const projectDir = env.INPUT_DIR || input.projectPath || '';
  const toolWorkDir = env.TOOL_WORK_DIR || input.toolWorkDir || undefined;
  const platformTaskId = env.PLATFORM_TASK_ID || input.platformTaskId || undefined;

  if (projectDir || Object.prototype.hasOwnProperty.call(env, 'INPUT_DIR')) {
    env.INPUT_DIR = projectDir;
  }
  if (toolWorkDir) env.TOOL_WORK_DIR = toolWorkDir;
  if (platformTaskId) env.PLATFORM_TASK_ID = platformTaskId;

  return { env, projectDir, toolWorkDir, platformTaskId };
}

function normalizeWorkspacePathForCompare(value: string): string {
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  return normalized.replace(/[\/]+$/, '') || '/';
}

function isWorkspacePathUnderBase(workspacePath: string, basePath: string): boolean {
  const normalizedWorkspacePath = normalizeWorkspacePathForCompare(workspacePath);
  const normalizedBasePath = normalizeWorkspacePathForCompare(basePath);
  return normalizedWorkspacePath === normalizedBasePath || normalizedWorkspacePath.startsWith(`${normalizedBasePath}/`);
}

export function registerTaskRoutes(server: FastifyInstance, dispatcher: any): void {

  // POST /api/codeswarm/task/submit
  server.post('/api/codeswarm/task/submit', async (request, reply) => {
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
      // Script engine: argv array + working directory override
      command?: string[];
      scriptCwd?: string;
      // Tool 调度字段
      toolId?: string;
      toolTaskId?: string;
      toolPath?: string;
      toolWorkDir?: string;
    };
    const rawSubmitPayload = JSON.stringify(body ?? {});

    if (!body.instruction) {
      return reply.status(400).send({ error: 'Missing instruction' });
    }

    // Generate taskId
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const normalizedEnv = normalizeSubmitTaskEnv(body);

    // Tool 调度模式：生成 toolTaskId 并创建 tool 工作目录
    let toolTaskId: string | undefined;
    let toolWorkspacePath: string | undefined;
    let resolvedToolWorkDir: string | undefined;

    if (body.toolId) {
      const uuidPart = crypto.randomUUID().split('-')[0]; // 8 chars
      const generatedToolTaskId = `${body.toolId}-${uuidPart}-${Date.now()}`;
      const requestedToolTaskId = String(body.toolTaskId || '').trim();
      toolTaskId = requestedToolTaskId || generatedToolTaskId;
      resolvedToolWorkDir = normalizedEnv.toolWorkDir || process.env.TOOL_WORK_DIR || '/mnt/tool-workspace';
      const defaultToolWorkspacePath = allocateToolWorkspacePath(resolvedToolWorkDir);
      const requestedWorkspacePath = String(body.workspacePath || '').trim();
      toolWorkspacePath = requestedWorkspacePath && isWorkspacePathUnderBase(requestedWorkspacePath, resolvedToolWorkDir)
        ? requestedWorkspacePath
        : defaultToolWorkspacePath;
      ensureWorkspaceDir(toolWorkspacePath);
      normalizedEnv.env.TOOL_WORK_DIR = resolvedToolWorkDir;
      normalizedEnv.env.TOOL_ID = body.toolId;
      normalizedEnv.env.TOOL_TASK_ID = toolTaskId;
      logger.info(`[Task] Tool mode: toolTaskId=${toolTaskId}, workspace=${toolWorkspacePath}`);
    }

    // Allocate workspace path
    const workspacePath = toolWorkspacePath || allocateWorkspacePath(taskId, body.workspacePath);
    if (!body.workspacePath && !toolWorkspacePath) {
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
            projectPath: normalizedEnv.projectDir || null,
            engine: body.engine || null,
            agent: body.agent || null,
            model: body.model || null,
            apiKey: body.apiKey || null,
            apiBaseUrl: body.apiBaseUrl || null,
            timeoutSec: body.timeoutSec || null,
            skills: body.skills ? JSON.stringify(body.skills) : null,
            mcps: body.mcps ? JSON.stringify(body.mcps) : null,
            env: Object.keys(normalizedEnv.env).length > 0 ? JSON.stringify(normalizedEnv.env) : null,
            rawSubmitPayload,
            preferredWorkerNodeId: body.preferredWorkerNodeId || null,
            targetProduct: body.targetProduct || null,
            maxTokens: body.maxTokens || null,
            contextWindow: body.contextWindow || null,
            platformTaskId: normalizedEnv.platformTaskId || null,
            platformCallbackUrl: body.callbackUrl || null,
            command: body.command ? JSON.stringify(body.command) : null,
            scriptCwd: body.scriptCwd || null,
            // Tool 调度字段
            toolId: body.toolId || null,
            toolTaskId: toolTaskId || null,
            toolPath: body.toolPath || null,
            toolWorkDir: resolvedToolWorkDir || normalizedEnv.toolWorkDir || null,
          },
        })
      );

      // Push the already-created task to Redis Stream for dispatch.
      // Do NOT call dispatcher.submitTask() here — it would re-insert the DB
      // row (duplicate taskId) and the unique-constraint failure would drop
      // the Stream message, leaving the task stuck in 'queued'.
      if (dispatcher?.enqueueExistingTask) {
        await dispatcher.enqueueExistingTask(task.id);
      }

      logger.info(`[Task] Submitted: ${taskId} (workspace: ${workspacePath}${toolTaskId ? `, toolTaskId: ${toolTaskId}` : ''})`);
      return reply.status(201).send({
        taskId: task.taskId,
        dbTaskId: task.id,
        workspacePath,
        ...(toolTaskId ? { toolTaskId } : {}),
        queued: true,
      });
    } catch (error: any) {
      logger.error(`[Task] Submit error: ${error.message}`);
      return reply.status(500).send({ error: 'Task submission failed' });
    }
  });

  // GET /api/codeswarm/task/list
  server.get('/api/codeswarm/task/list', async (request) => {
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
          command: true, scriptCwd: true,
          apiBaseUrl: true, timeoutSec: true, maxTokens: true, contextWindow: true,
          platformTaskId: true, platformCallbackUrl: true,
          projectPath: true, workspacePath: true,
          gitUrl: true, gitRef: true,
          skills: true, scripts: true, mcps: true, env: true,
          rawSubmitPayload: true,
          preferredWorkerNodeId: true, targetProduct: true,
          toolId: true, toolTaskId: true, toolPath: true, toolWorkDir: true,
          startedAt: true, completedAt: true, createdAt: true,
        },
      }),
      prisma.codeswarmTask.count({ where }),
    ]);

    return { tasks, total, limit, offset };
  });

  // GET /api/codeswarm/task/:taskId
  server.get<{ Params: { taskId: string } }>('/api/codeswarm/task/:taskId', async (request, reply) => {
    const task = await prisma.codeswarmTask.findUnique({
      where: { taskId: request.params.taskId },
    });
    if (!task) return reply.status(404).send({ error: 'Task not found' });

    // Fetch events separately (no Prisma relation — taskId is a soft link).
    // Reshape raw rows into the shape the debug UI consumes: spread the JSON
    // `data` payload to the top level (content/phase/skill/tool/...) and expose
    // the DB row time as `timestamp`. Without this the UI reads
    // `event.timestamp` / `event.content` and renders "Invalid Date" / empty text.
    const rawEvents = await prisma.codeswarmEvent.findMany({
      where: { taskId: request.params.taskId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const events = rawEvents.map(e => {
      let payload: Record<string, unknown> = {};
      if (e.data) {
        try { payload = JSON.parse(e.data); } catch { payload = {}; }
      }
      return {
        id: e.id,
        type: e.type,
        level: e.level,
        stream: e.stream,
        timestamp: e.createdAt,
        ...payload,
      };
    });

    return { ...task, events };
  });

  // DELETE /api/codeswarm/task/:taskId
  server.delete<{ Params: { taskId: string } }>('/api/codeswarm/task/:taskId', async (request, reply) => {
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

  // POST /api/codeswarm/task/:taskId/dispatch — manual re-dispatch
  server.post<{ Params: { taskId: string } }>('/api/codeswarm/task/:taskId/dispatch', async (request, reply) => {
    const { taskId } = request.params;
    try {
      const task = await prisma.codeswarmTask.findUnique({ where: { taskId } });
      if (!task) return reply.status(404).send({ error: 'Task not found' });

      if (dispatcher?.triggerDispatch) {
        await dispatcher.triggerDispatch();
      }

      return { success: true, taskId, state: task.state };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // POST /api/codeswarm/task/:taskId/cancel
  server.post<{ Params: { taskId: string } }>('/api/codeswarm/task/:taskId/cancel', async (request, reply) => {
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

  // DELETE /api/codeswarm/task/batch
  server.delete('/api/codeswarm/task/batch', async (request, reply) => {
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
