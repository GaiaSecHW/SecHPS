import { NextResponse } from 'next/server';
import { ClaudeCodeReader } from '@/services/claude-code-reader';
import { providerRegistry } from '@/services/providers';
import { logger } from '@/lib/logger';
import type { ClaudeCodeProject, ClaudeCodeSession } from '@/types/claude-code';

export async function GET() {
  try {
    const reader = new ClaudeCodeReader();
    
    // 1) 发现并聚合多源会话信息（用于统计）
    const allSessions = (await providerRegistry.discoverAllSessions()) ?? [];
    const cursorSessions = allSessions.filter((s: any) => s?.source === 'cursor');
    const codexSessions = allSessions.filter((s: any) => s?.source === 'codex');
    const geminiSessions = allSessions.filter((s: any) => s?.source === 'gemini');

    // 2) 使用 discoverProjects 发现项目
    const baseProjects = await reader.discoverProjects();
    
    // 3) 为每个项目获取完整的会话列表
    let totalSessions = 0;
    const projects = await Promise.all(
      baseProjects.map(async (project: ClaudeCodeProject) => {
        const sessionsResult = await reader.getSessions(project.path as string, 1000, 0);
        totalSessions += sessionsResult.total;
        return {
          ...project,
          sessionCount: sessionsResult.total,
          sessions: sessionsResult.sessions.slice(0, 5),
        };
      })
    );

    // 4) 组装返回结果
    const result = {
      projects,
      totalProjects: projects.length,
      totalSessions,
      cursorSessions: cursorSessions.length,
      codexSessions: codexSessions.length,
      geminiSessions: geminiSessions.length,
    };

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.errorNoUser('CLAUDE', '发现 Claude 项目失败', { details: { error: message } });
    return NextResponse.json({ details: { error: 'Failed to discover Claude projects', detail: message } }, { status: 500 });
  }
}
