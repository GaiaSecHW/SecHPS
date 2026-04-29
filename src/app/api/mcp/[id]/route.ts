import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { generateId } from '@/lib/id-generator';

// GET /api/mcp/[id] - 获取单个 MCP 服务器详情
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.MCP_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;
    const userIsAdmin = isAdmin(payload);

    const mcpServer = await prisma.mcpServerConfig.findUnique({
      where: { id },
    });

    if (!mcpServer) {
      return NextResponse.json({ error: 'MCP 服务器不存在' }, { status: 404 });
    }

    // 检查权限：只能查看自己的或共享的，管理员可查看所有
    if (!userIsAdmin && mcpServer.userId !== payload.userId && !mcpServer.isShared) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    logger.read(LOG_MODULES.MCP, payload, 'mcp', id, { name: mcpServer.name });

    return NextResponse.json({
      mcpServer: {
        id: mcpServer.id,
        name: mcpServer.name,
        type: mcpServer.type,
        command: mcpServer.command,
        args: mcpServer.args,
        url: mcpServer.url,
        env: mcpServer.env,
        tools: mcpServer.tools ? JSON.parse(mcpServer.tools) : null,
        isEnabled: mcpServer.isEnabled,
        autoStart: mcpServer.autoStart,
        isShared: mcpServer.isShared,
        projectId: mcpServer.projectId,
        userId: mcpServer.userId,
        lastTestedAt: mcpServer.lastTestedAt,
        createdAt: mcpServer.createdAt,
        updatedAt: mcpServer.updatedAt,
        isOwner: mcpServer.userId === payload.userId,
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MCP, '获取 MCP 服务器详情失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PATCH /api/mcp/[id] - 更新 MCP 服务器
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.MCP_UPDATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;
    const userIsAdmin = isAdmin(payload);

    const existingServer = await prisma.mcpServerConfig.findUnique({
      where: { id },
    });

    if (!existingServer) {
      return NextResponse.json({ error: 'MCP 服务器不存在' }, { status: 404 });
    }

    // 检查权限：只能更新自己的，管理员可更新所有
    if (!userIsAdmin && existingServer.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问：只能更新自己的 MCP 服务器' }, { status: 403 });
    }

    const body = await request.json();
    const { name, type, command, args, url, env, tools, isEnabled, autoStart, isShared, projectId } = body;

    // 构建更新数据
    const updateData: any = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name;
    if (type !== undefined) updateData.type = type;
    if (command !== undefined) updateData.command = command;
    if (args !== undefined) updateData.args = args;
    if (url !== undefined) updateData.url = url;
    if (env !== undefined) updateData.env = env;
    if (tools !== undefined) updateData.tools = tools ? JSON.stringify(tools) : null;
    if (isEnabled !== undefined) updateData.isEnabled = isEnabled;
    if (autoStart !== undefined) updateData.autoStart = autoStart;
    if (isShared !== undefined) updateData.isShared = isShared;
    if (projectId !== undefined) updateData.projectId = projectId;

    const mcpServer = await prisma.mcpServerConfig.update({
      where: { id },
      data: updateData,
    });

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        id: generateId('audit'),
        userId: payload.userId,
        action: 'mcp_update',
        resource: id,
        details: JSON.stringify({ name: mcpServer.name }),
      },
    });

    logger.update(LOG_MODULES.MCP, payload, id, { name: mcpServer.name });

    return NextResponse.json({
      message: 'MCP 服务器更新成功',
      mcpServer: {
        id: mcpServer.id,
        name: mcpServer.name,
        type: mcpServer.type,
        isEnabled: mcpServer.isEnabled,
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MCP, '更新 MCP 服务器失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/mcp/[id] - 删除 MCP 服务器
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.MCP_DELETE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;
    const userIsAdmin = isAdmin(payload);

    const existingServer = await prisma.mcpServerConfig.findUnique({
      where: { id },
    });

    if (!existingServer) {
      return NextResponse.json({ error: 'MCP 服务器不存在' }, { status: 404 });
    }

    // 检查权限：只能删除自己的，管理员可删除所有
    if (!userIsAdmin && existingServer.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问：只能删除自己的 MCP 服务器' }, { status: 403 });
    }

    await prisma.mcpServerConfig.delete({
      where: { id },
    });

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        id: generateId('audit'),
        userId: payload.userId,
        action: 'mcp_delete',
        resource: id,
        details: JSON.stringify({ name: existingServer.name }),
      },
    });

    logger.delete(LOG_MODULES.MCP, payload, id, { name: existingServer.name });

    return NextResponse.json({ message: 'MCP 服务器删除成功' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MCP, '删除 MCP 服务器失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}