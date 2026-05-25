import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { getAttemptById } from '@/services/skill-evolution/evolution-attempt-manager';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string; attemptId: string }> }
) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }

  try {
    const { attemptId } = await params;

    const attempt = await getAttemptById(attemptId);

    if (!attempt) {
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      attempt: {
        id: attempt.id,
        taskId: attempt.taskId,
        attemptNumber: attempt.attemptNumber,
        falsePositiveCasesUsed: attempt.falsePositiveCasesUsed,
        confirmedCasesUsed: attempt.confirmedCasesUsed,
        falsePositivePatterns: attempt.falsePositivePatterns,
        confirmedPatterns: attempt.confirmedPatterns,
        recommendations: attempt.recommendations,
        improvedContent: attempt.improvedContent,
        changeSummary: attempt.changeSummary,
        backtestSummary: attempt.backtestSummary,
        backtestDetailRows: attempt.backtestDetailRows,
        falsePositiveExclusionRate: attempt.falsePositiveExclusionRate,
        confirmedMissed: attempt.confirmedMissed,
        failureReason: attempt.failureReason,
        missedCasesInfo: attempt.missedCasesInfo,
        remainingFalsePositive: attempt.remainingFalsePositive,
        isPassed: attempt.isPassed,
        status: attempt.status,
        createdAt: attempt.createdAt.toISOString(),
      },
    });
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, 'AttemptDetailAPI Error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get attempt detail' },
      { status: 500 }
    );
  }
}