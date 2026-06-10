import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Scheduler → Platform callback
 * Called when a task completes/fails in the microservice
 */
export async function POST(request: Request) {
  const body = await request.json();
  const { taskId, platformTaskId, status, result, error, reportContent } = body;

  if (!platformTaskId) {
    return NextResponse.json({ error: 'Missing platformTaskId' }, { status: 400 });
  }

  try {
    // Update TaskInstance status
    const updated = await prisma.taskInstance.updateMany({
      where: { id: platformTaskId },
      data: {
        status: status === 'completed' ? 'completed' : 'failed',
        ...(result ? { output: result } : {}),
        ...(error ? { error } : {}),
        ...(reportContent ? { reportContent } : {}),
        completedAt: new Date(),
      },
    });

    // TODO: Trigger vulnerability parsing if status === 'completed'
    // TODO: Write TaskExecutionLog
    // TODO: Push SSE event to frontend

    return NextResponse.json({ ok: true, updated: updated.count });
  } catch (error: any) {
    console.error('[Platform Callback] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
