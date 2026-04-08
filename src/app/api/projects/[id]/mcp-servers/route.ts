import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/projects/:id/mcp-servers - 获取项目的 MCP 服务器列表
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const authHeader = request.headers.get('authorization');

    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

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
    console.error('Get MCP servers error:', error);
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
    const authHeader = request.headers.get('authorization');

    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

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

    if (type !== 'local' && type !== 'remote') {
      return NextResponse.json(
        { error: 'Type must be "local" or "remote"' },
        { status: 400 }
      );
    }

    // 验证本地服务器必须提供 command
    if (type === 'local' && !command) {
      return NextResponse.json(
        { error: 'Command is required for local MCP servers' },
        { status: 400 }
      );
    }

    // 验证远程服务器必须提供 url
    if (type === 'remote' && !url) {
      return NextResponse.json(
        { error: 'URL is required for remote MCP servers' },
        { status: 400 }
      );
    }

    // 创建 MCP 服务器配置
    const mcpServer = await prisma.mcpServerConfig.create({
      data: {
        projectId,
        name,
        type,
        command: command || null,
        args: args ? JSON.stringify(args) : null,
        url: url || null,
        env: env ? JSON.stringify(env) : null,
        isEnabled: isEnabled ?? true,
        autoStart: autoStart ?? false,
      },
    });

    return NextResponse.json({ mcpServer }, { status: 201 });
  } catch (error) {
    console.error('Create MCP server error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
