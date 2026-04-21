// src/app/api/autonomous-evolution/stats/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { getLastAutoExtract } from '@/services/autonomous-evolution/idle-trigger';

export async function GET(request: Request) {
  // 使用统一认证中间件
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AUTONOMOUS_EVOLUTION_READ });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  const [total, injected, weekNew, avgSaved, lastAutoExtract, totalUsage] = await Promise.all([
    prisma.autonomousEvolutionExperience.count(),
    prisma.autonomousEvolutionExperience.count({ where: { isInjected: true } }),
    prisma.autonomousEvolutionExperience.count({
      where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    }),
    prisma.autonomousEvolutionExperience.aggregate({ _avg: { savedAttempts: true } }),
    getLastAutoExtract(),
    prisma.experienceUsageLog.count(),
  ]);

  return NextResponse.json({
    total,
    injected,
    weekNew,
    avgSavedAttempts: avgSaved._avg.savedAttempts ?? 0,
    lastAutoExtract,
    totalUsage,
  });
}
