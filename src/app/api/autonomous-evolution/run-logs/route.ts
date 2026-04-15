// src/app/api/autonomous-evolution/run-logs/route.ts

import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: '未授权' }, { status: 401 });
  const payload = verifyToken(authHeader.replace('Bearer ', ''));
  if (!payload) return NextResponse.json({ error: '无效的令牌' }, { status: 401 });

  if (!hasPermission(payload.permissions, PERMISSIONS.AUTONOMOUS_EVOLUTION_READ)) {
    return NextResponse.json({ error: '禁止访问' }, { status: 403 });
  }

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
