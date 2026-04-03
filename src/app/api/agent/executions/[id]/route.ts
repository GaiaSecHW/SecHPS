// src/app/api/agent/executions/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/agent/executions/:id - 获取执行状态
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

    const execution = await prisma.skillExecution.findUnique({
      where: { id },
      include: {
        skill: {
          select: { id: true, name: true, displayName: true, category: true },
        },
        project: {
          select: { id: true, name: true },
        },
      },
    });

    if (!execution) {
      return NextResponse.json({ error: '执行记录不存在' }, { status: 404 });
    }

    return NextResponse.json({
      execution: {
        ...execution,
        input: JSON.parse(execution.input),
        output: execution.output ? JSON.parse(execution.output) : null,
      },
    });
  } catch (error) {
    console.error('获取执行状态错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
