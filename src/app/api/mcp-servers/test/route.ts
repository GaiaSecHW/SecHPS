// src/app/api/mcp-servers/test/route.ts
// MCP 服务器测试 API - 验证连通性并获取工具列表，成功后保存到数据库

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { listMcpToolsDirect } from '@/lib/mcp-client';
import { prisma } from '@/lib/prisma';

// POST /api/mcp-servers/test - 测试 MCP 服务器连接并获取工具列表
export async function POST(request: Request) {
  // 使用统一认证中间件（需要 CONFIG_READ 权限）
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_READ });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload } = auth;

  try {
    const body = await request.json();
    const { id, type, command, args, url, env, name } = body;

    logger.access(LOG_MODULES.MCP, payload, 'mcp:test', { id, type, command, url, name });

    // 验证必填字段
    if (!name) {
      return NextResponse.json({ error: '服务器名称必填' }, { status: 400 });
    }

    if (type === 'remote' && !url) {
      return NextResponse.json({ error: '远程服务器必须提供 URL' }, { status: 400 });
    }

    if (type === 'local' && !command) {
      return NextResponse.json({ error: '本地服务器必须提供命令' }, { status: 400 });
    }

    // 构建 MCP 配置
    const mcpConfig = {
      name: name || 'test-server',
      type: type as 'local' | 'remote',
      command: command ?? undefined,
      args: args ? (typeof args === 'string' ? JSON.parse(args) : args) : undefined,
      url: url ?? undefined,
      env: env ? (typeof env === 'string' ? JSON.parse(env) : env) : undefined,
      timeout: 60000, // 测试连接 60 秒超时
    };

    logger.info(LOG_MODULES.MCP, '开始测试 MCP 连接', {
      serverId: id,
      serverName: mcpConfig.name,
      serverType: mcpConfig.type,
      hasCommand: !!mcpConfig.command,
      hasUrl: !!mcpConfig.url,
    });

    // 获取工具列表（同时验证连接）
    const result = await listMcpToolsDirect(mcpConfig);

    if (result.success) {
      const tools = result.tools.map(tool => ({
        name: tool.name,
        description: tool.description || '无描述',
        inputSchema: tool.inputSchema || {},
      }));

      logger.info(LOG_MODULES.MCP, 'MCP 测试成功', {
        serverId: id,
        serverName: mcpConfig.name,
        toolCount: tools.length,
        tools: tools.map(t => t.name),
      });

      // 如果有服务器 ID，保存工具列表到数据库
      if (id) {
        try {
          await prisma.mcpServerConfig.update({
            where: { id },
            data: {
              tools: JSON.stringify(tools),
              lastTestedAt: new Date(),
              updatedAt: new Date(),
            },
          });
          logger.info(LOG_MODULES.MCP, 'MCP 工具列表已保存到数据库', {
            serverId: id,
            toolCount: tools.length,
          });
        } catch (dbError) {
          logger.warn(LOG_MODULES.MCP, 'MCP 工具列表保存失败', {
            serverId: id,
            error: dbError instanceof Error ? dbError.message : String(dbError),
          });
          // 不阻塞流程，继续返回结果
        }
      }

      return NextResponse.json({
        success: true,
        connected: true,
        message: `成功连接到 MCP 服务器，发现 ${tools.length} 个工具`,
        server: {
          id,
          name: mcpConfig.name,
          type: mcpConfig.type,
          url: mcpConfig.url,
          command: mcpConfig.command,
        },
        tools,
        toolCount: tools.length,
        saved: !!id,  // 是否已保存到数据库
      });
    } else {
      logger.warn(LOG_MODULES.MCP, 'MCP 测试失败', {
        serverId: id,
        serverName: mcpConfig.name,
        error: result.error,
      });

      return NextResponse.json({
        success: false,
        connected: false,
        error: result.error || '连接失败',
        server: {
          id,
          name: mcpConfig.name,
          type: mcpConfig.type,
        },
        tools: [],
      });
    }
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MCP, 'MCP 测试异常', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { 
        error: '测试失败', 
        details: error instanceof Error ? error.message : '未知错误',
        success: false,
        connected: false,
        tools: [],
      },
      { status: 500 }
    );
  }
}
