/**
 * 会话续订 API
 * 从历史会话加载上下文，创建新的续订会话
 */

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { SessionManager } from '@/services/session-manager';
import { logger, LOG_MODULES } from '@/lib/logger';

// 续订会话
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

    const { id: sessionId } = await params;

    // 从请求体获取参数
    const body = await request.json().catch(() => ({}));
    const projectPath = body.projectPath;
    const maxContextMessages = body.maxContextMessages || 10;
    const cwd = body.cwd;
    const model = body.model;

    if (!projectPath) {
      return NextResponse.json({ error: '缺少项目路径参数' }, { status: 400 });
    }

    // 使用 SessionManager 续订会话
    const sessionManager = new SessionManager(projectPath);
    const result = await sessionManager.resumeSession(sessionId, {
      maxContextMessages,
      cwd,
      model,
    });

    logger.create(LOG_MODULES.SESSION, payload, result.newSession.id || 'resumed-session', { details: { originalSessionId: result.originalSessionId, contextMessageCount: result.contextMessages.length } });

    return NextResponse.json({
      success: true,
      newSession: result.newSession,
      originalSessionId: result.originalSessionId,
      contextMessageCount: result.contextMessages.length,
    }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, '续订会话错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    const errorMessage = error instanceof Error ? error.message : '服务器内部错误';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
