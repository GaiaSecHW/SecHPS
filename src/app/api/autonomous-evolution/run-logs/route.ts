// src/app/api/autonomous-evolution/run-logs/route.ts

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  // 使用统一认证中间件
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AUTONOMOUS_EVOLUTION_READ });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = Math.min(parseInt(searchParams.get('pageSize') || '20'), 100);
  const skip = (page - 1) * pageSize;

  const [total, data] = await Promise.all([
    prisma.autonomousEvolutionRunLog.count(),
    prisma.autonomousEvolutionRunLog.findMany({
      orderBy: { startedAt: 'desc' },
      skip,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    data,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}
