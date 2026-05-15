import { NextRequest } from 'next/server';
import { authenticateApiKey, apiKeyAuthErrorResponse } from '@/lib/api-key-auth';
import type { ApiKeyAuthSuccess } from '@/lib/api-key-auth';
import { prisma } from '@/lib/prisma';
import { notFound } from '@/lib/api-errors';

export async function GET(
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
      startedAt: true,
      completedAt: true,
      errorMessage: true,
      inputTokens: true,
      outputTokens: true,
      totalTokens: true,
      tenantId: true,
    },
  });

  if (!task) {
    return notFound('Task not found');
  }

  if (task.tenantId !== apiKey.tenantId) {
    return notFound('Task not found');
  }

  return Response.json({
    taskId: task.id,
    status: task.status,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    errorMessage: task.errorMessage,
    inputTokens: task.inputTokens,
    outputTokens: task.outputTokens,
    totalTokens: task.totalTokens,
  });
}
