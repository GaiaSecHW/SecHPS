// src/app/api/techstack-options/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * GET /api/techstack-options
 * 获取技术栈选项列表（仅从数据库获取）
 * 
 * Query params:
 * - category: 筛选特定类别（如 'language'）
 * - withIds: 返回包含 ID 的完整对象（用于单选下拉）
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const categoryFilter = searchParams.get('category');
    const withIds = searchParams.get('withIds') === 'true';

    // 从数据库获取
    const dbOptions = await prisma.techStackOption.findMany({
      where: { 
        isActive: true,
        ...(categoryFilter && { category: categoryFilter }),
      },
      orderBy: [
        { category: 'asc' },
        { sortOrder: 'asc' },
        { name: 'asc' },
      ],
    });

    // 如果请求带 ID 的完整对象
    if (withIds) {
      return NextResponse.json({
        options: dbOptions.map(opt => ({
          id: opt.id,
          name: opt.name,
          category: opt.category,
          description: opt.description,
        })),
        categories: categoryFilter ? undefined : Object.fromEntries(
          Object.entries(
            dbOptions.reduce((acc, opt) => {
              if (!acc[opt.category]) acc[opt.category] = [];
              acc[opt.category].push(opt.name);
              return acc;
            }, {} as Record<string, string[]>)
          )
        ),
        source: 'database',
      });
    }

    // 按类别分组
    const categories: Record<string, string[]> = {};
    const options: string[] = [];
    
    for (const opt of dbOptions) {
      options.push(opt.name);
      if (!categories[opt.category]) {
        categories[opt.category] = [];
      }
      categories[opt.category].push(opt.name);
    }

    return NextResponse.json({
      options,
      categories,
      source: 'database',
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '获取技术栈选项失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({
      options: [],
      categories: {},
      source: 'database',
      error: '获取技术栈选项失败',
    }, { status: 500 });
  }
}
