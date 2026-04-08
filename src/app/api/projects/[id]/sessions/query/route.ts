/**
 * 会话查询 API（支持提供者过滤）
 * 参考 CloudCLI UI 的多提供者会话查询设计
 */

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// 获取项目的会话列表（支持提供者过滤）
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

    // 从 URL 参数获取过滤和分页信息
    const url = new URL(request.url);
    const provider = url.searchParams.get('provider'); // claude | cursor | codex | gemini
    const status = url.searchParams.get('status'); // running | completed | failed | cancelled
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    // 构建查询条件
    const where: any = { projectId: id };
    
    if (provider) {
      where.provider = provider;
    }
    
    if (status) {
      where.status = status;
    }

    // 查询会话列表
    const [sessions, total] = await Promise.all([
      prisma.evaluationSession.findMany({
        where,
        orderBy: { lastActivity: 'desc' },
        take: limit,
        skip: offset,
        include: {
          _count: {
            select: { messages: true },
          },
        },
      }),
      prisma.evaluationSession.count({ where }),
    ]);

    // 格式化会话数据
    const formattedSessions = sessions.map(session => ({
      id: session.id,
      provider: session.provider,
      title: session.title,
      summary: session.summary,
      status: session.status,
      messageCount: session.messageCount || session._count.messages,
      lastActivity: session.lastActivity,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      __provider: session.provider, // CloudCLI UI 兼容字段
    }));

    return NextResponse.json({
      sessions: formattedSessions,
      total,
      hasMore: offset + limit < total,
      limit,
      offset,
      provider: provider || 'all',
      status: status || 'all',
    });
  } catch (error) {
    console.error('获取会话列表错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 合并多提供者会话（参考 CloudCLI UI 的 getProjectSessions 函数）
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
    const { limit = 20, offset = 0, providers } = body;

    // 查询所有提供者的会话
    const allSessions = await prisma.evaluationSession.findMany({
      where: { projectId: id },
      orderBy: { lastActivity: 'desc' },
      include: {
        _count: {
          select: { messages: true },
        },
      },
    });

    // 如果指定了提供者列表，过滤
    let filteredSessions = allSessions;
    if (providers && Array.isArray(providers) && providers.length > 0) {
      filteredSessions = allSessions.filter(s => providers.includes(s.provider));
    }

    // 合并并排序（按 lastActivity）
    const sortedSessions = filteredSessions
      .sort((a, b) => {
        const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
        const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
        return bTime - aTime;
      });

    // 分页
    const total = sortedSessions.length;
    const paginatedSessions = sortedSessions.slice(offset, offset + limit);

    // 格式化
    const formattedSessions = paginatedSessions.map(session => ({
      id: session.id,
      provider: session.provider,
      title: session.title,
      summary: session.summary,
      status: session.status,
      messageCount: session.messageCount || session._count.messages,
      lastActivity: session.lastActivity,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      __provider: session.provider,
    }));

    return NextResponse.json({
      sessions: formattedSessions,
      total,
      hasMore: offset + limit < total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('合并会话列表错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
