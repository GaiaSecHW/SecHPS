// src/app/api/evaluations/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

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
          },
        },
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
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

    const { id } = await params;

    // 检查评估会话是否存在
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 删除相关的消息
    await prisma.sessionMessage.deleteMany({
      where: { evaluationSessionId: id },
    });

    // 删除评估会话
    await prisma.evaluationSession.delete({
      where: { id },
    });

    return NextResponse.json({ message: '评估会话已删除' });
  } catch (error) {
    console.error('Delete evaluation error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
