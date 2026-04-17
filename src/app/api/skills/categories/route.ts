// src/app/api/skills/categories/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/skills/categories - 获取 Skills 分类列表（从 SystemConfig）
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

    // 从 SystemConfig 获取分类配置（唯一数据源）
    const categoriesConfig = await prisma.systemConfig.findUnique({
      where: { key: 'skill_categories' },
    });

    if (!categoriesConfig) {
      return NextResponse.json({ categories: [], pagination: { total: 0, page: 1, limit: 20, totalPages: 0 } });
    }

    let categories: Array<{ value: string; label: string }> = [];
    try {
      categories = JSON.parse(categoriesConfig.value);
    } catch {
      logger.warn(LOG_MODULES.SKILL, '解析分类配置失败');
      return NextResponse.json({ categories: [], pagination: { total: 0, page: 1, limit: 20, totalPages: 0 } });
    }

    // 获取每个分类的 Skill 数量
    const skillCounts = await prisma.skill.groupBy({
      by: ['category'],
      where: { isActive: true },
      _count: { id: true },
    });

    const countMap = new Map(skillCounts.map(s => [s.category, s._count.id]));

    const result = categories.map(c => ({
      name: c.value,
      label: c.label,
      count: countMap.get(c.value) || 0,
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
