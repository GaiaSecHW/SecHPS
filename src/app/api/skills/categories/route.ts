// src/app/api/skills/categories/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/skills/categories - 获取 SkillCategory 列表
export async function GET(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }

  try {
    const categories = await prisma.skillCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: { select: { Skill: { where: { isLatest: true } } } },
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
