/**
 * 会话搜索 API
 * 在项目会话中搜索消息
 */

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { SessionManager, ProjectDiscovery } from '@/services/session-manager';
import { logger, LOG_MODULES } from '@/lib/logger';

// 搜索会话消息
export async function GET(request: Request) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  try {
    const url = new URL(request.url);
    const query = url.searchParams.get('query') || '';
    const projectPath = url.searchParams.get('projectPath');
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    if (!query || !projectPath) {
      return NextResponse.json({ error: '缺少查询参数' }, { status: 400 });
    }

    // 使用 SessionManager 搜索消息
    const sessionManager = new SessionManager(projectPath);
    const results = await sessionManager.searchMessages(query, limit);

    return NextResponse.json({
      results,
      query,
      count: results.length,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, '搜索会话消息错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
