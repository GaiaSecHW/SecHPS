/**
 * 会话消息 API
 * 使用新的 SessionManager 获取会话消息
 * 数据隔离：普通用户只能查看自己项目评估的消息，管理员可以查看所有
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
import { SessionManager } from '@/services/session-manager';
import { logger, LOG_MODULES } from '@/lib/logger';

// 获取会话消息
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

    const { id: sessionId } = await params;

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 从 URL 参数获取分页信息
    const url = new URL(request.url);
    const limitParam = url.searchParams.get('limit');
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const limit = limitParam ? parseInt(limitParam, 10) : null;

    // 需要确定项目路径
    // 方式1: 从查询参数获取项目路径
    const projectPath = url.searchParams.get('projectPath');

    if (!projectPath) {
      return NextResponse.json({ error: '缺少项目路径参数' }, { status: 400 });
    }

    // 数据隔离：验证评估会话归属
    // 通过 sessionId (可能是 evaluationSessionId 或 opencodeSessionId) 查找评估会话
    let evalWhere: any = {
      OR: [
        { id: sessionId },
        { opencodeSessionId: sessionId },
      ],
    };
    if (!userIsAdmin) {
      evalWhere = {
        AND: [
          { OR: [{ id: sessionId }, { opencodeSessionId: sessionId }] },
          { Project: { userId: payload.userId } },
        ],
      };
    }

    const evaluationSession = await prisma.evaluationSession.findFirst({
      where: evalWhere,
      include: { Project: { select: { userId: true, projectPath: true } } },
    });

    if (!evaluationSession) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 验证 projectPath 与评估会话的项目路径匹配
    if (evaluationSession.Project.projectPath !== projectPath) {
      return NextResponse.json({ error: '项目路径不匹配' }, { status: 400 });
    }

    // 使用 SessionManager 获取会话消息
    const sessionManager = new SessionManager(projectPath);
    const messagesResult = await sessionManager.getSessionMessages(sessionId, limit, offset);

    return NextResponse.json({
      messages: messagesResult.messages,
      hasMore: messagesResult.hasMore,
      total: messagesResult.total,
      offset: messagesResult.offset,
      limit: messagesResult.limit,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, '获取会话消息错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}