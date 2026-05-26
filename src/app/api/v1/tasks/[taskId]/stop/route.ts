import { NextRequest } from 'next/server';
import { authenticateApiKey, apiKeyAuthErrorResponse } from '@/lib/api-key-auth';
import type { ApiKeyAuthSuccess } from '@/lib/api-key-auth';
import { prisma } from '@/lib/prisma';
import { badRequest, notFound } from '@/lib/api-errors';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const auth = await authenticateApiKey(request);
  if (!auth.success) return apiKeyAuthErrorResponse(auth);
  const { apiKey } = auth as ApiKeyAuthSuccess;

  const { taskId } = await params;

  const task = await prisma.taskInstance.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      status: true,
      codeswarmTaskId: true,
      tenantId: true,
    },
  });

  if (!task) {
    return notFound('Task not found');
  }

  if (task.tenantId !== apiKey.tenantId) {
    return notFound('Task not found');
  }

  if (task.status !== 'running' && task.status !== 'pending') {
    return badRequest('Task is not running or pending');
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

  if (task.codeswarmTaskId) {
    try {
      await fetch(`${baseUrl}/api/codeswarm/tasks/${task.codeswarmTaskId}`, {
        method: 'DELETE',
      });
    } catch (deleteError) {
      logger.error(LOG_MODULES.CODE, 'Failed to delete CodeSwarm task', { details: { error: deleteError instanceof Error ? deleteError.message : String(deleteError) } });
    }
  }

  await prisma.taskInstance.update({
    where: { id: taskId },
    data: {
      status: 'failed',
      errorMessage: 'Stopped via external API',
      completedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return Response.json({
    taskId,
    status: 'failed',
    message: 'Task stopped',
  });
}
