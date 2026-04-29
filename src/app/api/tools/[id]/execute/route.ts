// src/app/api/tools/[id]/execute/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { ToolExecutor } from '@/lib/tool-executor';
import { logger, LOG_MODULES } from '@/lib/logger';

// POST /api/tools/:id/execute - 执行工具
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 使用统一认证中间件
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.AGENT_EXECUTE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;
    const body = await request.json();
    const { projectId, parameters } = body;

    // 如果提供了 projectId，验证项目归属
    if (projectId) {
      const userIsAdmin = isAdmin(payload);
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) {
        return NextResponse.json({ error: '项目不存在' }, { status: 404 });
      }
      if (!userIsAdmin && project.userId !== payload.userId) {
        return NextResponse.json({ error: '无权访问此项目' }, { status: 403 });
      }
    }

    const tool = await prisma.tool.findUnique({ where: { id } });

    if (!tool) {
      return NextResponse.json({ error: '工具不存在' }, { status: 404 });
    }

    if (!tool.isActive) {
      return NextResponse.json({ error: '工具未启用' }, { status: 400 });
    }

    // 创建执行器并执行
    const executor = new ToolExecutor({
      projectId: projectId || 'default',
      timeout: tool.timeout || 7200000, // 默认2小时
    });

    const result = await executor.execute(id, parameters || {});

    return NextResponse.json({
      result: {
        toolId: tool.id,
        toolName: tool.name,
        parameters,
        ...result,
        executedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AGENT, '执行工具错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}