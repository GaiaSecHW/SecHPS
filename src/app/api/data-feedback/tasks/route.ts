import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);
  const { payload, tenant } = auth as AuthSuccessResult;

  const { searchParams } = request.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(50, parseInt(searchParams.get('limit') || '20', 10));
  const skip = (page - 1) * limit;

  const where: any = {};
  if (!tenant.isPlatformAdmin && !(tenant.isIcsTenant && payload.roles?.includes('admin'))) {
    where.userId = payload.userId;
  }

  try {
    const [instances, total] = await Promise.all([
      prisma.taskInstance.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          agentName: true,
          modelName: true,
          status: true,
          targetProduct: true,
          codeswarmTaskId: true,
          startedAt: true,
          completedAt: true,
          createdAt: true,
          errorMessage: true,
        },
      }),
      prisma.taskInstance.count({ where }),
    ]);

    const csTaskIds = instances.map(t => t.codeswarmTaskId).filter(Boolean) as string[];
    const csTasks = csTaskIds.length > 0
      ? await prisma.$queryRaw`
          SELECT "taskId", state, engine, model, "sessionId"
          FROM "CodeswarmTask"
          WHERE "taskId" = ANY(${csTaskIds})
        ` as any[]
      : [];
    const csMap = new Map(csTasks.map((t: any) => [t.taskId, t]));

    const tasks = instances.map(t => ({
      ...t,
      csState: t.codeswarmTaskId ? csMap.get(t.codeswarmTaskId)?.state ?? null : null,
      engine: t.codeswarmTaskId ? csMap.get(t.codeswarmTaskId)?.engine ?? null : null,
      sessionId: t.codeswarmTaskId ? csMap.get(t.codeswarmTaskId)?.sessionId ?? null : null,
    }));

    return NextResponse.json({ tasks, total, page, limit });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
