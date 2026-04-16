import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * GET /api/expected-output-templates/[id]
 * 获取单个期望输出模板
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的 token' }, { status: 401 });
    }

    const { id } = await params;

    const template = await prisma.expectedOutputTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      return NextResponse.json({ error: '模板不存在' }, { status: 404 });
    }

    return NextResponse.json({ template });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '获取期望输出模板失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * PUT /api/expected-output-templates/[id]
 * 更新期望输出模板（需要管理员权限）
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的 token' }, { status: 401 });
    }

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { displayName, description, category, template, example, sortOrder, isActive } = body;

    const updated = await prisma.expectedOutputTemplate.update({
      where: { id },
      data: {
        displayName,
        description,
        category,
        template,
        example,
        sortOrder,
        isActive,
      },
    });

    logger.update(LOG_MODULES.CONFIG, payload, `template:${id}`, { displayName });
    return NextResponse.json({ template: updated });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '更新期望输出模板失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * DELETE /api/expected-output-templates/[id]
 * 删除期望输出模板（需要管理员权限）
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的 token' }, { status: 401 });
    }

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;

    // 检查是否为内置模板
    const template = await prisma.expectedOutputTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      return NextResponse.json({ error: '模板不存在' }, { status: 404 });
    }

    if (template.isBuiltin) {
      return NextResponse.json({ error: '内置模板不能删除' }, { status: 400 });
    }

    await prisma.expectedOutputTemplate.delete({
      where: { id },
    });

    logger.delete(LOG_MODULES.CONFIG, payload, `template:${id}`, { name: template.name });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '删除期望输出模板失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
