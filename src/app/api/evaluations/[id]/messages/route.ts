// src/app/api/evaluations/[id]/messages/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';

// GET /api/evaluations/[id]/messages - 获取评估会话的消息列表
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

    const { id } = await params;

    // 检查评估会话是否存在，并获取关联的项目信息
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      include: {
        Project: {
          select: {
            id: true,
            projectPath: true,
          },
        },
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    if (!evaluation.opencodeSessionId) {
      console.log('[API Messages] No opencodeSessionId for evaluation:', id);
      return NextResponse.json({
        messages: [],
        total: 0,
        hasMore: false,
        offset: 0,
        limit: null,
      });
    }

    // 解析 URL 参数获取分页信息
    const url = new URL(request.url);
    const limitParam = url.searchParams.get('limit');
    const offsetParam = url.searchParams.get('offset');
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    const offset = offsetParam ? parseInt(offsetParam, 10) : 0;

    const sessionId = evaluation.opencodeSessionId;
    const projectPath = evaluation.Project?.projectPath;

    console.log(`[API Messages] Using SDK getSessionMessages for session:`, sessionId);

    // 使用 SDK 获取消息
    const sdkMessages = await getSessionMessages(sessionId, {
      dir: projectPath ?? undefined,
    });

    console.log(`[API Messages] SDK returned:`, {
      sessionId,
      messagesCount: sdkMessages.length,
      firstThreeMessages: sdkMessages.slice(0, 3).map((msg: any) => ({
        type: msg.type,
        role: msg.role,
        id: msg.id || msg.session_id,
        hasContent: !!msg.content,
        hasMessage: !!msg.message,
        contentKeys: msg.content ? Object.keys(msg.content) : null,
        messageKeys: msg.message ? Object.keys(msg.message) : null,
      })),
    });

    // 转换消息格式为前端期望的统一格式
    const formattedMessages = sdkMessages.map((msg: any, index: number) => {
      // 详细日志前3条消息
      if (index < 3) {
        console.log(`[API Messages] Message ${index}:`, {
          type: msg.type,
          role: msg.role,
          uuid: msg.uuid,
          messageId: msg.message?.id,
          hasMessage: !!msg.message,
          hasContent: !!msg.message?.content,
          contentLength: Array.isArray(msg.message?.content) ? msg.message.content.length : 0,
        });
      }

      // SDK返回的消息格式：
      // { type: 'user'|'assistant', uuid: '...', message: { role: 'user'|'assistant', content: [...], id: '...' } }
      
      // 提取角色
      let role: 'user' | 'assistant' = msg.type || msg.message?.role || 'assistant';
      
      // 提取ID
      let id = msg.message?.id || msg.uuid || `msg-${Date.now()}-${index}`;
      
      // 提取内容
      let content: string | Array<any> = '';
      
      // SDK的消息内容在 message.content 数组中
      if (msg.message?.content) {
        if (Array.isArray(msg.message.content)) {
          // 保留完整的 content 数组，前端自己处理显示
          content = msg.message.content;
        } else if (typeof msg.message.content === 'string') {
          content = msg.message.content;
        } else {
          content = JSON.stringify(msg.message.content, null, 2);
        }
      } else if (msg.content) {
        // 备用：直接在根级别的 content
        if (Array.isArray(msg.content)) {
          content = msg.content;
        } else {
          content = msg.content;
        }
      }

      return {
        id,
        role,
        content,
        createdAt: msg.timestamp || new Date().toISOString(),
        // 保留原始信息供详情查看
        raw: {
          type: msg.type,
          uuid: msg.uuid,
          session_id: msg.session_id,
          message: msg.message,
        },
      };
    });

    // 应用分页
    const total = formattedMessages.length;
    const paginatedMessages = limit
      ? formattedMessages.slice(offset, offset + limit)
      : formattedMessages.slice(offset);
    const hasMore = limit ? offset + limit < total : false;

    console.log(`[API Messages] Returning formatted messages:`, {
      formattedCount: paginatedMessages.length,
      total,
      firstMessageId: paginatedMessages[0]?.id,
      lastMessageId: paginatedMessages[paginatedMessages.length - 1]?.id,
    });

    return NextResponse.json({
      messages: paginatedMessages,
      total,
      hasMore,
      offset,
      limit: limit || null,
    });
  } catch (error) {
    console.error('Get evaluation messages error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
