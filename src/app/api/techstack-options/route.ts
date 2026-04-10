// src/app/api/techstack-options/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { 
  ALL_TECHSTACK_OPTIONS, 
  TECHSTACK_BY_CATEGORY 
} from '@/lib/techstack-options';

/**
 * GET /api/techstack-options
 * 获取技术栈选项列表
 * 优先从数据库获取，如果数据库为空则返回默认值
 */
export async function GET() {
  try {
    // 尝试从数据库获取
    const dbOptions = await prisma.techStackOption.findMany({
      where: { isActive: true },
      orderBy: [
        { category: 'asc' },
        { sortOrder: 'asc' },
        { name: 'asc' },
      ],
    });

    // 如果数据库有数据，返回数据库数据
    if (dbOptions.length > 0) {
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
    }

    // 数据库为空，返回默认值
    return NextResponse.json({
      options: ALL_TECHSTACK_OPTIONS,
      categories: TECHSTACK_BY_CATEGORY,
      source: 'default',
    });
  } catch (error) {
    console.error('Get techstack options error:', error);
    // 出错时返回默认值
    return NextResponse.json({
      options: ALL_TECHSTACK_OPTIONS,
      categories: TECHSTACK_BY_CATEGORY,
      source: 'default',
    });
  }
}
