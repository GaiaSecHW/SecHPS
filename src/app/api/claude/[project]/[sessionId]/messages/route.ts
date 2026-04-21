/**
 * 会话消息 API
 * 
 * GET: 获取指定会话的消息列表
 * 支持分页，返回归一化的消息格式
 * 
 * Query Parameters:
 * - limit: 每页数量 (默认: 100)
 * - offset: 偏移量 (默认: 0)
 */

import { NextResponse } from 'next/server';
import { SessionManager, ProjectDiscovery } from '@/services/session-manager';
import type { ClaudeCodeMessage } from '@/types/claude-code';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ project: string; sessionId: string }> }
) {
  try {
    const { project: projectName, sessionId } = await params;
    const { searchParams } = new URL(request.url);

    // 解析查询参数
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // 解码项目名称并获取项目路径
    const decodedProjectName = decodeURIComponent(projectName);
    const projectDiscovery = new ProjectDiscovery();
    const projectPath = await projectDiscovery['extractProjectDirectory'](decodedProjectName);

    // 获取会话消息
    const sessionManager = new SessionManager(projectPath);
    const result = await sessionManager.getSessionMessages(sessionId, limit, offset);

    // 格式化消息数据
    const messages: ClaudeCodeMessage[] = result.messages.map(msg => ({
      id: msg.id,
      sessionId: msg.sessionId,
      type: msg.type,
      role: msg.message?.role,
      content: typeof msg.message?.content === 'string'
        ? msg.message.content
        : msg.message?.content,
      toolName: msg.tool_name,
      toolInput: msg.tool_input,
      toolResult: msg.tool_result,
      toolUseId: msg.tool_use_id,
      isApiErrorMessage: msg.isApiErrorMessage,
      timestamp: msg.timestamp,
      uuid: msg.uuid,
      parentUuid: msg.parentUuid,
      cwd: msg.cwd,
    }));

    return NextResponse.json({
      messages,
      total: result.total,
      hasMore: result.hasMore,
      offset: result.offset,
      limit: result.limit,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, '获取会话消息错误:', { details: error });
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}
