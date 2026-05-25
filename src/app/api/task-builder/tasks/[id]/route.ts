import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function GET(
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
        TaskExecutionLog: {
          orderBy: { timestamp: 'asc' },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    if (!auth.payload.roles?.includes('admin') && task.userId !== auth.payload.userId) {
      return NextResponse.json({ error: '无权访问此任务' }, { status: 403 });
    }

    // 关联查询 CodeswarmTask 状态和最近事件
    let codeswarmStatus = null;
    if (task.codeswarmTaskId) {
      const csTask = await prisma.codeswarmTask.findUnique({
        where: { taskId: task.codeswarmTaskId },
        select: { state: true, sessionId: true, engine: true, agent: true, model: true, workerId: true, createdAt: true, updatedAt: true },
      });
      if (csTask) {
        const recentEvents = await prisma.codeswarmEvent.findMany({
          where: { taskId: task.codeswarmTaskId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { type: true, data: true, createdAt: true },
        });

        let workerInfo = null;
        if (csTask.workerId) {
          const worker = await prisma.codeswarmWorker.findUnique({
            where: { id: csTask.workerId },
            select: { nodeId: true, status: true },
          });
          if (worker) {
            workerInfo = { workerNodeId: worker.nodeId, workerStatus: worker.status };
          }
        }

        codeswarmStatus = { ...csTask, recentEvents, ...workerInfo };
      }
    }

    return NextResponse.json({ task, logs: task.TaskExecutionLog, codeswarmStatus });
  } catch (error) {
    logger.error(LOG_MODULES.AGENT, '获取任务详情失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '获取任务详情失败' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
  if (!auth.success) return authErrorResponse(auth);

  const { id } = await params;

  try {
    const task = await prisma.taskInstance.findUnique({
      where: { id },
    });

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    if (!auth.payload.roles?.includes('admin') && task.userId !== auth.payload.userId) {
      return NextResponse.json({ error: '无权删除此任务' }, { status: 403 });
    }

    if (task.status === 'running') {
      return NextResponse.json({ error: '执行中的任务无法删除' }, { status: 400 });
    }

    await prisma.taskInstance.delete({
      where: { id },
    });

    return NextResponse.json({ message: '任务已删除' });
  } catch (error) {
    logger.error(LOG_MODULES.AGENT, '删除任务失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '删除任务失败' }, { status: 500 });
  }
}