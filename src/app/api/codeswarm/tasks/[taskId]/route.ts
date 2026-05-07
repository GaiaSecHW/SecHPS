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
      include: {
        CodeswarmWorker: {
          select: {
            nodeId: true,
            address: true,
            status: true,
            maxConcurrent: true,
            currentTasks: true,
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    return NextResponse.json({
      task: {
        ...task,
        skills: task.skills ? JSON.parse(task.skills) : null,
        mcps: task.mcps ? JSON.parse(task.mcps) : null,
        events: task.events ? JSON.parse(task.events) : null,
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

    await prisma.codeswarmTask.delete({ where: { taskId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[CodeSwarm] Delete task error:', error);
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}