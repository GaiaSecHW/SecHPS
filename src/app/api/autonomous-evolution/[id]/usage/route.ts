// src/app/api/autonomous-evolution/[id]/usage/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 使用统一认证中间件
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  const { id } = await params;

  const [total, logs] = await Promise.all([
    prisma.experienceUsageLog.count({ where: { experienceId: id } }),
    prisma.experienceUsageLog.findMany({
      where: { experienceId: id },
      orderBy: { usedAt: 'desc' },
      take: 20,
    }),
  ]);

  // 补充项目名称
  const projectIds = [...new Set(logs.map(l => l.projectId).filter(Boolean))] as string[];
  const projects = projectIds.length > 0
    ? await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } })
    : [];
  const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]));

  return NextResponse.json({
    total,
    logs: logs.map(l => ({
      id: l.id,
      evaluationId: l.evaluationId,
      projectId: l.projectId,
      projectName: l.projectId ? (projectMap[l.projectId] || l.projectId) : null,
      usedAt: l.usedAt,
      // 跳转链接需要 projectId + evaluationId
      sessionUrl: l.projectId ? `/dashboard/sessions/${l.projectId}?evaluationId=${l.evaluationId}` : null,
    })),
  });
}
