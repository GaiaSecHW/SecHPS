/**
 * 项目会话列表 API
 * 
 * GET: 获取指定项目的会话列表
 * 支持分页和按来源过滤
 * 
 * Query Parameters:
 * - limit: 每页数量 (默认: 50)
 * - offset: 偏移量 (默认: 0)
 * - source: 来源过滤 (claude, cursor, codex, gemini)
 */

import { NextResponse } from 'next/server';
import { ClaudeCodeReader } from '@/services/claude-code-reader';
import type { ClaudeCodeSession, ProviderSource } from '@/types/claude-code';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ project: string }> }
) {
  try {
    const { project: projectName } = await params;
    const { searchParams } = new URL(request.url);
    
    // 解析查询参数
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const source = searchParams.get('source') as ProviderSource | null;

    // 解码项目名称
    const decodedProjectName = decodeURIComponent(projectName);

    // 使用 ClaudeCodeReader 获取会话列表
    const reader = new ClaudeCodeReader();
    const projectPath = await (reader as any).extractProjectDirectory(decodedProjectName);
    const result = await reader.getSessions(projectPath, limit, offset);

    // 格式化会话数据
    let sessions: ClaudeCodeSession[] = result.sessions.map(s => ({
      id: s.id,
      summary: s.summary,
      messageCount: s.messageCount,
      lastActivity: s.lastActivity,
      cwd: s.cwd,
      model: s.model,
    }));

    // 如果指定了来源过滤，只返回对应来源的会话
    if (source && source !== 'claude') {
      sessions = [];
    }

    return NextResponse.json({
      sessions,
      total: result.total,
      hasMore: result.hasMore,
      offset: result.offset,
      limit: result.limit,
    });
  } catch (error) {
    console.error('获取项目会话列表错误:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}
