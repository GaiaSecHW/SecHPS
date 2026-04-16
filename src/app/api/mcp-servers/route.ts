// src/app/api/mcp-servers/route.ts
// MCP 服务器配置 API（支持用户私有 + 共享 MCP）

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/mcp-servers - 获取用户可访问的 MCP 服务器列表
// 普通用户：自己的 MCP + 共享的 MCP
// 管理员：所有 MCP
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

    const isAdmin = payload.roles?.includes('admin');

    // 解析分页参数
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const search = searchParams.get('search') || undefined;
    const filter = searchParams.get('filter') || 'all'; // all | mine | shared

    // 获取分页参数
    const { skip, take } = getOffsetPagination({ page, limit });

    // 构建 where 条件
    let where: any = { projectId: null }; // 排除项目级 MCP

    if (isAdmin) {
      // 管理员：查看所有全局 MCP
      if (search) {
        where.name = { contains: search };
      }
      if (filter === 'mine') {
        where.userId = payload.userId;
      } else if (filter === 'shared') {
        where.isShared = true;
      }
    } else {
      // 普通用户：自己的 MCP + 共享的 MCP
      if (filter === 'mine') {
        where.userId = payload.userId;
      } else if (filter === 'shared') {
        where.isShared = true;
      } else {
        // all: 自己的 + 共享的
        where.OR = [
          { userId: payload.userId },
          { isShared: true },
        ];
      }
      if (search) {
        // 合并搜索条件
        const searchCondition = { name: { contains: search } };
        if (where.OR) {
          where.OR = where.OR.map((cond: any) => ({ ...cond, ...searchCondition }));
        } else {
          where.name = { contains: search };
        }
      }
    }

    // 获取总数
    const total = await prisma.mcpServerConfig.count({ where });

    // 获取 MCP 配置列表
    const mcpServers = await prisma.mcpServerConfig.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        User: {
          select: { id: true, username: true, name: true },
        },
      },
    });

    // 返回分页响应
    const response = createPaginatedResponse(mcpServers, total, page, limit);
    return NextResponse.json({ servers: response.data, pagination: response.pagination });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MCP, '获取 MCP 服务器列表失败', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/mcp-servers - 创建 MCP 服务器配置
// 所有用户都可以创建自己的 MCP
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

    const isAdmin = payload.roles?.includes('admin');

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
      isShared = false, // 只有管理员可以设置为共享
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

    // 非管理员不能创建共享 MCP
    if (isShared && !isAdmin) {
      return NextResponse.json(
        { error: '只有管理员可以创建共享 MCP' },
        { status: 403 }
      );
    }

    // 检查名称是否已存在（用户自己的 MCP 名称不能重复）
    const existing = await prisma.mcpServerConfig.findFirst({
      where: {
        name,
        userId: payload.userId,
        projectId: null,
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: '你已经有一个同名 MCP 服务器' },
        { status: 400 }
      );
    }

    // 创建 MCP 配置（绑定到当前用户）
    const mcpServer = await prisma.mcpServerConfig.create({
      data: {
        id: `mcp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name,
        type,
        command: command || null,
        args: args ? JSON.stringify(args) : null,
        url: url || null,
        env: env ? JSON.stringify(env) : null,
        isEnabled,
        autoStart,
        isShared: isAdmin ? isShared : false, // 非管理员强制为 false
        userId: payload.userId,
        projectId: null,
        updatedAt: new Date(),
      },
    });

    logger.create(LOG_MODULES.MCP, payload, `mcp:${mcpServer.id}`, { name, type });
    return NextResponse.json({ mcpServer }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MCP, '创建 MCP 服务器配置失败', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}