// src/app/api/evaluations/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/evaluations/[id] - 获取评估会话详情
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
      return NextResponse.json({ error: '无权限查看评估' }, { status: 403 });
    }

    const { id } = await params;

    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            description: true,
            environmentUrl: true,
            userId: true,
          },
        },
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 归属校验
    if (evaluation.project.userId !== payload.userId) {
      return NextResponse.json({ error: '无权查看此评估' }, { status: 403 });
    }

    return NextResponse.json({ evaluation });
  } catch (error) {
    console.error('Get evaluation error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/evaluations/[id] - 删除评估会话
export async function DELETE(
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
    if (!hasPermission(payload.permissions, PERMISSIONS.EVALUATION_DELETE)) {
      return NextResponse.json({ error: '无权限删除评估' }, { status: 403 });
    }

    const { id } = await params;

    // 检查评估会话是否存在并获取项目归属
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      include: { project: { select: { userId: true } } },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 归属校验
    if (evaluation.project.userId !== payload.userId) {
      return NextResponse.json({ error: '无权删除此评估' }, { status: 403 });
    }

    // 级联删除所有关联数据（使用事务）
    await prisma.$transaction([
      prisma.sessionMessage.deleteMany({ where: { evaluationSessionId: id } }),
      prisma.nodeExecution.deleteMany({ where: { evaluationSessionId: id } }),
      prisma.evaluationIteration.deleteMany({ where: { evaluationSessionId: id } }),
      prisma.tokenUsage.deleteMany({ where: { evaluationId: id } }),
      prisma.vulnerability.deleteMany({ where: { evaluationId: id } }),
      prisma.evaluationResult.deleteMany({ where: { evaluationId: id } }),
      prisma.evaluationSession.delete({ where: { id } }),
    ]);

    return NextResponse.json({ message: '评估会话已删除' });
  } catch (error) {
    console.error('Delete evaluation error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
