import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { codeswarmDispatcher } from '@/services/codeswarm-dispatcher';

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
    });

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    if (!auth.payload.roles?.includes('admin') && task.userId !== auth.payload.userId) {
      return NextResponse.json({ error: '无权停止此任务' }, { status: 403 });
    }

    if (task.status !== 'running') {
      return NextResponse.json({ error: '只有运行中的任务可以停止' }, { status: 400 });
    }

    if (task.codeswarmTaskId) {
      // 先查询 Worker 信息用于释放负载
      let workerNodeId: string | null = null;
      try {
        const csTask = await prisma.codeswarmTask.findFirst({
          where: { taskId: task.codeswarmTaskId },
          select: { workerId: true },
        });
        if (csTask?.workerId) {
          const csWorker = await prisma.codeswarmWorker.findUnique({
            where: { id: csTask.workerId },
            select: { nodeId: true },
          });
          workerNodeId = csWorker?.nodeId ?? null;
        }
      } catch (e) {
        logger.error(LOG_MODULES.AGENT, '[Stop] 查询 Worker 信息失败', { details: { error: e instanceof Error ? e.message : String(e) } });
      }

      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
      try {
        await fetch(`${baseUrl}/api/codeswarm/tasks/${task.codeswarmTaskId}`, {
          method: 'DELETE',
        });
      } catch (deleteError) {
        logger.error(LOG_MODULES.AGENT, '删除 CodeSwarm 任务失败', { details: { error: deleteError instanceof Error ? deleteError.message : String(deleteError) } });
      }

// DELETE 端点内部已调 onTaskCompleted 释放 Worker 负载，此处不再重复调用
    }

    await prisma.taskInstance.update({
      where: { id },
      data: {
        status: 'failed',
        errorMessage: '用户手动停止任务',
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const stopLogId = `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-stop`;
    await prisma.taskExecutionLog.upsert({
      where: { id: stopLogId },
      create: {
        id: stopLogId,
        taskId: id,
        level: 'warning',
        message: '任务已停止',
        details: '用户手动停止',
      },
      update: {},
    });

    return NextResponse.json({ message: '任务已停止', taskId: id });
  } catch (error) {
    logger.error(LOG_MODULES.AGENT, '停止任务失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '停止任务失败' }, { status: 500 });
  }
}