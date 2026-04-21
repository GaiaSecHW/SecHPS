// src/app/api/autonomous-evolution/[id]/inject/route.ts
// PATCH 切换注入状态

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';

export async function PATCH(
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
  const current = await prisma.autonomousEvolutionExperience.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: '未找到' }, { status: 404 });

  const newInjected = !current.isInjected;
  const updated = await prisma.autonomousEvolutionExperience.update({
    where: { id },
    data: {
      isInjected: newInjected,
      injectedAt: newInjected ? new Date() : null,
    },
  });
  return NextResponse.json(updated);
}
