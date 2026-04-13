// src/app/api/autonomous-evolution/route.ts
// GET 列表（支持筛选/分页）

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: '未授权' }, { status: 401 });
  const payload = verifyToken(authHeader.replace('Bearer ', ''));
  if (!payload) return NextResponse.json({ error: '无效的令牌' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = parseInt(searchParams.get('pageSize') || '20');
  const errorCategory = searchParams.get('errorCategory') || undefined;
  const isInjected = searchParams.get('isInjected');
  const sourceModel = searchParams.get('sourceModel') || undefined;
  const search = searchParams.get('search') || undefined;

  const where: Record<string, unknown> = {};
  if (errorCategory) where.errorCategory = errorCategory;
  if (isInjected !== null && isInjected !== '') where.isInjected = isInjected === 'true';
  if (sourceModel) where.sourceModel = sourceModel;
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { directSolution: { contains: search } },
      { errorPatterns: { contains: search } },
    ];
  }

  const [total, items] = await Promise.all([
    prisma.autonomousEvolutionExperience.count({ where }),
    prisma.autonomousEvolutionExperience.findMany({
      where,
      orderBy: { hitCount: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    data: items,
    pagination: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
  });
}
