import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { codeswarmDispatcher } from '@/services/codeswarm-dispatcher';
import eventBus from '@/lib/event-bus';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { taskId, nodeId, status, result, error, reportContent } = body;

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    const finalState = status === 'completed' ? 'completed' : 'failed';

    await prisma.codeswarmTask.update({
      where: { taskId },
      data: {
        state: finalState,
        result: result || null,
        error: error || null,
        reportContent: reportContent || null,
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const taskInstance = await prisma.taskInstance.findFirst({
      where: { codeswarmTaskId: taskId },
      select: { id: true },
    });

    if (taskInstance) {
      await prisma.taskInstance.update({
        where: { id: taskInstance.id },
        data: {
          status: finalState,
          completedAt: new Date(),
          updatedAt: new Date(),
          errorMessage: error || null,
          executionResult: result || null,
          reportPath: reportContent || null,
        },
      });

      await prisma.taskExecutionLog.create({
        data: {
          id: `log-${Date.now()}-complete`,
          taskId: taskInstance.id,
          level: finalState === 'completed' ? 'success' : 'error',
          message: finalState === 'completed' ? '任务执行完成' : '任务执行失败',
          details: error || '所有步骤已完成',
          timestamp: new Date(),
        },
      });

      eventBus.emit(`task:${taskInstance.id}`, {
        type: finalState,
        level: finalState === 'completed' ? 'success' : 'error',
        message: finalState === 'completed' ? '任务执行完成' : '任务执行失败',
        details: error || '所有步骤已完成',
        timestamp: new Date().toISOString(),
      });
    }

    // Worker 槽位释放：内存和 DB 同步递减（幂等性检查）
    // onTaskCompleted 内部处理内存递减 + DB 条件更新
    if (nodeId) {
      await codeswarmDispatcher.onTaskCompleted(nodeId);
    }

    await codeswarmDispatcher.publishTaskEvent(taskId, {
      type: 'task_completed',
      status: finalState,
    });

    return NextResponse.json({ success: true, taskId, status: finalState });
  } catch (error) {
    console.error('[CodeSwarm] Result callback error:', error);
    return NextResponse.json(
      { error: 'Failed to record result' },
      { status: 500 }
    );
  }
}