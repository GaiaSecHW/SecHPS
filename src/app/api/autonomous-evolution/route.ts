// src/app/api/autonomous-evolution/route.ts
// GET 列表（支持筛选/分页）
// 数据隔离：普通用户只能查看自己的进化经验，管理员可以查看所有

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';

export async function GET(request: Request) {
  // 使用统一认证中间件
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AUTONOMOUS_EVOLUTION_READ });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  // 检查是否是管理员
  const userIsAdmin = isAdmin(payload);

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = parseInt(searchParams.get('pageSize') || '20');
  const errorCategory = searchParams.get('errorCategory') || undefined;
  const isInjected = searchParams.get('isInjected');
  const sourceModel = searchParams.get('sourceModel') || undefined;
  const search = searchParams.get('search') || undefined;

  const where: Record<string, unknown> = {};
  
  // 数据隔离：普通用户只能查看自己的进化经验
  if (!userIsAdmin) {
    where.userId = payload.userId;
  }
  
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