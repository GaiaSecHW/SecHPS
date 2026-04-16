import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * GET /api/expected-output-templates
 * 获取所有期望输出模板
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的 token' } }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');

    const where: any = { isActive: true };
    if (category) {
      where.category = category;
    }

    const templates = await prisma.expectedOutputTemplate.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return NextResponse.json({ templates });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '获取期望输出模板失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}

/**
 * POST /api/expected-output-templates
 * 创建新的期望输出模板（需要管理员权限）
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的 token' } }, { status: 401 });
    }

    // 检查权限 - 只有管理员可以创建模板
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ details: { error: '禁止访问' } }, { status: 403 });
    }

    const body = await request.json();
    const { name, displayName, description, category, template, example, sortOrder } = body;

    if (!name || !displayName || !template) {
      return NextResponse.json({ details: { error: '缺少必要字段' } }, { status: 400 });
    }

    // 检查名称是否已存在
    const existing = await prisma.expectedOutputTemplate.findUnique({
      where: { name },
    });

    if (existing) {
      return NextResponse.json({ details: { error: '模板名称已存在' } }, { status: 400 });
    }

    const newTemplate = await prisma.expectedOutputTemplate.create({
      data: {
        name,
        displayName,
        description: description || '',
        category: category || 'general',
        template,
        example,
        sortOrder: sortOrder || 0,
      },
    });

    logger.create(LOG_MODULES.CONFIG, payload, `template:${newTemplate.id}`, { name, displayName });
    return NextResponse.json({ template: newTemplate }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '创建期望输出模板失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
