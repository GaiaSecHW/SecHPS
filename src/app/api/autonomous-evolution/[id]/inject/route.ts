// src/app/api/autonomous-evolution/[id]/inject/route.ts
// PATCH 切换注入状态

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: '未授权' }, { status: 401 });
  const payload = verifyToken(authHeader.replace('Bearer ', ''));
  if (!payload) return NextResponse.json({ error: '无效的令牌' }, { status: 401 });

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
