import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { processEvolutionTask } from '@/services/skill-evolution/task-manager';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_EVOLUTION_MANAGE });
  if (!auth.success) {
    return authErrorResponse(auth);
  }

  try {
    const { taskId } = await params;

    logger.info(LOG_MODULES.SKILL_EVOLUTION, 'Trigger evolution task', { taskId });

    await processEvolutionTask(taskId);

    return NextResponse.json({ success: true, message: '进化任务已触发' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL_EVOLUTION, 'Trigger evolution task error', { 
      details: { error: String(error) } 
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '触发失败' },
      { status: 500 }
    );
  }
}