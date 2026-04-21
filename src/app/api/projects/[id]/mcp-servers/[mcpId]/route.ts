import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/projects/:id/mcp-servers/:mcpId - 获取单个 MCP 服务器配置
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; mcpId: string }> }
) {
  try {
    const { id: projectId, mcpId } = await params;
    // 使用统一认证中间件
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    // 验证项目是否存在且属于用户
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId: payload.userId,
      },
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // 获取 MCP 服务器配置
    const mcpServer = await prisma.mcpServerConfig.findFirst({
      where: {
        id: mcpId,
        projectId,
      },
    });

    if (!mcpServer) {
      return NextResponse.json({ error: 'MCP server not found' }, { status: 404 });
    }

    return NextResponse.json({ mcpServer });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MCP, '获取 MCP 服务器错误:', { details: { error: String(error) } });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT /api/projects/:id/mcp-servers/:mcpId - 更新 MCP 服务器配置
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; mcpId: string }> }
) {
  try {
    const { id: projectId, mcpId } = await params;
    // 使用统一认证中间件
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    // 验证项目是否存在且属于用户
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId: payload.userId,
      },
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // 验证 MCP 服务器是否存在
    const existingServer = await prisma.mcpServerConfig.findFirst({
      where: {
        id: mcpId,
        projectId,
      },
    });

    if (!existingServer) {
      return NextResponse.json({ error: 'MCP server not found' }, { status: 404 });
    }

    const body = await request.json();
    const { name, type, command, args, url, env, isEnabled, autoStart } = body;

    // 更新 MCP 服务器配置
    const mcpServer = await prisma.mcpServerConfig.update({
      where: { id: mcpId },
      data: {
        name: name ?? existingServer.name,
        type: type ?? existingServer.type,
        command: command !== undefined ? command : existingServer.command,
        args: args !== undefined ? (args ? JSON.stringify(args) : null) : existingServer.args,
        url: url !== undefined ? url : existingServer.url,
        env: env !== undefined ? (env ? JSON.stringify(env) : null) : existingServer.env,
        isEnabled: isEnabled ?? existingServer.isEnabled,
        autoStart: autoStart ?? existingServer.autoStart,
      },
    });

    return NextResponse.json({ mcpServer });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MCP, '更新 MCP 服务器错误:', { details: { error: String(error) } });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/:id/mcp-servers/:mcpId - 删除 MCP 服务器配置
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; mcpId: string }> }
) {
  try {
    const { id: projectId, mcpId } = await params;
    // 使用统一认证中间件
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    // 验证项目是否存在且属于用户
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId: payload.userId,
      },
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // 验证 MCP 服务器是否存在
    const existingServer = await prisma.mcpServerConfig.findFirst({
      where: {
        id: mcpId,
        projectId,
      },
    });

    if (!existingServer) {
      return NextResponse.json({ error: 'MCP server not found' }, { status: 404 });
    }

    // 删除 MCP 服务器配置
    await prisma.mcpServerConfig.delete({
      where: { id: mcpId },
    });

    return NextResponse.json({ message: 'MCP server deleted successfully' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MCP, '删除 MCP 服务器错误:', { details: { error: String(error) } });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
