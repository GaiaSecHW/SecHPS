// src/app/api/mcp-servers/route.ts
// 全局 MCP 服务器配置 API

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/mcp-servers - 获取全局 MCP 服务器配置列表
export async function GET(request: Request) {
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

    // 获取全局 MCP 配置（userId 和 projectId 都为 null）
    const mcpServers = await prisma.mcpServerConfig.findMany({
      where: {
        userId: null,
        projectId: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ mcpServers });
  } catch (error) {
    console.error('Get MCP servers error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/mcp-servers - 创建全局 MCP 服务器配置
export async function POST(request: Request) {
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

    const body = await request.json();
    const {
      name,
      type,
      command,
      args,
      url,
      env,
      isEnabled = true,
      autoStart = false,
    } = body;

    // 验证必填字段
    if (!name || !type) {
      return NextResponse.json(
        { error: '缺少必填字段：name 和 type' },
        { status: 400 }
      );
    }

    // 验证类型
    if (!['local', 'remote'].includes(type)) {
      return NextResponse.json(
        { error: 'type 必须是 local 或 remote' },
        { status: 400 }
      );
    }

    // 验证配置完整性
    if (type === 'local' && !command) {
      return NextResponse.json(
        { error: 'local 类型必须提供 command' },
        { status: 400 }
      );
    }

    if (type === 'remote' && !url) {
      return NextResponse.json(
        { error: 'remote 类型必须提供 url' },
        { status: 400 }
      );
    }

    // 检查名称是否已存在
    const existing = await prisma.mcpServerConfig.findFirst({
      where: {
        name,
        userId: null,
        projectId: null,
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: 'MCP 服务器名称已存在' },
        { status: 400 }
      );
    }

    // 创建全局 MCP 配置
    const mcpServer = await prisma.mcpServerConfig.create({
      data: {
        name,
        type,
        command: command || null,
        args: args ? JSON.stringify(args) : null,
        url: url || null,
        env: env ? JSON.stringify(env) : null,
        isEnabled,
        autoStart,
        userId: null,
        projectId: null,
      },
    });

    return NextResponse.json({ mcpServer }, { status: 201 });
  } catch (error) {
    console.error('Create MCP server error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
