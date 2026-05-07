import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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

    if (nodeId) {
      await prisma.codeswarmWorker.updateMany({
        where: { nodeId },
        data: {
          currentTasks: { decrement: 1 },
          status: 'online',
        },
      });
    }

    return NextResponse.json({ success: true, taskId, status: finalState });
  } catch (error) {
    console.error('[CodeSwarm] Result callback error:', error);
    return NextResponse.json(
      { error: 'Failed to record result' },
      { status: 500 }
    );
  }
}