import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { runBacktest, getBacktestDetailRows } from '@/services/skill-evolution/backtest-validator';
import type { CompactCase } from '@/services/skill-evolution/case-extractor';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }

  try {
    const { taskId } = await params;

    const task = await prisma.skillEvolutionTask.findUnique({
      where: { id: taskId },
      include: {
        Skill: {
          select: {
            id: true,
            displayName: true,
            content: true,
          },
        },
        SkillImprovement: {
          select: {
            id: true,
            improvedContent: true,
            falsePositiveCases: true,
            confirmedCases: true,
            status: true,
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (!task.SkillImprovement) {
      return NextResponse.json({ error: 'No improvement found for this task' }, { status: 400 });
    }

    if (!task.SkillImprovement.improvedContent) {
      return NextResponse.json({ error: 'Improved content is empty' }, { status: 400 });
    }

    let falsePositiveCases: CompactCase[] = [];
    let confirmedCases: CompactCase[] = [];

    try {
      if (task.SkillImprovement.falsePositiveCases) {
        falsePositiveCases = JSON.parse(task.SkillImprovement.falsePositiveCases);
      }
    } catch {
      logger.warn(LOG_MODULES.SKILL, 'Failed to parse falsePositiveCases');
    }

    try {
      if (task.SkillImprovement.confirmedCases) {
        confirmedCases = JSON.parse(task.SkillImprovement.confirmedCases);
      }
    } catch {
      logger.warn(LOG_MODULES.SKILL, 'Failed to parse confirmedCases');
    }

    if (falsePositiveCases.length === 0 && confirmedCases.length === 0) {
      return NextResponse.json({ error: 'No cases available for backtest' }, { status: 400 });
    }

    logger.info(LOG_MODULES.SKILL, `Running backtest for task ${taskId}`);
    logger.info(LOG_MODULES.SKILL, `FP cases: ${falsePositiveCases.length}, CC cases: ${confirmedCases.length}`);

    const backtestResult = await runBacktest(
      task.SkillImprovement.improvedContent,
      falsePositiveCases,
      confirmedCases,
      { maxCases: Math.max(falsePositiveCases.length, confirmedCases.length, 10) }
    );

    await prisma.skillEvolutionTask.update({
      where: { id: taskId },
      data: {
        analysisResult: JSON.stringify({
          ...JSON.parse(task.analysisResult || '{}'),
          backtestResult: {
            summary: backtestResult.summary,
            isSuccessful: backtestResult.isSuccessful,
            recommendation: backtestResult.recommendation,
            runAt: new Date().toISOString(),
          },
        }),
      },
    });

    return NextResponse.json({
      success: true,
      backtestResult,
      detailRows: getBacktestDetailRows(backtestResult),
    });
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, 'Backtest error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Backtest failed' },
      { status: 500 }
    );
  }
}