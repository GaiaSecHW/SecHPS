// src/app/api/mcp-servers/[id]/route.ts
// 单个全局 MCP 服务器配置 API

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/mcp-servers/[id] - 获取单个全局 MCP 配置
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

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const { id } = await params;

    const mcpServer = await prisma.mcpServerConfig.findFirst({
      where: {
        id,
        userId: null,
        projectId: null,
      },
    });

    if (!mcpServer) {
      return NextResponse.json({ error: 'MCP 服务器配置不存在' }, { status: 404 });
    }

    return NextResponse.json({ mcpServer });
  } catch (error) {
    console.error('Get MCP server error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PATCH /api/mcp-servers/[id] - 更新全局 MCP 配置
export async function PATCH(
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

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    // 检查是否存在
    const existing = await prisma.mcpServerConfig.findFirst({
      where: {
        id,
        userId: null,
        projectId: null,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'MCP 服务器配置不存在' }, { status: 404 });
    }

    // 准备更新数据
    const updateData: any = {};

    if (body.name !== undefined) {
      // 检查名称是否与其他配置冲突
      const nameConflict = await prisma.mcpServerConfig.findFirst({
        where: {
          name: body.name,
          userId: null,
          projectId: null,
          id: { not: id },
        },
      });

      if (nameConflict) {
        return NextResponse.json(
          { error: 'MCP 服务器名称已存在' },
          { status: 400 }
        );
      }

      updateData.name = body.name;
    }

    if (body.type !== undefined) {
      if (!['local', 'remote'].includes(body.type)) {
        return NextResponse.json(
          { error: 'type 必须是 local 或 remote' },
          { status: 400 }
        );
      }
      updateData.type = body.type;
    }

    if (body.command !== undefined) updateData.command = body.command || null;
    if (body.args !== undefined) updateData.args = body.args ? JSON.stringify(body.args) : null;
    if (body.url !== undefined) updateData.url = body.url || null;
    if (body.env !== undefined) updateData.env = body.env ? JSON.stringify(body.env) : null;
    if (body.isEnabled !== undefined) updateData.isEnabled = body.isEnabled;
    if (body.autoStart !== undefined) updateData.autoStart = body.autoStart;

    // 更新
    const mcpServer = await prisma.mcpServerConfig.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ mcpServer });
  } catch (error) {
    console.error('Update MCP server error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/mcp-servers/[id] - 删除全局 MCP 配置
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

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_DELETE)) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const { id } = await params;

    // 检查是否存在
    const existing = await prisma.mcpServerConfig.findFirst({
      where: {
        id,
        userId: null,
        projectId: null,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'MCP 服务器配置不存在' }, { status: 404 });
    }

    // 删除
    await prisma.mcpServerConfig.delete({
      where: { id },
    });

    return NextResponse.json({ message: 'MCP 服务器配置已删除' });
  } catch (error) {
    console.error('Delete MCP server error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
