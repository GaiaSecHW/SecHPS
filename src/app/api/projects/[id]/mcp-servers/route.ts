import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { generateId } from '@/lib/id-generator';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/projects/:id/mcp-servers - 获取项目的 MCP 服务器列表
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
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

    // 获取项目的 MCP 服务器配置
    const mcpServers = await prisma.mcpServerConfig.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ mcpServers });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MCP, '获取 MCP 服务器列表错误:', { details: { error: String(error) } });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/projects/:id/mcp-servers - 创建 MCP 服务器配置
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
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

    const body = await request.json();
    const { name, type, command, args, url, env, isEnabled, autoStart } = body;

    if (!name || !type) {
      return NextResponse.json(
        { error: 'Name and type are required' },
        { status: 400 }
      );
    }

    if (!['local', 'sse', 'http'].includes(type)) {
      return NextResponse.json(
        { error: 'Type must be "local", "sse", or "http"' },
        { status: 400 }
      );
    }

    if (type === 'local' && !command) {
      return NextResponse.json(
        { error: 'Command is required for local MCP servers' },
        { status: 400 }
      );
    }

    if ((type === 'sse' || type === 'http') && !url) {
      return NextResponse.json(
        { error: 'URL is required for sse/http MCP servers' },
        { status: 400 }
      );
    }

    // 创建 MCP 服务器配置（绑定到项目所属用户）
    const mcpServer = await prisma.mcpServerConfig.create({
      data: {
        id: generateId('mcp'),
        projectId,
        userId: payload.userId,  // 绑定到创建者
        name,
        type,
        command: command || null,
        args: args ? JSON.stringify(args) : null,
        url: url || null,
        env: env ? JSON.stringify(env) : null,
        isEnabled: isEnabled ?? true,
        autoStart: autoStart ?? false,
        isShared: false,  // 项目级 MCP 不共享
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ mcpServer }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MCP, '创建 MCP 服务器错误:', { details: { error: String(error) } });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
