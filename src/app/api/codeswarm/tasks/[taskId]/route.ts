import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    const task = await prisma.codeswarmTask.findUnique({
      where: { taskId },
      select: {
        id: true,
        taskId: true,
        workerId: true,
        state: true,
        instruction: true,
        projectPath: true,
        workspacePath: true,
        gitUrl: true,
        gitRef: true,
        skills: true,
        mcps: true,
        model: true,
        apiKey: true,
        timeoutSec: true,
        agent: true,
        events: true,
        result: true,
        error: true,
        reportContent: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // 单独查询 Worker 信息
    const worker = task.workerId
      ? await prisma.codeswarmWorker.findUnique({
          where: { id: task.workerId },
          select: { nodeId: true, address: true, status: true, maxConcurrent: true, currentTasks: true },
        })
      : null;

    // 优先从 CodeswarmEvent 表读取事件，回退到旧 JSON 字段
    const newEvents = await prisma.codeswarmEvent.findMany({
      where: { taskId: task.taskId },
      orderBy: { createdAt: 'asc' },
    });

    const events = newEvents.length > 0
      ? newEvents.map(e => ({ ...JSON.parse(e.data), _id: e.id, _createdAt: e.createdAt }))
      : (task.events ? JSON.parse(task.events) : null);

    return NextResponse.json({
      task: {
        ...task,
        skills: task.skills ? JSON.parse(task.skills) : null,
        mcps: task.mcps ? JSON.parse(task.mcps) : null,
        events,
        CodeswarmWorker: worker,
      },
    });
  } catch (error) {
    console.error('[CodeSwarm] Get task error:', error);
    return NextResponse.json({ error: 'Failed to fetch task' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    await prisma.codeswarmEvent.deleteMany({ where: { taskId } });
    await prisma.codeswarmTask.delete({ where: { taskId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[CodeSwarm] Delete task error:', error);
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}
