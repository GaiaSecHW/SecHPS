// src/app/api/autonomous-evolution/batch-inject/route.ts
// POST 批量启用/停用

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: '未授权' }, { status: 401 });
  const payload = verifyToken(authHeader.replace('Bearer ', ''));
  if (!payload) return NextResponse.json({ error: '无效的令牌' }, { status: 401 });

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
