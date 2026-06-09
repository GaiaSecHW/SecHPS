import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { codeswarmDispatcher } from '@/services/codeswarm-dispatcher';

type DisplayStatus = 'pending' | 'queued' | 'dispatched' | 'running' | 'completed' | 'failed';

function mapDisplayStatus(
  taskStatus: string,
  codeswarmState: string | null | undefined,
  hasCodeswarmTaskId: boolean,
): DisplayStatus {
  if (!hasCodeswarmTaskId || codeswarmState === null || codeswarmState === undefined) {
    if (taskStatus === 'completed') return 'completed';
    if (taskStatus === 'failed') return 'failed';
    if (taskStatus === 'running') return 'running';
    return 'pending';
  }
  switch (codeswarmState) {
    case 'queued': return 'queued';
    case 'dispatched': return 'dispatched';
    case 'building': return 'running';
    case 'running': return 'running';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    default: return 'pending';
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
  if (!auth.success) return authErrorResponse(auth);

  const { payload, tenant } = auth as AuthSuccessResult;
  const { id } = await params;

  try {
    const task = await prisma.taskInstance.findUnique({
      where: { id },
    });

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    if (!tenant.isPlatformAdmin && !tenant.isIcsTenant && !payload.roles?.includes('admin') && task.userId !== payload.userId) {
      return NextResponse.json({ error: '无权停止此任务' }, { status: 403 });
    }

    // 合并查询 CodeswarmTask state（displayStatus 判断 + 后续 Worker 信息共用）
    let csState: string | null = null;
    let csWorkerId: string | null = null;
    if (task.codeswarmTaskId) {
      const csTask = await prisma.codeswarmTask.findFirst({
        where: { taskId: task.codeswarmTaskId },
        select: { state: true, workerId: true },
      });
      csState = csTask?.state ?? null;
      csWorkerId = csTask?.workerId ?? null;
    }
    const displayStatus = mapDisplayStatus(task.status, csState, !!task.codeswarmTaskId);

    if (!['running', 'queued', 'dispatched'].includes(displayStatus)) {
      return NextResponse.json({ error: `只有运行中或排队中的任务可以停止（当前状态: ${displayStatus}）` }, { status: 400 });
    }

    if (task.codeswarmTaskId) {
      // 仅做日志记录，DELETE 端点内部已负责 Worker 负载释放
      if (csWorkerId) {
        try {
          const csWorker = await prisma.codeswarmWorker.findUnique({
            where: { id: csWorkerId },
            select: { nodeId: true },
          });
          logger.info(LOG_MODULES.AGENT, `[Stop] 任务关联 Worker: ${csWorker?.nodeId ?? 'unknown'}`);
        } catch { /* non-critical */ }
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