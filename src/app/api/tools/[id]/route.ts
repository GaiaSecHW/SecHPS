// src/app/api/tools/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/tools/:id - 获取工具详情
export async function GET(
  request: Request,
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

    const tool = await prisma.tool.findUnique({ where: { id } });

    if (!tool) {
      return NextResponse.json({ error: '工具不存在' }, { status: 404 });
    }

    return NextResponse.json({
      tool: {
        ...tool,
        parameters: JSON.parse(tool.parameters),
        executorConfig: tool.executorConfig ? JSON.parse(tool.executorConfig) : null,
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AGENT, '获取工具详情错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PUT /api/tools/:id - 更新工具
export async function PUT(
  request: Request,
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

    const tool = await prisma.tool.findUnique({ where: { id } });
    if (!tool) {
      return NextResponse.json({ error: '工具不存在' }, { status: 404 });
    }

    if (tool.isBuiltin && Object.keys(body).some(k => k !== 'isActive')) {
      return NextResponse.json(
        { error: '内置工具只能修改启用状态' },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (body.displayName !== undefined) updateData.displayName = body.displayName;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.category !== undefined) updateData.category = body.category;
    if (body.parameters !== undefined) updateData.parameters = JSON.stringify(body.parameters);
    if (body.executor !== undefined) updateData.executor = body.executor;
    if (body.executorConfig !== undefined) updateData.executorConfig = body.executorConfig ? JSON.stringify(body.executorConfig) : null;
    if (body.requiresPermission !== undefined) updateData.requiresPermission = body.requiresPermission;
    if (body.allowedInSandbox !== undefined) updateData.allowedInSandbox = body.allowedInSandbox;
    if (body.timeout !== undefined) updateData.timeout = body.timeout;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    const updated = await prisma.tool.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      tool: {
        ...updated,
        parameters: JSON.parse(updated.parameters),
        executorConfig: updated.executorConfig ? JSON.parse(updated.executorConfig) : null,
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AGENT, '更新工具错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/tools/:id - 删除工具
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 使用统一认证中间件
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_DELETE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    const tool = await prisma.tool.findUnique({ where: { id } });
    if (!tool) {
      return NextResponse.json({ error: '工具不存在' }, { status: 404 });
    }

    if (tool.isBuiltin) {
      return NextResponse.json(
        { error: '内置工具不能删除' },
        { status: 400 }
      );
    }

    await prisma.tool.delete({ where: { id } });

    return NextResponse.json({ message: '删除成功' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AGENT, '删除工具错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
