import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma, withRetry } from '@/lib/prisma';
import eventBus from '@/lib/event-bus';
import { codeswarmDispatcher } from '@/services/codeswarm-dispatcher';

/** 任务执行超时（秒），默认 7天 (7*24*3600=604800)，可通过 .env TASK_TIMEOUT_SEC 配置 */
const DEFAULT_TASK_TIMEOUT_SEC = 7 * 24 * 3600;
const TASK_TIMEOUT_SEC = parseInt(process.env.TASK_TIMEOUT_SEC || String(DEFAULT_TASK_TIMEOUT_SEC));
const TASK_TIMEOUT_MS = TASK_TIMEOUT_SEC * 1000;

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return value ? [value] : [];
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
  if (!auth.success) return authErrorResponse(auth);

  const { id } = await params;

  try {
    const task = await prisma.taskInstance.findUnique({
      where: { id },
      include: {
        ModelConfig: {
          select: {
            apiKey: true,
            name: true,
            models: true,
            apiBaseUrl: true,
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    if (!auth.payload.roles?.includes('admin') && task.userId !== auth.payload.userId) {
      return NextResponse.json({ error: '无权执行此任务' }, { status: 403 });
    }

    if (!['pending', 'completed', 'failed'].includes(task.status)) {
      return NextResponse.json({ error: '任务状态不允许执行' }, { status: 400 });
    }

    const agentApp = await prisma.agentApp.findUnique({
      where: { id: task.agentId },
      select: {
        engine: true,
        name: true,
        defaultAgentName: true,
        startCommand: true,
      },
    });

    const mergedSkills = task.mergedSkills || task.skills || undefined;
    const mergedScripts = task.mergedScripts || task.scripts || undefined;

    const updateResult = await prisma.taskInstance.updateMany({
      where: { id, status: { in: ['pending', 'completed', 'failed'] } },
      data: {
        status: 'running',
        startedAt: new Date(),
        completedAt: null,
        errorMessage: null,
        mergedSkills,
        mergedScripts,
        updatedAt: new Date(),
      },
    });

    if (updateResult.count === 0) {
      return NextResponse.json({ error: '任务状态已变更，无法执行' }, { status: 409 });
    }

    await prisma.taskExecutionLog.deleteMany({
      where: { taskId: id },
    });

    eventBus.emit(`task:${id}`, {
      level: 'info',
      message: '任务开始执行',
      details: `Agent: ${task.agentName}`,
      timestamp: new Date(),
    });

    const workspaceStorageKey = task.workspaceStorageKey || undefined;
    const skills = mergedSkills ? parseJsonArray(mergedSkills) : undefined;
    const scripts = mergedScripts ? parseJsonArray(mergedScripts) : undefined;

    // Prefer user-selected model name, fall back to first model in config
    let model: string | undefined = task.modelName || undefined;
    if (!model && task.ModelConfig?.models) {
      try {
        const modelsArray = JSON.parse(task.ModelConfig.models);
        if (Array.isArray(modelsArray) && modelsArray.length > 0) {
          model = modelsArray[0];
        }
      } catch {
        logger.warn(LOG_MODULES.AGENT, '解析 ModelConfig.models 失败');
      }
    }

    const apiKey = task.ModelConfig?.apiKey || undefined;
    const apiBaseUrl = task.ModelConfig?.apiBaseUrl || undefined;
    const timeoutSec = TASK_TIMEOUT_SEC;
    const engine = agentApp?.engine || 'opencode';
    const agentName = agentApp?.defaultAgentName || undefined;
    const instruction = agentApp?.startCommand || task.notes || null;

    // 直接在数据库创建 CodeSwarm 任务，使用 $executeRaw 避免 Prisma ORM 连接问题
    const codeswarmTaskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const codeswarmDbId = `db-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    await withRetry(() => prisma.$executeRaw`
      INSERT INTO "CodeswarmTask" (
        id, "taskId", state, instruction, "projectPath", "workspacePath",
        skills, scripts, mcps, model, "apiKey", "timeoutSec",
        engine, agent, "targetProduct", "apiBaseUrl",
        "platformTaskId", "createdAt", "updatedAt"
      ) VALUES (
        ${codeswarmDbId}, ${codeswarmTaskId}, 'queued',
        ${instruction}, NULL, ${workspaceStorageKey || null},
        ${skills ? JSON.stringify(skills) : null},
        ${scripts ? JSON.stringify(scripts) : null},
        NULL, ${model || null}, ${apiKey || null}, ${timeoutSec},
        ${engine}, ${agentName || null},
        ${task.targetProduct || null}, ${apiBaseUrl || null},
        ${id}, NOW(), NOW()
      )
    `);

    // 先绑定 codeswarmTaskId，确保 Worker 事件到达时能找到 taskInstance
    await prisma.taskInstance.update({
      where: { id },
      data: {
        codeswarmTaskId,
        updatedAt: new Date(),
      },
    });

    // 确保调度器已初始化
    if (!codeswarmDispatcher.isAvailable) {
      await codeswarmDispatcher.init();
    }

    // 提交到 Redis Stream 或 DB fallback 分发
    const redisSubmitted = await codeswarmDispatcher.submitTask(codeswarmDbId);
    if (!redisSubmitted) {
      // DB fallback：查找可用 Worker 直接分发
      const allWorkers = await withRetry(() => prisma.$queryRaw`
        SELECT id, "nodeId", address, status, "maxConcurrent", "currentTasks"
        FROM "CodeswarmWorker"
        WHERE status = 'online'
        ORDER BY "currentTasks" ASC
        LIMIT 50
      `) as any[];

      const worker = allWorkers.find(w => w.currentTasks < w.maxConcurrent);
      if (worker) {
        // 构造 sendTaskToWorker 需要的任务对象
        const taskRow = {
          id: codeswarmDbId,
          taskId: codeswarmTaskId,
          instruction: instruction,
          projectPath: null,
          workspacePath: workspaceStorageKey || null,
          skills: skills ? JSON.stringify(skills) : null,
          scripts: scripts ? JSON.stringify(scripts) : null,
          mcps: null,
          model: model || null,
          apiKey: apiKey || null,
          timeoutSec,
          engine: engine || null,
          agent: agentName || null,
          preferredWorkerNodeId: null,
          targetProduct: task.targetProduct || null,
          apiBaseUrl: apiBaseUrl || null,
        };
        const success = await codeswarmDispatcher.sendTaskToWorker(taskRow, worker);
        if (success) {
          codeswarmDispatcher.syncWorkerLoad(worker.nodeId, (worker.currentTasks || 0) + 1);
        }
      }
    }

    const dispatchLogId = `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await prisma.taskExecutionLog.upsert({
      where: { id: dispatchLogId },
      create: {
        id: dispatchLogId,
        taskId: id,
        level: 'info',
        message: 'CodeSwarm 任务已分发',
        details: `taskId: ${codeswarmTaskId}, redis: ${redisSubmitted}`,
      },
      update: {},
    });

    eventBus.emit(`task:${id}`, {
      level: 'info',
      message: 'CodeSwarm 任务已分发',
      details: `taskId: ${codeswarmTaskId}`,
      timestamp: new Date(),
    });

    // 异步轮询任务结果
    pollCodeswarmTask(id, codeswarmTaskId).catch(async (error) => {
      logger.error(LOG_MODULES.AGENT, 'CodeSwarm 任务轮询失败', { details: { error: error instanceof Error ? error.message : String(error) } });

      eventBus.emit(`task:${id}`, {
        type: 'error',
        level: 'error',
        message: '任务执行失败',
        details: error instanceof Error ? error.message : '执行失败',
        timestamp: new Date(),
      });

      await prisma.taskInstance.update({
        where: { id },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : '执行失败',
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      });
    });

    return NextResponse.json({
      message: '任务已开始执行',
      taskId: id,
      codeswarmTaskId,
      dispatched: redisSubmitted,
      mergedSkills: parseJsonArray(mergedSkills),
      mergedScripts: parseJsonArray(mergedScripts),
    });
  } catch (error) {
    logger.error(LOG_MODULES.AGENT, '执行任务失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    // 回滚 TaskInstance 状态，防止卡在 running
    try {
      await prisma.taskInstance.updateMany({
        where: { id, status: 'running' },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : '执行任务失败',
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      });
    } catch (rollbackErr) {
      logger.error(LOG_MODULES.AGENT, '回滚 TaskInstance 状态失败', { details: { error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr) } });
    }
    return NextResponse.json({ error: '执行任务失败' }, { status: 500 });
  }
}

async function pollCodeswarmTask(localTaskId: string, codeswarmTaskId: string): Promise<void> {
  if (codeswarmDispatcher.isAvailable) {
    await pollViaRedis(localTaskId, codeswarmTaskId);
  } else {
    await pollViaDB(localTaskId, codeswarmTaskId);
  }
}

async function pollViaRedis(localTaskId: string, codeswarmTaskId: string): Promise<void> {
  const Redis = (await import('ioredis')).default;
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL 未配置');

  const subscriber = new Redis(redisUrl);
  const channel = `codeswarm:task:${codeswarmTaskId}`;

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      subscriber.disconnect();
      reject(new Error(`任务执行超时（超过${TASK_TIMEOUT_SEC / 3600}小时）`));
    }, TASK_TIMEOUT_MS);

    subscriber.subscribe(channel);
    subscriber.on('message', async (_ch: string, data: string) => {
      try {
        const event = JSON.parse(data);

        if (event.type === 'task_completed') {
          clearTimeout(timeout);
          subscriber.disconnect();

          const csTask = await prisma.codeswarmTask.findUnique({
            where: { taskId: codeswarmTaskId },
            select: { result: true, reportContent: true, error: true },
          });

          if (event.status === 'completed') {
            await prisma.taskInstance.update({
              where: { id: localTaskId },
              data: {
                status: 'completed',
                completedAt: new Date(),
                updatedAt: new Date(),
                executionResult: csTask?.result || null,
                reportPath: csTask?.reportContent || null,
              },
            });
            eventBus.emit(`task:${localTaskId}`, {
              type: 'completed', level: 'success',
              message: '任务执行完成', details: '所有步骤已完成',
              timestamp: new Date(),
            });
            resolve();
          } else {
            subscriber.disconnect();
            reject(new Error(csTask?.error || 'CodeSwarm 任务执行失败'));
          }
        }

        // TaskExecutionLog 由 event route 直接创建，无需在 Redis 订阅中重复创建
      } catch (e) {
        reject(e);
      }
    });

    subscriber.on('error', (err) => {
      clearTimeout(timeout);
      subscriber.disconnect();
      reject(err);
    });
  });
}

