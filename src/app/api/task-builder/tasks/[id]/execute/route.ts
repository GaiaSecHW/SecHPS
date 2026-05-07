import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma } from '@/lib/prisma';
import eventBus from '@/lib/event-bus';
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

    const mergedSkills = task.mergedSkills || task.skills;
    const mergedScripts = task.mergedScripts || task.scripts;

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

    executeTaskMock(id, mergedSkills, mergedScripts).catch(async (error) => {
      console.error('执行失败:', error);
      
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
      mergedSkills: mergedSkills ? JSON.parse(mergedSkills) : [],
      mergedScripts: mergedScripts ? JSON.parse(mergedScripts) : [],
    });
  } catch (error) {
    console.error('执行任务失败:', error);
    return NextResponse.json({ error: '执行任务失败' }, { status: 500 });
  }
}