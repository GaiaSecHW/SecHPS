import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SESSION_READ });
  if (!auth.success) return authErrorResponse(auth);

  const { id } = await params;

  try {
    const task = await prisma.taskInstance.findUnique({
      where: { id },
      select: {
        userId: true,
        status: true,
        executionResult: true,
        reportPath: true,
        errorMessage: true,
        completedAt: true,
        startedAt: true,
      }
    });

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    if (!auth.payload.roles?.includes('admin') && task.userId !== auth.payload.userId) {
      return NextResponse.json({ error: '无权访问此任务' }, { status: 403 });
    }

    let result = null;
    if (task.executionResult) {
      try {
        result = JSON.parse(task.executionResult);
      } catch {
        result = task.executionResult;
      }
    }

    return NextResponse.json({
      status: task.status,
      result,
      reportPath: task.reportPath,
      errorMessage: task.errorMessage,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
    });
  } catch (error) {
    logger.error(LOG_MODULES.AGENT, '获取任务结果失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '获取任务结果失败' }, { status: 500 });
  }
}