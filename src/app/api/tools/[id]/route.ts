// src/app/api/tools/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/tools/:id - 获取工具详情
export async function GET(
  request: Request,
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
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

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
    console.error('获取工具详情错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PUT /api/tools/:id - 更新工具
export async function PUT(
  request: Request,
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
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

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
    console.error('更新工具错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/tools/:id - 删除工具
export async function DELETE(
  request: Request,
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
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_DELETE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

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
    console.error('删除工具错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
