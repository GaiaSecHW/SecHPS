// src/app/api/tools/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { generateId } from '@/lib/id-generator';

// GET /api/tools - 获取工具列表
export async function GET(request: Request) {
  // 使用统一认证中间件
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
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
  // 使用统一认证中间件
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_UPDATE });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
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
        id: generateId('tool'),
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
        updatedAt: new Date(),
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
