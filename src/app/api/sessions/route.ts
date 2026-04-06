/**
 * 会话列表 API
 * 以 Claude SDK 项目为中心，返回所有发现的项目和会话
 */

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { ProjectDiscovery } from '@/services/session-manager';

// 获取所有 Claude SDK 项目的会话列表
export async function GET(request: Request) {
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
    console.error('获取会话列表错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
