// src/app/api/techstack-options/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';
import { 
  ALL_TECHSTACK_OPTIONS, 
  TECHSTACK_BY_CATEGORY 
} from '@/lib/techstack-options';

/**
 * GET /api/techstack-options
 * 获取技术栈选项列表
 * 优先从数据库获取，如果数据库为空则返回默认值
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

    // 尝试从数据库获取
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

    // 如果数据库有数据，返回数据库数据
    if (dbOptions.length > 0) {
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

      // 按类别分组（传统格式）
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
    }

    // 数据库为空，返回默认值
    // 如果请求带 ID 的格式，返回空数组（默认值没有 ID）
    if (withIds) {
      return NextResponse.json({
        options: [],
        categories: TECHSTACK_BY_CATEGORY,
        source: 'default',
        message: '数据库为空，请先添加技术栈选项',
      });
    }

    return NextResponse.json({
      options: categoryFilter 
        ? (TECHSTACK_BY_CATEGORY[categoryFilter as keyof typeof TECHSTACK_BY_CATEGORY] || [])
        : ALL_TECHSTACK_OPTIONS,
      categories: TECHSTACK_BY_CATEGORY,
      source: 'default',
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '获取技术栈选项失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    // 出错时返回默认值
    return NextResponse.json({
      options: ALL_TECHSTACK_OPTIONS,
      categories: TECHSTACK_BY_CATEGORY,
      source: 'default',
    });
  }
}