async function pollViaDB(localTaskId: string, codeswarmTaskId: string): Promise<void> {
  // 总超时与 TASK_TIMEOUT_SEC 对齐，可通过 .env TASK_TIMEOUT_SEC 配置
  const TIMEOUT_MS = TASK_TIMEOUT_MS;
  const startTime = Date.now();
  // 渐进退避：2s → 4s → 8s → 10s（上限），减少长时间轮询的 DB 压力
  let interval = 2000;
  const MAX_INTERVAL = 10_000;

  while (Date.now() - startTime < TIMEOUT_MS) {
    await new Promise(resolve => setTimeout(resolve, interval));

    const csTask = await prisma.codeswarmTask.findUnique({
      where: { taskId: codeswarmTaskId },
      select: {
        state: true,
        result: true,
        reportContent: true,
        error: true,
      },
    });

    if (!csTask) throw new Error('CodeSwarm 任务不存在');

    if (csTask.state === 'completed') {
      await prisma.taskInstance.update({
        where: { id: localTaskId },
        data: {
          status: 'completed', completedAt: new Date(), updatedAt: new Date(),
          executionResult: csTask.result || null, reportPath: csTask.reportContent || null,
        },
      });
      eventBus.emit(`task:${localTaskId}`, {
        type: 'completed', level: 'success',
        message: '任务执行完成', details: '所有步骤已完成', timestamp: new Date(),
      });
      return;
    }

    if (csTask.state === 'failed') {
      throw new Error(csTask.error || 'CodeSwarm 任务执行失败');
    }

    interval = Math.min(interval * 2, MAX_INTERVAL);
  }

  throw new Error(`任务执行超时（超过${TASK_TIMEOUT_SEC / 3600}小时）`);
}
