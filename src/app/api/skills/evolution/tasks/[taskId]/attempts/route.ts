import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { getAttemptsByTaskId } from '@/services/skill-evolution/evolution-attempt-manager';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }

  try {
    const { taskId } = await params;

    const attempts = await getAttemptsByTaskId(taskId);

    return NextResponse.json({
      success: true,
      attempts: attempts.map(a => ({
        id: a.id,
        taskId: a.taskId,
        attemptNumber: a.attemptNumber,
        isPassed: a.isPassed,
        status: a.status,
        falsePositiveExclusionRate: a.falsePositiveExclusionRate,
        confirmedMissed: a.confirmedMissed,
        failureReason: a.failureReason,
        createdAt: a.createdAt.toISOString(),
      })),
      total: attempts.length,
    });
  } catch (error) {
    console.error('[AttemptsAPI] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get attempts' },
      { status: 500 }
    );
  }
}