import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { hasPermission } from '@/lib/auth';
import { logger, LOG_MODULES } from '@/lib/logger';
import { generateId } from '@/lib/id-generator';

// GET /api/mcp - 获取 MCP 服务器列表
export async function GET(request: Request) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.MCP_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const userIsAdmin = isAdmin(payload);

    // 构建查询条件
    let where: any = {};
    
    if (!userIsAdmin) {
      // 普通用户：只能查看自己的 + 共享的
      where.OR = [
        { userId: payload.userId },
        { isPublic: true },
      ];
    }

    const mcpServers = await prisma.mcpServerConfig.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // 格式化返回数据
    const formattedServers = mcpServers.map(server => ({
      id: server.id,
      name: server.name,
      type: server.type,
      command: server.command,
      args: server.args,
      url: server.url,
      env: server.env,
      tools: server.tools ? JSON.parse(server.tools) : null,
      isEnabled: server.isEnabled,
      autoStart: server.autoStart,
      isPublic: server.isPublic,
      projectId: server.projectId,
      userId: server.userId,
      lastTestedAt: server.lastTestedAt,
      createdAt: server.createdAt,
      updatedAt: server.updatedAt,
      isOwner: server.userId === payload.userId,
    }));

    logger.list(LOG_MODULES.MCP, payload, 'mcp', undefined, formattedServers.length);

    return NextResponse.json({ mcpServers: formattedServers });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MCP, '获取 MCP 服务器列表失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/mcp - 创建 MCP 服务器
export async function POST(request: Request) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.MCP_CREATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const body = await request.json();
    const { name, type, command, args, url, env, tools, isEnabled, autoStart, isPublic, projectId } = body;

    // 验证必填字段
    if (!name || !type) {
      return NextResponse.json({ error: '名称和类型是必填项' }, { status: 400 });
    }

    // 验证类型对应的必填字段
    if (type === 'stdio' && !command) {
      return NextResponse.json({ error: 'stdio 类型需要提供 command' }, { status: 400 });
    }
    if (type === 'sse' && !url) {
      return NextResponse.json({ error: 'sse 类型需要提供 url' }, { status: 400 });
    }

    // 创建 MCP 服务器配置
    const mcpServer = await prisma.mcpServerConfig.create({
      data: {
        id: generateId('mcp'),
        userId: payload.userId,
        projectId: projectId || null,
        name,
        type,
        command: command || null,
        args: args || null,
        url: url || null,
        env: env || null,
        tools: tools ? JSON.stringify(tools) : null,
        isEnabled: isEnabled ?? true,
        autoStart: autoStart ?? false,
        isPublic: isPublic ?? false,
        updatedAt: new Date(),
      },
    });

    logger.create(LOG_MODULES.MCP, payload, mcpServer.id, { name, type });

    return NextResponse.json({
      message: 'MCP 服务器创建成功',
      mcpServer: {
        id: mcpServer.id,
        name: mcpServer.name,
        type: mcpServer.type,
        isEnabled: mcpServer.isEnabled,
      },
    }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MCP, '创建 MCP 服务器失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}