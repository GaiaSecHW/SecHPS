// src/app/api/skills/categories/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { buildTenantFilter } from '@/lib/tenant-filter';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/skills/categories - 获取 SkillCategory 列表
export async function GET(request: Request) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload, tenant } = auth as AuthSuccessResult;

  try {
    const tenantFilter = buildTenantFilter(tenant, {
      tenantField: 'tenantId',
      isPublicField: 'isPublic',
      userRoles: payload.roles,
    });
    const hasFullAccess = Object.keys(tenantFilter).length === 0;

    const skillWhere: Record<string, unknown> = { isLatest: true };

    // 分类计数需应用与 Skills 列表相同的可见性逻辑
    // 注意：Prisma OR 中 {}（空对象）无效，管理员级权限不加 OR
    if (!hasFullAccess) {
      skillWhere.OR = [
        { userId: payload.userId },
        { userId: null },
        { ...tenantFilter },
      ];
    }

    const categories = await prisma.skillCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: { select: { Skill: { where: skillWhere } } },
      },
    });

    const result = categories.map(c => ({
      id: c.id,
      name: c.name,
      displayName: c.displayName,
      description: c.description,
      icon: c.icon,
      hasSubDimension: c.hasSubDimension,
      count: c._count.Skill,
    }));

    return NextResponse.json({ categories: result });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取 Skills 分类错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
