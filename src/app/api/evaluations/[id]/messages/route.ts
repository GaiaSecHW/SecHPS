// src/app/api/evaluations/[id]/messages/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/evaluations/[id]/messages - 获取评估会话的消息列表
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

    // 检查评估会话是否存在
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 获取消息列表
    const messages = await prisma.sessionMessage.findMany({
      where: { evaluationSessionId: id },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({ messages });
  } catch (error) {
    console.error('Get evaluation messages error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
