// src/app/api/autonomous-evolution/stats/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { getLastAutoExtract } from '@/services/autonomous-evolution/idle-trigger';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: '未授权' }, { status: 401 });
  const payload = verifyToken(authHeader.replace('Bearer ', ''));
  if (!payload) return NextResponse.json({ error: '无效的令牌' }, { status: 401 });

  const [total, injected, weekNew, avgSaved, lastAutoExtract] = await Promise.all([
    prisma.autonomousEvolutionExperience.count(),
    prisma.autonomousEvolutionExperience.count({ where: { isInjected: true } }),
    prisma.autonomousEvolutionExperience.count({
      where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    }),
    prisma.autonomousEvolutionExperience.aggregate({ _avg: { savedAttempts: true } }),
    getLastAutoExtract(),
  ]);

  return NextResponse.json({
    total,
    injected,
    weekNew,
    avgSavedAttempts: avgSaved._avg.savedAttempts ?? 0,
    lastAutoExtract,
  });
}
