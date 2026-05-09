import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma } from '@/lib/prisma';
import eventBus from '@/lib/event-bus';

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

    if (!['pending', 'completed', 'failed'].includes(task.status)) {
      return NextResponse.json({ error: '任务状态不允许执行' }, { status: 400 });
    }

    const agentApp = await prisma.agentApp.findUnique({
      where: { id: task.agentId },
      select: {
        engine: true,
        name: true,
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

    const instruction = task.notes || 'opencode run';
    const workspacePath = task.projectPath || undefined;

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

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const codeswarmResponse = await fetch(`${baseUrl}/api/codeswarm/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction,
        workspacePath,
        model,
        apiKey,
        timeoutSec,
        agent,
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
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const maxPolls = 600; // 600 * 2s = 1200s (20 minutes max)

  for (let i = 0; i < maxPolls; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      const response = await fetch(`${baseUrl}/api/codeswarm/tasks/${codeswarmTaskId}`);
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('CodeSwarm 任务已被删除');
        }
        throw new Error(`查询 CodeSwarm 任务失败: ${response.status}`);
      }

      const data = await response.json();
      const task = data.task;

      if (!task) {
        throw new Error('CodeSwarm 任务不存在');
      }

      if (task.state === 'completed') {
        await prisma.taskInstance.update({
          where: { id: localTaskId },
          data: {
            status: 'completed',
            completedAt: new Date(),
            updatedAt: new Date(),
            executionResult: task.result || null,
            reportPath: task.reportContent || null,
          },
        });

        eventBus.emit(`task:${localTaskId}`, {
          type: 'completed',
          level: 'success',
          message: '任务执行完成',
          details: '所有步骤已完成',
          timestamp: new Date(),
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
            await prisma.taskExecutionLog.create({
              data: {
                id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                taskId: localTaskId,
                level: 'info',
                message: 'Agent 输出',
                details: event.content?.substring(0, 200) || null,
              },
            });
          } else if (event.type === 'tool_call') {
            await prisma.taskExecutionLog.create({
              data: {
                id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                taskId: localTaskId,
                level: 'info',
                message: '工具调用',
                details: `工具: ${event.tool}`,
              },
            });
          } else if (event.type === 'error') {
            await prisma.taskExecutionLog.create({
              data: {
                id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                taskId: localTaskId,
                level: 'error',
                message: '执行错误',
                details: event.message || null,
              },
            });
          }
        }
      }
    } catch (pollError) {
      console.error(`[pollCodeswarmTask] 轮询失败:`, pollError);
      throw pollError;
    }
  }

  throw new Error('任务执行超时（超过20分钟）');
}
