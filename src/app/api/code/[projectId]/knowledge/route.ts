// src/app/api/code/[projectId]/knowledge/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/code/:projectId/knowledge - 获取代码知识
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
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

    const { projectId } = await params;

    // 验证项目所有权
    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        ...(isAdmin ? {} : { userId: payload.userId }),
      },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在或无权访问' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const entityType = searchParams.get('entityType');
    const name = searchParams.get('name');
    const filePath = searchParams.get('filePath');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '50');

    const where: Record<string, unknown> = { projectId };
    if (entityType) where.entityType = entityType;
    if (name) where.name = { contains: name };
    if (filePath) where.filePath = { contains: filePath };

    const [knowledge, total] = await Promise.all([
      prisma.codeKnowledge.findMany({
        where,
        orderBy: [{ filePath: 'asc' }, { lineStart: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.codeKnowledge.count({ where }),
    ]);

    return NextResponse.json({
      knowledge: knowledge.map(k => ({
        ...k,
        calls: k.calls ? JSON.parse(k.calls) : null,
        calledBy: k.calledBy ? JSON.parse(k.calledBy) : null,
      })),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('获取代码知识错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
