/**
 * 项目会话列表 API
 * 从数据库获取项目的评估会话历史
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// 获取项目的会话列表
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

    // 从 URL 参数获取分页信息
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const status = url.searchParams.get('status'); // 可选的状态过滤
    const provider = url.searchParams.get('provider'); // 可选的提供者过滤

    // 构建查询条件
    const where: any = { projectId: id };
    if (status) {
      where.status = status;
    }
    if (provider) {
      where.provider = provider;
    }

    // 从数据库获取评估会话
    const [sessions, total] = await Promise.all([
      prisma.evaluationSession.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          workflow: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: { messages: true },
          },
        },
      }),
      prisma.evaluationSession.count({ where }),
    ]);

    // 转换数据格式以匹配前端期望
    const formattedSessions = sessions.map((session) => ({
      id: session.id,
      opencodeSessionId: session.opencodeSessionId || session.id,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      completedAt: session.completedAt?.toISOString() || null,
      title: session.title || `评估会话`,
      summary: session.summary,
      messageCount: session.messageCount || session._count.messages,
      provider: session.provider,
      workflowId: session.workflowId,
      workflowName: session.workflow?.name,
      errorMessage: session.errorMessage,
      lastActivity: session.lastActivity?.toISOString() || session.startedAt.toISOString(),
    }));

    return NextResponse.json({
      sessions: formattedSessions,
      hasMore: offset + sessions.length < total,
      total,
      offset,
      limit,
    });
  } catch (error) {
    console.error('获取会话列表错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
