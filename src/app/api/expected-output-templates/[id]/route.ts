import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
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
    // 使用统一认证中间件
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

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
    // 使用统一认证中间件
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_UPDATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

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
    // 使用统一认证中间件
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_UPDATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

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
