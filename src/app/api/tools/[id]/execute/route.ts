// src/app/api/tools/[id]/execute/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { ToolExecutor } from '@/lib/tool-executor';

// POST /api/tools/:id/execute - 执行工具
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    // 权限检查：需要 AGENT_EXECUTE 权限
    if (!hasPermission(payload.permissions, PERMISSIONS.AGENT_EXECUTE)) {
      return NextResponse.json({ error: '无权执行工具' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { projectId, parameters } = body;

    // 如果提供了 projectId，验证项目归属
    if (projectId) {
      const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) {
        return NextResponse.json({ error: '项目不存在' }, { status: 404 });
      }
      if (!isAdmin && project.userId !== payload.userId) {
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
      timeout: tool.timeout || 600000, // 默认10分钟
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
    console.error('执行工具错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}