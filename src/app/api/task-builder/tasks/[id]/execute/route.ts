import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { executeTaskMock } from '@/services/task-executor-mock';

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

    if (!['pending', 'completed', 'failed'].includes(task.status)) {
      return NextResponse.json({ error: '任务状态不允许执行' }, { status: 400 });
    }

    await prisma.taskInstance.update({
      where: { id },
      data: {
        status: 'running',
        startedAt: new Date(),
        completedAt: null,
        errorMessage: null,
        updatedAt: new Date(),
      },
    });

    await prisma.taskExecutionLog.deleteMany({
      where: { taskId: id },
    });

    executeTaskMock(id).catch(async (error) => {
      console.error('Mock 执行失败:', error);
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

    return NextResponse.json({ message: '任务已开始执行', taskId: id });
  } catch (error) {
    console.error('执行任务失败:', error);
    return NextResponse.json({ error: '执行任务失败' }, { status: 500 });
  }
}