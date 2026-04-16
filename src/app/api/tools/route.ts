// src/app/api/tools/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/tools - 获取工具列表
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的令牌' } }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const isActive = searchParams.get('isActive');

    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (isActive !== null) where.isActive = isActive === 'true';

    const tools = await prisma.tool.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    return NextResponse.json({
      tools: tools.map(t => ({
        ...t,
        parameters: JSON.parse(t.parameters),
        executorConfig: t.executorConfig ? JSON.parse(t.executorConfig) : null,
      })),
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '获取工具列表失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}

// POST /api/tools - 创建工具
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的令牌' } }, { status: 401 });
    }

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ details: { error: '禁止访问' } }, { status: 403 });
    }

    const body = await request.json();
    const {
      name,
      displayName,
      description,
      category,
      parameters,
      executor,
      executorConfig,
      requiresPermission,
      allowedInSandbox,
      timeout,
    } = body;

    if (!name || !displayName || !description || !category || !parameters || !executor) {
      return NextResponse.json(
        { details: { error: '缺少必填字段' } },
        { status: 400 }
      );
    }

    const existing = await prisma.tool.findUnique({ where: { name } });
    if (existing) {
      return NextResponse.json(
        { details: { error: '工具名称已存在' } },
        { status: 400 }
      );
    }

    const tool = await prisma.tool.create({
      data: {
        name,
        displayName,
        description,
        category,
        parameters: JSON.stringify(parameters),
        executor,
        executorConfig: executorConfig ? JSON.stringify(executorConfig) : null,
        requiresPermission: requiresPermission ?? false,
        allowedInSandbox: allowedInSandbox ?? true,
        timeout: timeout ?? 30000,
        isBuiltin: false,
      },
    });

    logger.create(LOG_MODULES.CONFIG, payload, `tool:${tool.id}`, { name, displayName, category });

    return NextResponse.json(
      {
        tool: {
          ...tool,
          parameters: JSON.parse(tool.parameters),
          executorConfig: tool.executorConfig ? JSON.parse(tool.executorConfig) : null,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '创建工具失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
