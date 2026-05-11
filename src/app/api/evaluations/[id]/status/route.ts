// src/app/api/evaluations/[id]/status/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/evaluations/[id]/status - 获取评估会话状态
export async function GET(
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

    // 权限检查
    if (!hasPermission(payload.permissions, PERMISSIONS.EVALUATION_READ)) {
      return NextResponse.json({ error: '无权限查看评估状态' }, { status: 403 });
    }

    const { id } = await params;

    // 获取评估会话状态
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      select: {
        id: true,
        projectId: true,
        status: true,
        startedAt: true,
        completedAt: true,
        errorMessage: true,
        messageCount: true,
        lastActivity: true,
        opencodeSessionId: true,
        agentTeamId: true,
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // Separate query for Project
    const statusProject = evaluation.projectId ? await prisma.project.findUnique({
      where: { id: evaluation.projectId },
      select: { userId: true },
    }) : null;

    // 归属校验
    if (statusProject?.userId !== payload.userId) {
      return NextResponse.json({ error: '无权查看此评估状态' }, { status: 403 });
    }

    return NextResponse.json({ evaluation });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.EVALUATION, '获取评估状态错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
