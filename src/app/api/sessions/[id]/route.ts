/**
 * 会话详情 API
 * 使用 Claude SDK 获取会话信息
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { PERMISSIONS } from '@/types/permissions';
import { getSessionInfo, getSessionMessages } from '@anthropic-ai/claude-agent-sdk';

// 获取会话详情
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

    // 检查 SESSION_READ 权限
    if (!hasPermission(payload.permissions, PERMISSIONS.SESSION_READ)) {
      return NextResponse.json({ error: '无权限查看会话' }, { status: 403 });
    }

    const { id: sessionId } = await params;

    console.log('[Session API] Fetching session info for:', sessionId);

    // 查找关联的项目
    const evaluation = await prisma.evaluationSession.findFirst({
      where: { opencodeSessionId: sessionId },
      include: {
        project: {
          select: { projectPath: true, userId: true }
        }
      }
    });

    // 用户归属校验：检查项目是否属于当前用户
    if (evaluation?.project && evaluation.project.userId !== payload.userId) {
      return NextResponse.json({ error: '无权限访问此会话' }, { status: 403 });
    }

    const projectPath = evaluation?.project?.projectPath;

    // 使用 SDK 获取会话信息
    const sessionInfo = await getSessionInfo(sessionId, projectPath ? { dir: projectPath } : undefined);

    if (!sessionInfo) {
      console.log('[Session API] Session not found:', sessionId);
      return NextResponse.json({
        session: {
          id: sessionId,
          summary: 'Unknown Session',
          messageCount: 0,
          lastActivity: new Date().toISOString(),
          cwd: null,
        },
        messages: [],
      });
    }

    console.log('[Session API] SDK returned session info:', sessionInfo);

    // 获取消息数量
    const messages = await getSessionMessages(sessionId, projectPath ? { dir: projectPath } : undefined);

    const session = {
      id: sessionId,
      summary: sessionInfo.summary || sessionInfo.firstPrompt || 'New Session',
      title: sessionInfo.customTitle,
      messageCount: messages.length,
      lastActivity: new Date().toISOString(), // SDK 没有返回时间戳，使用当前时间
      cwd: sessionInfo.cwd,
      branch: (sessionInfo as any).branch, // branch 可能在未来版本添加
      tag: sessionInfo.tag,
    };

    return NextResponse.json({
      session,
      messages: messages.slice(0, 10), // 返回前10条消息作为预览
    });
  } catch (error) {
    console.error('获取会话详情错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 删除会话
export async function DELETE(
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

    // 检查 SESSION_DELETE 权限
    if (!hasPermission(payload.permissions, PERMISSIONS.SESSION_DELETE)) {
      return NextResponse.json({ error: '无权限删除会话' }, { status: 403 });
    }

    const { id: sessionId } = await params;

    // 查找关联的评估会话
    const evaluation = await prisma.evaluationSession.findFirst({
      where: { opencodeSessionId: sessionId },
      include: {
        project: {
          select: { userId: true }
        }
      }
    });

    // 用户归属校验：检查项目是否属于当前用户
    if (evaluation?.project && evaluation.project.userId !== payload.userId) {
      return NextResponse.json({ error: '无权限删除此会话' }, { status: 403 });
    }

    // 删除评估会话记录（如果存在）
    if (evaluation) {
      await prisma.evaluationSession.delete({
        where: { id: evaluation.id },
      });
    }

    return NextResponse.json({ success: true, message: '会话已删除' });
  } catch (error) {
    console.error('删除会话错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
