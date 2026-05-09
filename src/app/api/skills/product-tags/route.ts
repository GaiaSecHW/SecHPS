// src/app/api/skills/product-tags/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/skills/product-tags - 获取产品标签列表
export async function GET(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }

  try {
    const tags = await prisma.productTag.findMany({
      where: { isActive: true },
      orderBy: { displayName: 'asc' },
      include: {
        _count: { select: { SkillProductTag: true } },
      },
    });

    const result = tags.map(t => ({
      id: t.id,
      name: t.name,
      displayName: t.displayName,
      description: t.description,
      skillCount: t._count.SkillProductTag,
    }));

    return NextResponse.json({ productTags: result });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取产品标签错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
