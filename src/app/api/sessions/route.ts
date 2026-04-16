/**
 * 会话列表 API
 * 以 Claude SDK 项目为中心，返回所有发现的项目和会话
 */

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { ProjectDiscovery } from '@/services/session-manager';
import { logger, LOG_MODULES } from '@/lib/logger';

// 获取所有 Claude SDK 项目的会话列表
export async function GET(request: Request) {
  try {
    // 验证 Token 并检查权限
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SESSION_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const { payload } = auth;

    // 从 Claude SDK 发现所有项目
    const projectDiscovery = new ProjectDiscovery();
    const projects = await projectDiscovery.discoverProjects();

    // 汇总会话数
    const totalSessions = projects.reduce((sum, p) => sum + p.sessions.length, 0);
    const totalCursorSessions = projects.reduce((sum, p) => sum + (p.cursorSessions?.length || 0), 0);
    const totalCodexSessions = projects.reduce((sum, p) => sum + (p.codexSessions?.length || 0), 0);
    const totalGeminiSessions = projects.reduce((sum, p) => sum + (p.geminiSessions?.length || 0), 0);

    return NextResponse.json({
      projects,
      totalSessions,
      totalCursorSessions,
      totalCodexSessions,
      totalGeminiSessions,
      count: projects.length,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, '获取会话列表错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
