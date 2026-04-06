/**
 * 会话消息 API
 * 使用新的 SessionManager 获取会话消息
 */

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { SessionManager } from '@/services/session-manager';

// 获取会话消息
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

    const { id: sessionId } = await params;

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
    console.error('获取会话消息错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
