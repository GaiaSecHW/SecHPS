// src/app/api/mcp-servers/[id]/route.ts
// 单个 MCP 服务器配置 API（支持所有权检查）

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// 检查用户是否有权限操作此 MCP
// - 管理员：可以操作所有 MCP
// - 普通用户：只能操作自己的 MCP（isShared=false 的只能查看）
function canManageMcp(userId: string, isAdmin: boolean, mcp: { userId: string; isShared: boolean }): boolean {
  if (isAdmin) return true;
  return mcp.userId === userId;
}

function canViewMcp(userId: string, isAdmin: boolean, mcp: { userId: string; isShared: boolean }): boolean {
  if (isAdmin) return true;
  if (mcp.userId === userId) return true;
  if (mcp.isShared) return true;
  return false;
}

// GET /api/mcp-servers/[id] - 获取单个 MCP 配置
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

    const isAdmin = payload.roles?.includes('admin');
    const { id } = await params;

    const mcpServer = await prisma.mcpServerConfig.findFirst({
      where: {
        id,
        projectId: null,
      },
      include: {
        User: {
          select: { id: true, username: true, name: true },
        },
      },
    });

    if (!mcpServer) {
      return NextResponse.json({ error: 'MCP 服务器配置不存在' }, { status: 404 });
    }

    // 检查查看权限
    if (!canViewMcp(payload.userId, isAdmin, mcpServer)) {
      return NextResponse.json({ error: '无权限访问此 MCP' }, { status: 403 });
    }

    logger.access(LOG_MODULES.MCP, payload, `mcp:${mcpServer.id}`, { name: mcpServer.name });
    return NextResponse.json({ mcpServer });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MCP, '获取 MCP 服务器详情失败', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PATCH /api/mcp-servers/[id] - 更新 MCP 配置
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

    const isAdmin = payload.roles?.includes('admin');
    const { id } = await params;
    const body = await request.json();

    // 检查是否存在
    const existing = await prisma.mcpServerConfig.findFirst({
      where: {
        id,
        projectId: null,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'MCP 服务器配置不存在' }, { status: 404 });
    }

    // 检查管理权限
    if (!canManageMcp(payload.userId, isAdmin, existing)) {
      return NextResponse.json({ error: '无权限修改此 MCP' }, { status: 403 });
    }

    // 非管理员不能修改 isShared
    if (body.isShared !== undefined && !isAdmin) {
      return NextResponse.json({ error: '只有管理员可以设置共享状态' }, { status: 403 });
    }

    // 准备更新数据
    const updateData: any = {};

    if (body.name !== undefined) {
      // 检查名称是否与其他配置冲突（同用户范围内）
      const nameConflict = await prisma.mcpServerConfig.findFirst({
        where: {
          name: body.name,
          userId: existing.userId,
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
    if (body.isShared !== undefined && isAdmin) updateData.isShared = body.isShared;

    // 更新
    const mcpServer = await prisma.mcpServerConfig.update({
      where: { id },
      data: updateData,
    });

    logger.update(LOG_MODULES.MCP, payload, `mcp:${mcpServer.id}`, { name: mcpServer.name });
    return NextResponse.json({ mcpServer });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MCP, '更新 MCP 服务器配置失败', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/mcp-servers/[id] - 删除 MCP 配置
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

    const isAdmin = payload.roles?.includes('admin');
    const { id } = await params;

    // 检查是否存在
    const existing = await prisma.mcpServerConfig.findFirst({
      where: {
        id,
        projectId: null,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'MCP 服务器配置不存在' }, { status: 404 });
    }

    // 检查删除权限
    if (!canManageMcp(payload.userId, isAdmin, existing)) {
      return NextResponse.json({ error: '无权限删除此 MCP' }, { status: 403 });
    }

    // 删除
    await prisma.mcpServerConfig.delete({
      where: { id },
    });

    logger.delete(LOG_MODULES.MCP, payload, `mcp:${id}`, { name: existing.name });
    return NextResponse.json({ message: 'MCP 服务器配置已删除' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MCP, '删除 MCP 服务器配置失败', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}