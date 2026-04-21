/**
 * 会话详情 API
 * 使用 Claude SDK 获取会话信息
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { getSessionInfo, getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { logger, LOG_MODULES } from '@/lib/logger';

// 获取会话详情
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token 并检查权限
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SESSION_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const { payload } = auth;

    const { id: sessionId } = await params;

    logger.access(LOG_MODULES.SESSION, payload, sessionId, { action: 'fetch_info' });

    // 查找关联的项目
    const evaluation = await prisma.evaluationSession.findFirst({
      where: { opencodeSessionId: sessionId },
      include: {
        Project: {
          select: { projectPath: true, userId: true }
        }
      }
    });

    // 用户归属校验：检查项目是否属于当前用户（管理员可访问所有会话）
    if (evaluation?.Project && evaluation.Project.userId !== payload.userId && !isAdmin(payload)) {
      return NextResponse.json({ error: '无权限访问此会话' }, { status: 403 });
    }

    const projectPath = evaluation?.Project?.projectPath;

    // 使用 SDK 获取会话信息
    const sessionInfo = await getSessionInfo(sessionId, projectPath ? { dir: projectPath } : undefined);

    if (!sessionInfo) {
      logger.logNoUser(LOG_MODULES.SESSION, 'Session not found', { details: { sessionId } });
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

    logger.logNoUser(LOG_MODULES.SESSION, 'SDK returned session info', { details: { sessionId, summary: sessionInfo.summary } });

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
    logger.errorNoUser(LOG_MODULES.SESSION, '获取会话详情错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 删除会话
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token 并检查权限
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SESSION_DELETE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const { payload } = auth;

    const { id: sessionId } = await params;

    // 查找关联的评估会话
    const evaluation = await prisma.evaluationSession.findFirst({
      where: { opencodeSessionId: sessionId },
      include: {
        Project: {
          select: { userId: true }
        }
      }
    });

    // 用户归属校验：检查项目是否属于当前用户（管理员可删除所有会话）
    if (evaluation?.Project && evaluation.Project.userId !== payload.userId && !isAdmin(payload)) {
      return NextResponse.json({ error: '无权限删除此会话' }, { status: 403 });
    }

    // 删除评估会话记录（如果存在）
    if (evaluation) {
      await prisma.evaluationSession.delete({
        where: { id: evaluation.id },
      });
      logger.delete(LOG_MODULES.SESSION, payload, sessionId, { evaluationId: evaluation.id });
    }

    return NextResponse.json({ success: true, message: '会话已删除' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, '删除会话错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
