import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma, withRetry } from '@/lib/prisma';
import eventBus from '@/lib/event-bus';
import { codeswarmDispatcher } from '@/services/codeswarm-dispatcher';
import { downloadAgentHarness } from '@/lib/minio-client';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return value ? [value] : [];
  }
}

/** Check if workspace contains agent config files (opencode.json etc.) */
function checkWorkspaceHasHarness(workspacePath: string): boolean {
  if (!existsSync(workspacePath)) return false;
  try {
    const entries = readdirSync(workspacePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDir = join(workspacePath, entry.name);
        if (existsSync(join(subDir, 'opencode.json'))) return true;
      } else if (entry.name === 'opencode.json') {
        return true;
      }
    }
  } catch {
    // ignore read errors
  }
  return false;
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

    const workspacePath = task.projectPath || undefined;

    // On-demand: check if workspace has agent harness files, download from MinIO if missing
    if (workspacePath && task.agentId) {
      const hasHarness = checkWorkspaceHasHarness(workspacePath);
      if (!hasHarness) {
        console.log(`[Execute] Workspace missing agent harness, downloading from MinIO: ${task.agentId}`);
        try {
          await downloadAgentHarness(task.agentId, workspacePath);
          console.log(`[Execute] Agent harness downloaded to workspace`);
        } catch (dlError) {
          console.error(`[Execute] Failed to download agent harness from MinIO:`, dlError);
        }
      }
    }
    const skills = mergedSkills ? parseJsonArray(mergedSkills) : undefined;
    const scripts = mergedScripts ? parseJsonArray(mergedScripts) : undefined;

    let model: string | undefined;
    if (task.ModelConfig?.models) {
      try {
        const modelsArray = JSON.parse(task.ModelConfig.models);
        if (Array.isArray(modelsArray) && modelsArray.length > 0) {
          model = modelsArray[0];
        }
      } catch {
        console.warn('解析 ModelConfig.models 失败');
      }
    }
    if (!model) {
      model = task.modelName || undefined;
    }

    const apiKey = task.ModelConfig?.apiKey || undefined;
    const timeoutSec = 18000;
    const engine = agentApp?.engine || 'opencode';
    const agentName = agentApp?.defaultAgentName || undefined;
    const instruction = agentApp?.startCommand || task.notes || null;

    // 直接在数据库创建 CodeSwarm 任务，使用 $executeRaw 避免 Prisma ORM 连接问题
    const codeswarmTaskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const codeswarmDbId = `db-${Date.now()}`;

    await withRetry(() => prisma.$executeRaw`
      INSERT INTO "CodeswarmTask" (
        id, "taskId", state, instruction, "projectPath", "workspacePath",
        skills, scripts, mcps, model, "apiKey", "timeoutSec",
        engine, agent, "targetProduct",
        "platformTaskId", "createdAt", "updatedAt"
      ) VALUES (
        ${codeswarmDbId}, ${codeswarmTaskId}, 'queued',
        ${instruction}, NULL, ${workspacePath || null},
        ${skills ? JSON.stringify(skills) : null},
        ${scripts ? JSON.stringify(scripts) : null},
        NULL, ${model || null}, ${apiKey || null}, ${timeoutSec},
        ${engine}, ${agentName || null},
        ${task.targetProduct || null},
        ${id}, NOW(), NOW()
      )
    `);

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
          workspacePath: workspacePath || null,
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
        };
        const success = await codeswarmDispatcher.sendTaskToWorker(taskRow, worker);
        if (success) {
          codeswarmDispatcher.syncWorkerLoad(worker.nodeId, (worker.currentTasks || 0) + 1);
        }
      }
    }

    await prisma.taskExecutionLog.create({
      data: {
        id: `log-${Date.now()}`,
        taskId: id,
        level: 'info',
        message: 'CodeSwarm 任务已分发',
        details: `taskId: ${codeswarmTaskId}, redis: ${redisSubmitted}`,
      },
    });

    eventBus.emit(`task:${id}`, {
      level: 'info',
      message: 'CodeSwarm 任务已分发',
      details: `taskId: ${codeswarmTaskId}`,
      timestamp: new Date(),
    });

    await prisma.taskInstance.update({
      where: { id },
      data: {
        codeswarmTaskId,
        updatedAt: new Date(),
      },
    });

    // 异步轮询任务结果
    pollCodeswarmTask(id, codeswarmTaskId).catch(async (error) => {
      console.error('CodeSwarm 任务轮询失败:', error);

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
    console.error('执行任务失败:', error);
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
      reject(new Error('任务执行超时（超过2小时）'));
    }, 5 * 60 * 60 * 1000);

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
  const maxPolls = 600;
  const logBuffer: { level: string; message: string; details: string | null }[] = [];
  let lastFlush = 0;

  const flushLogs = async () => {
    if (logBuffer.length === 0) return;
    const batch = logBuffer.splice(0);
    try {
      await prisma.taskExecutionLog.createMany({
        data: batch.map(log => ({
          id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          taskId: localTaskId,
          level: log.level,
          message: log.message,
          details: log.details,
        })),
      });
    } catch { /* non-critical */ }
  };

  for (let i = 0; i < maxPolls; i++) {
    const now = Date.now();
    if (now - lastFlush >= 10000) {
      await flushLogs();
      lastFlush = now;
    }

    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      const csTask = await prisma.codeswarmTask.findUnique({
        where: { taskId: codeswarmTaskId },
        select: {
          state: true,
          result: true,
          reportContent: true,
          error: true,
          events: true,
        },
      });

      if (!csTask) throw new Error('CodeSwarm 任务不存在');

      if (csTask.state === 'completed') {
        await flushLogs();
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
        await flushLogs();
        throw new Error(csTask.error || 'CodeSwarm 任务执行失败');
      }

      if (csTask.events) {
        try {
          const events = typeof csTask.events === 'string' ? JSON.parse(csTask.events) : csTask.events;
          const recentEvents = Array.isArray(events) ? events.slice(-5) : [];
          for (const event of recentEvents) {
            if (event.type === 'agent_message_chunk') {
              logBuffer.push({ level: 'info', message: 'Agent 输出', details: event.content || null });
            } else if (event.type === 'tool_call') {
              logBuffer.push({ level: 'info', message: '工具调用', details: `工具: ${event.tool}` });
            } else if (event.type === 'error') {
              logBuffer.push({ level: 'error', message: '执行错误', details: event.message || null });
            }
          }
        } catch { /* ignore parse errors */ }
      }
    } catch (pollError) {
      await flushLogs();
      throw pollError;
    }
  }

  await flushLogs();
  throw new Error('任务执行超时（超过1小时）');
}
