// src/app/api/agent/executions/[id]/route.ts
// 数据隔离：普通用户只能查看自己项目的执行记录，管理员可以查看所有

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

    // 检查是否是管理员
    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');

    // 构建查询条件
    let where: any = { id };
    if (!isAdmin) {
      // 普通用户：通过 SkillExecution.Project.userId 验证所有权
      where.Project = { userId: payload.userId };
    }

    const execution = await prisma.skillExecution.findFirst({
      where,
      include: {
        Skill: {
          select: { id: true, name: true, displayName: true, category: true },
        },
        Project: {
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