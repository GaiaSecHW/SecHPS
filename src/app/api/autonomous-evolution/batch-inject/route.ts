// src/app/api/autonomous-evolution/batch-inject/route.ts
// POST 批量启用/停用

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';

export async function POST(request: Request) {
  // 使用统一认证中间件
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AUTONOMOUS_EVOLUTION_INJECT });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  const body = await request.json() as { ids: string[]; action: 'enable' | 'disable' };
  const { ids, action } = body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: '请提供 ids 数组' }, { status: 400 });
  }

  const isInjected = action === 'enable';
  await prisma.autonomousEvolutionExperience.updateMany({
    where: { id: { in: ids } },
    data: {
      isInjected,
      injectedAt: isInjected ? new Date() : null,
    },
  });

  return NextResponse.json({ updated: ids.length });
}
