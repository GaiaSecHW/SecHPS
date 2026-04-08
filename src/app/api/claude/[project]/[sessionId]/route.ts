/**
 * 删除会话 API
 * 
 * DELETE: 删除指定的会话文件 (.jsonl)
 * 不影响项目配置，只删除会话数据
 */

import { NextResponse } from 'next/server';
import { SessionManager, ProjectDiscovery } from '@/services/session-manager';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ project: string; sessionId: string }> }
) {
  try {
    const { project: projectName, sessionId } = await params;

    // 解码项目名称并获取项目路径
    const decodedProjectName = decodeURIComponent(projectName);
    const projectDiscovery = new ProjectDiscovery();
    const projectPath = await projectDiscovery['extractProjectDirectory'](decodedProjectName);

    // 删除会话
    const sessionManager = new SessionManager(projectPath);
    const success = await sessionManager.deleteSession(sessionId);

    if (!success) {
      return NextResponse.json(
        { error: '删除会话失败' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('删除会话错误:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}

/**
 * 获取会话详情
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ project: string; sessionId: string }> }
) {
  try {
    const { project: projectName, sessionId } = await params;

    // 解码项目名称并获取项目路径
    const decodedProjectName = decodeURIComponent(projectName);
    const projectDiscovery = new ProjectDiscovery();
    const projectPath = await projectDiscovery['extractProjectDirectory'](decodedProjectName);

    // 获取会话信息（获取第一条消息作为摘要）
    const sessionManager = new SessionManager(projectPath);
    const result = await sessionManager.getSessionMessages(sessionId, 1, 0);

    if (result.total === 0) {
      return NextResponse.json(
        { error: '会话不存在或为空' },
        { status: 404 }
      );
    }

    const firstMessage = result.messages[0];

    return NextResponse.json({
      id: sessionId,
      summary: firstMessage.message?.content
        ? (typeof firstMessage.message.content === 'string'
          ? firstMessage.message.content.substring(0, 100)
          : '会话')
        : '会话',
      messageCount: result.total,
      lastActivity: firstMessage.timestamp,
      cwd: firstMessage.cwd,
    });
  } catch (error) {
    console.error('获取会话详情错误:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}
