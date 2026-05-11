/**
 * 项目会话列表 API
 * 从数据库获取项目的评估会话历史
 * 
 * 数据隔离：普通用户只能查看自己项目的会话，管理员可以查看所有
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// 获取项目的会话列表
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 验证项目所有权
    let projectWhere: any = { id };
    if (!userIsAdmin) {
      // 普通用户：只能查看自己项目的会话
      projectWhere.userId = payload.userId;
    }

    const project = await prisma.project.findFirst({
      where: projectWhere,
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

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

    // 从数据库获取评估会话（使用 select 避免 Prisma findMany + include bug）
    const [sessions, total] = await Promise.all([
      prisma.evaluationSession.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: offset,
        take: limit,
        select: {
          id: true,
          opencodeSessionId: true,
          status: true,
          startedAt: true,
          completedAt: true,
          title: true,
          summary: true,
          messageCount: true,
          provider: true,
          agentTeamId: true,
          errorMessage: true,
          lastActivity: true,
        },
      }),
      prisma.evaluationSession.count({ where }),
    ]);

    // 单独查询 AgentTeam 名称
    const agentTeamIds = [...new Set(sessions.map(s => s.agentTeamId).filter(Boolean))] as string[];
    const agentTeams = agentTeamIds.length > 0
      ? await prisma.agentTeam.findMany({ where: { id: { in: agentTeamIds } }, select: { id: true, name: true } })
      : [];
    const agentTeamMap = new Map(agentTeams.map(t => [t.id, t]));

    // 转换数据格式以匹配前端期望
    const formattedSessions = sessions.map((session) => ({
      id: session.id,
      opencodeSessionId: session.opencodeSessionId || session.id,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      completedAt: session.completedAt?.toISOString() || null,
      title: session.title || `评估会话`,
      summary: session.summary,
      messageCount: session.messageCount,
      provider: session.provider,
      agentTeamId: session.agentTeamId,
      agentTeamName: session.agentTeamId ? agentTeamMap.get(session.agentTeamId)?.name : undefined,
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
    logger.errorNoUser(LOG_MODULES.SESSION, '获取会话列表错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}