// src/app/api/code/[projectId]/graph/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/code/:projectId/graph - 获取调用图
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

    // 获取所有代码知识
    const knowledge = await prisma.codeKnowledge.findMany({
      where: { projectId },
      select: {
        id: true,
        name: true,
        entityType: true,
        filePath: true,
        lineStart: true,
        lineEnd: true,
        calls: true,
        calledBy: true,
      },
    });

    // 构建节点
    const nodes = knowledge.map(k => ({
      id: k.id,
      name: k.name,
      type: k.entityType,
      filePath: k.filePath,
      lineStart: k.lineStart,
      lineEnd: k.lineEnd,
    }));

    // 构建边
    const edges: Array<{ source: string; target: string; type: string }> = [];

    for (const k of knowledge) {
      const calls = k.calls ? JSON.parse(k.calls) : [];
      for (const call of calls) {
        // 查找被调用的函数
        const target = knowledge.find(t => t.name === call && t.id !== k.id);
        if (target) {
          edges.push({
            source: k.id,
            target: target.id,
            type: 'calls',
          });
        }
      }
    }

    return NextResponse.json({
      nodes,
      edges,
      stats: {
        totalNodes: nodes.length,
        totalEdges: edges.length,
        byType: knowledge.reduce((acc, k) => {
          acc[k.entityType] = (acc[k.entityType] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      },
    });
  } catch (error) {
    console.error('获取调用图错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
