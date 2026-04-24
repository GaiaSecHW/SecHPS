// src/app/api/messages/[id]/route.ts
// 数据隔离：普通用户只能查看自己项目评估的消息，管理员可以查看所有
// 新架构：SessionMessage 只存索引，从 NodeStreamStore 读取内容

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';
import { createNodeStreamStore } from '@/services/node-stream-store';

// GET /api/messages/[id] - 获取消息详情
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const nodeId = searchParams.get('nodeId');
    const eventIndex = searchParams.get('eventIndex');

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 先查找消息以获取 evaluationSessionId 和 projectId
    const messageWithSession = await prisma.sessionMessage.findFirst({
      where: { id },
      select: {
        id: true,
        evaluationSessionId: true,
        workflowNodeId: true,
        role: true,
        messageRef: true,
        createdAt: true,
        EvaluationSession: {
          select: {
            id: true,
            projectId: true,
            opencodeSessionId: true,
            status: true,
            Project: {
              select: { userId: true },
            },
          },
        },
      },
    });

    if (!messageWithSession) {
      return NextResponse.json({ error: '消息不存在' }, { status: 404 });
    }

    // 归属校验（管理员绕过）
    if (!userIsAdmin && messageWithSession.EvaluationSession.Project.userId !== payload.userId) {
      return NextResponse.json({ error: '消息不存在' }, { status: 404 });
    }

    const evaluationId = messageWithSession.evaluationSessionId;
    const projectId = messageWithSession.EvaluationSession.projectId;
    const messageNodeId = messageWithSession.workflowNodeId || nodeId;

    // 如果没有 nodeId，无法从 stream.jsonl 读取
    if (!messageNodeId) {
      return NextResponse.json({
        message: {
          id: messageWithSession.id,
          role: messageWithSession.role,
          content: null,
          messageRef: messageWithSession.messageRef,
          createdAt: messageWithSession.createdAt.toISOString(),
          session: {
            id: evaluationId,
            opencodeSessionId: messageWithSession.EvaluationSession.opencodeSessionId,
            status: messageWithSession.EvaluationSession.status,
          },
        },
        source: 'index',
        note: '需要 nodeId 参数从 stream.jsonl 读取内容',
      });
    }

    // 从 NodeStreamStore 读取
    try {
      const store = createNodeStreamStore(projectId, evaluationId);
      const events = await store.readStream(messageNodeId);
      
      // 如果有 eventIndex，直接返回该事件
      if (eventIndex) {
        const index = parseInt(eventIndex);
        const event = events[index];
        
        if (event) {
          return NextResponse.json({
            message: {
              id: `${messageNodeId}-${index}`,
              role: event.event === 'user' ? 'user' :
                    event.event === 'text' || event.event === 'thinking' ? 'assistant' :
                    event.event === 'tool_use' ? 'tool_call' :
                    event.event === 'tool_result' ? 'tool_result' :
                    event.event,
              content: event.data,
              createdAt: event.timestamp,
              event: event.event,
              nodeId: messageNodeId,
              session: {
                id: evaluationId,
                opencodeSessionId: messageWithSession.EvaluationSession.opencodeSessionId,
                status: messageWithSession.EvaluationSession.status,
              },
            },
            source: 'stream',
            nodeId: messageNodeId,
            eventIndex: index,
          });
        }
      }
      
      // 否则返回节点所有消息
      const messages = events.map((event, index) => ({
        id: `${messageNodeId}-${index}`,
        role: event.event === 'user' ? 'user' :
              event.event === 'text' || event.event === 'thinking' ? 'assistant' :
              event.event === 'tool_use' ? 'tool_call' :
              event.event === 'tool_result' ? 'tool_result' :
              event.event,
        content: event.data,
        createdAt: event.timestamp,
        event: event.event,
        nodeId: messageNodeId,
      }));
      
      return NextResponse.json({
        messages,
        total: messages.length,
        source: 'stream',
        nodeId: messageNodeId,
        session: {
          id: evaluationId,
          opencodeSessionId: messageWithSession.EvaluationSession.opencodeSessionId,
          status: messageWithSession.EvaluationSession.status,
        },
      });
    } catch (streamError) {
      logger.warn(LOG_MODULES.SESSION, '从 stream.jsonl 读取失败:', { details: { error: String(streamError) } });
      
      return NextResponse.json({
        message: {
          id: messageWithSession.id,
          role: messageWithSession.role,
          content: null,
          messageRef: messageWithSession.messageRef,
          createdAt: messageWithSession.createdAt.toISOString(),
          session: {
            id: evaluationId,
            opencodeSessionId: messageWithSession.EvaluationSession.opencodeSessionId,
            status: messageWithSession.EvaluationSession.status,
          },
        },
        source: 'index',
        error: '无法从 stream.jsonl 读取内容',
      });
    }
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, '获取消息错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}