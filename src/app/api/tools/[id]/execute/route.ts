// src/app/api/tools/[id]/execute/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

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

    const { id } = await params;
    const body = await request.json();

    const tool = await prisma.tool.findUnique({ where: { id } });

    if (!tool) {
      return NextResponse.json({ error: '工具不存在' }, { status: 404 });
    }

    if (!tool.isActive) {
      return NextResponse.json({ error: '工具未启用' }, { status: 400 });
    }

    // TODO: 实际执行工具的逻辑
    // 这里返回模拟结果
    const result = {
      toolId: tool.id,
      toolName: tool.name,
      parameters: body,
      executedAt: new Date().toISOString(),
      status: 'success',
      output: { message: '工具执行成功（模拟）' },
    };

    return NextResponse.json({ result });
  } catch (error) {
    console.error('执行工具错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
