import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma } from '@/lib/prisma';
import { codeswarmDispatcher } from '@/services/codeswarm-dispatcher';
import { serverLog } from '@/lib/server-log';

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
        serverLog.error('[Stop] 查询 Worker 信息失败:', e);
      }

      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
      try {
        await fetch(`${baseUrl}/api/codeswarm/tasks/${task.codeswarmTaskId}`, {
          method: 'DELETE',
        });
      } catch (deleteError) {
        serverLog.error('删除 CodeSwarm 任务失败:', deleteError);
      }

      // 释放 Worker 负载（幂等，即使 DELETE 已释放也安全）
      if (workerNodeId) {
        codeswarmDispatcher.onTaskCompleted(workerNodeId).catch(e =>
          serverLog.error('[Stop] 释放 Worker 负载失败:', e)
        );
      }
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

    await prisma.taskExecutionLog.create({
      data: {
        id: `log-${Date.now()}-stop`,
        taskId: id,
        level: 'warning',
        message: '任务已停止',
        details: '用户手动停止',
      },
    });

    return NextResponse.json({ message: '任务已停止', taskId: id });
  } catch (error) {
    serverLog.error('停止任务失败:', error);
    return NextResponse.json({ error: '停止任务失败' }, { status: 500 });
  }
}