import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma } from '@/lib/prisma';
import eventBus from '@/lib/event-bus';
import { codeswarmDispatcher } from '@/services/codeswarm-dispatcher';

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

    await prisma.taskInstance.update({
      where: { id },
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
    const timeoutSec = 300;
    const agent = agentApp?.engine || 'opencode';
    const defaultAgentName = agentApp?.defaultAgentName || undefined;
    const startCommand = agentApp?.startCommand || undefined;
    const instruction = task.notes || defaultAgentName || '执行任务';

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const codeswarmResponse = await fetch(`${baseUrl}/api/codeswarm/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction,
        workspacePath,
        skills,
        scripts,
        model,
        apiKey,
        timeoutSec,
        agent,
        defaultAgentName,
        startCommand,
      }),
    });

    if (!codeswarmResponse.ok) {
      const errorData = await codeswarmResponse.json();
      throw new Error(errorData.error || 'CodeSwarm 任务创建失败');
    }

    const codeswarmData = await codeswarmResponse.json();

    await prisma.taskExecutionLog.create({
      data: {
        id: `log-${Date.now()}`,
        taskId: id,
        level: 'info',
        message: 'CodeSwarm 任务已分发',
        details: `taskId: ${codeswarmData.taskId}, worker: ${codeswarmData.workerAddress || 'queued'}`,
      },
    });

    eventBus.emit(`task:${id}`, {
      level: 'info',
      message: 'CodeSwarm 任务已分发',
      details: `taskId: ${codeswarmData.taskId}`,
      timestamp: new Date(),
    });

    pollCodeswarmTask(id, codeswarmData.taskId).catch(async (error) => {
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

    await prisma.taskInstance.update({
      where: { id },
      data: {
        codeswarmTaskId: codeswarmData.taskId,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({
      message: '任务已开始执行',
      taskId: id,
      codeswarmTaskId: codeswarmData.taskId,
      dispatched: codeswarmData.dispatched,
      workerAddress: codeswarmData.workerAddress,
      mergedSkills: parseJsonArray(mergedSkills),
      mergedScripts: parseJsonArray(mergedScripts),
    });
  } catch (error) {
    console.error('执行任务失败:', error);
    return NextResponse.json({ error: '执行任务失败' }, { status: 500 });
  }
}

async function pollCodeswarmTask(localTaskId: string, codeswarmTaskId: string): Promise<void> {
  // 优先使用 Redis 订阅
  if (codeswarmDispatcher.isAvailable) {
    await pollViaRedis(localTaskId, codeswarmTaskId);
  } else {
    await pollViaDB(localTaskId, codeswarmTaskId);
  }
}

// Redis 订阅模式：实时接收任务状态变更
async function pollViaRedis(localTaskId: string, codeswarmTaskId: string): Promise<void> {
  const Redis = (await import('ioredis')).default;
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL 未配置');

  const subscriber = new Redis(redisUrl);
  const channel = `codeswarm:task:${codeswarmTaskId}`;

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      subscriber.disconnect();
      reject(new Error('任务执行超时（超过20分钟）'));
    }, 20 * 60 * 1000);

    subscriber.subscribe(channel);
    subscriber.on('message', async (_ch: string, data: string) => {
      try {
        const event = JSON.parse(data);

        if (event.type === 'task_completed') {
          clearTimeout(timeout);
          subscriber.disconnect();

          // 从 DB 读取最终结果
          const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
          const resp = await fetch(`${baseUrl}/api/codeswarm/tasks/${codeswarmTaskId}`);
          const taskData = resp.ok ? (await resp.json()).task : null;

          if (event.status === 'completed') {
            await prisma.taskInstance.update({
              where: { id: localTaskId },
              data: {
                status: 'completed',
                completedAt: new Date(),
                updatedAt: new Date(),
                executionResult: taskData?.result || null,
                reportPath: taskData?.reportContent || null,
              },
            });
            eventBus.emit(`task:${localTaskId}`, {
              type: 'completed', level: 'success',
              message: '任务执行完成', details: '所有步骤已完成',
              timestamp: new Date(),
            });
            resolve();
          } else {
            reject(new Error(taskData?.error || 'CodeSwarm 任务执行失败'));
          }
        }

        if (event.type === 'task_event' && event.data) {
          const e = event.data;
          if (e.type === 'agent_message_chunk') {
            await prisma.taskExecutionLog.create({
              data: { id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, taskId: localTaskId, level: 'info', message: 'Agent 输出', details: e.content || null },
            });
          } else if (e.type === 'tool_call') {
            await prisma.taskExecutionLog.create({
              data: { id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, taskId: localTaskId, level: 'info', message: '工具调用', details: `工具: ${e.tool}` },
            });
          } else if (e.type === 'error') {
            await prisma.taskExecutionLog.create({
              data: { id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, taskId: localTaskId, level: 'error', message: '执行错误', details: e.message || null },
            });
          }
        }
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

// DB 轮询 fallback：Redis 不可用时使用
async function pollViaDB(localTaskId: string, codeswarmTaskId: string): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
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
    // 每 10s 批量写入一次日志
    if (now - lastFlush >= 10000) {
      await flushLogs();
      lastFlush = now;
    }

    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      const response = await fetch(`${baseUrl}/api/codeswarm/tasks/${codeswarmTaskId}`);

      if (!response.ok) {
        if (response.status === 404) throw new Error('CodeSwarm 任务已被删除');
        throw new Error(`查询 CodeSwarm 任务失败: ${response.status}`);
      }

      const data = await response.json();
      const task = data.task;
      if (!task) throw new Error('CodeSwarm 任务不存在');

      if (task.state === 'completed') {
        await flushLogs();
        await prisma.taskInstance.update({
          where: { id: localTaskId },
          data: {
            status: 'completed', completedAt: new Date(), updatedAt: new Date(),
            executionResult: task.result || null, reportPath: task.reportContent || null,
          },
        });
        eventBus.emit(`task:${localTaskId}`, {
          type: 'completed', level: 'success',
          message: '任务执行完成', details: '所有步骤已完成', timestamp: new Date(),
        });
        return;
      }

      if (task.state === 'failed') {
        throw new Error(task.error || 'CodeSwarm 任务执行失败');
      }

      if (task.events && task.events.length > 0) {
        const recentEvents = task.events.slice(-5);
        for (const event of recentEvents) {
          if (event.type === 'agent_message_chunk') {
            logBuffer.push({ level: 'info', message: 'Agent 输出', details: event.content || null });
          } else if (event.type === 'tool_call') {
            logBuffer.push({ level: 'info', message: '工具调用', details: `工具: ${event.tool}` });
          } else if (event.type === 'error') {
            logBuffer.push({ level: 'error', message: '执行错误', details: event.message || null });
          }
        }
      }
    } catch (pollError) {
      await flushLogs();
      throw pollError;
    }
  }

  await flushLogs();
  throw new Error('任务执行超时（超过20分钟）');
}
