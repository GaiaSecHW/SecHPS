// src/app/api/techstack/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { generateId } from '@/lib/id-generator';

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
    logger.errorNoUser(LOG_MODULES.CONFIG, '获取技术栈选项失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}

/**
 * POST /api/techstack
 * 创建新的技术栈选项（需要管理员权限）
 */
export async function POST(request: Request) {
  // 使用统一认证中间件
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_UPDATE });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    const body = await request.json();
    const { name, category, description, sortOrder } = body;

    if (!name || !category) {
      return NextResponse.json(
        { details: { error: '缺少必填字段：名称和分类' } },
        { status: 400 }
      );
    }

    // 检查名称是否已存在
    const existing = await prisma.techStackOption.findUnique({
      where: { name },
    });

    if (existing) {
      return NextResponse.json(
        { details: { error: '技术栈名称已存在' } },
        { status: 400 }
      );
    }

    const option = await prisma.techStackOption.create({
      data: {
        id: generateId('techstack'),
        name,
        category,
        description: description || null,
        sortOrder: sortOrder || 0,
        updatedAt: new Date(),
      },
    });

    logger.create(LOG_MODULES.CONFIG, payload, `techstack:${option.id}`, { name, category });

    return NextResponse.json({ option }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '创建技术栈选项失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
