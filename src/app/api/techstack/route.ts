// src/app/api/techstack/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

/**
 * GET /api/techstack
 * 获取所有技术栈选项
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const isActive = searchParams.get('isActive');

    const where: any = {};
    if (category) where.category = category;
    if (isActive !== null) where.isActive = isActive === 'true';

    const options = await prisma.techStackOption.findMany({
      where,
      orderBy: [
        { category: 'asc' },
        { sortOrder: 'asc' },
        { name: 'asc' },
      ],
    });

    return NextResponse.json({ options });
  } catch (error) {
    console.error('Get techstack options error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * POST /api/techstack
 * 创建新的技术栈选项（需要管理员权限）
 */
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 检查管理员权限
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问 - 需要管理员权限' }, { status: 403 });
    }

    const body = await request.json();
    const { name, category, description, sortOrder } = body;

    if (!name || !category) {
      return NextResponse.json(
        { error: '缺少必填字段：名称和分类' },
        { status: 400 }
      );
    }

    // 检查名称是否已存在
    const existing = await prisma.techStackOption.findUnique({
      where: { name },
    });

    if (existing) {
      return NextResponse.json(
        { error: '技术栈名称已存在' },
        { status: 400 }
      );
    }

    const option = await prisma.techStackOption.create({
      data: {
        name,
        category,
        description: description || null,
        sortOrder: sortOrder || 0,
      },
    });

    return NextResponse.json({ option }, { status: 201 });
  } catch (error) {
    console.error('Create techstack option error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
