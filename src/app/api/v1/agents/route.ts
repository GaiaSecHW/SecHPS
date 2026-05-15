import { NextRequest } from 'next/server';
import { authenticateApiKey, apiKeyAuthErrorResponse } from '@/lib/api-key-auth';
import type { ApiKeyAuthSuccess } from '@/lib/api-key-auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if (!auth.success) return apiKeyAuthErrorResponse(auth);
  const { apiKey } = auth as ApiKeyAuthSuccess;

  const agents = await prisma.agentApp.findMany({
    where: { id: { in: apiKey.allowedAgentIds } },
    select: { id: true, name: true, engine: true, notes: true },
  });

  return Response.json({
    agents: agents.map(a => ({ ...a, description: a.notes }))
  });
}
