// src/app/api/skills/categories/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/skills/categories - 获取 Skills 分类列表（从 VulnerabilityCategory 表）
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的令牌' } }, { status: 401 });
    }

    // 从 VulnerabilityCategory 表获取分类列表
    const categories = await prisma.vulnerabilityCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, value: true, label: true },
    });

    // 获取每个分类的 Skill 数量（通过 VulnerabilityPattern.categoryId 关联）
    const skillCounts = await prisma.skill.groupBy({
      by: ['vulnerabilityPatternId'],
      where: { isLatest: true, vulnerabilityPatternId: { not: null } },
      _count: { id: true },
    });

    // 获取所有相关 VulnerabilityPattern 的 categoryId
    const patternIds = skillCounts.map(s => s.vulnerabilityPatternId).filter(Boolean) as string[];
    const patterns = await prisma.vulnerabilityPattern.findMany({
      where: { id: { in: patternIds } },
      select: { id: true, categoryId: true },
    });
    const patternCategoryMap = new Map(patterns.map(p => [p.id, p.categoryId]));

    // 按 categoryId 汇总 Skill 数量
    const countMap = new Map<string, number>();
    for (const s of skillCounts) {
      const catId = patternCategoryMap.get(s.vulnerabilityPatternId!);
      if (catId) {
        countMap.set(catId, (countMap.get(catId) || 0) + s._count.id);
      }
    }

    const result = categories.map(c => ({
      name: c.value,
      label: c.label,
      count: countMap.get(c.id) || 0,
    }));

    return NextResponse.json({
      categories: result,
      pagination: {
        total: result.length,
        page: 1,
        limit: result.length,
        totalPages: 1,
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取 Skills 分类错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
