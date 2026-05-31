import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { getOrgRepoBranches } from '@/lib/gitea-org-repo';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  const auth = authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id } = await context.params;

  const app = await prisma.agentApp.findUnique({
    where: { id },
    select: { agentHarnessPath: true, tenantId: true, userId: true, isPublic: true },
  });

  if (!app) {
    return NextResponse.json({ error: 'AgentApp 不存在' }, { status: 404 });
  }

  if (!app.isPublic && app.userId !== auth.payload.userId && !auth.payload.roles?.includes('admin')) {
    return NextResponse.json({ error: '无权访问' }, { status: 403 });
  }

  if (!app.agentHarnessPath) {
    return NextResponse.json({ branches: [] });
  }

  const branches = await getOrgRepoBranches(app.agentHarnessPath);
  return NextResponse.json({ branches });
}
