// src/app/api/messages/[id]/route.ts
// 数据隔离：普通用户只能查看自己项目评估的消息，管理员可以查看所有

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';
import { createEvaluationMessageStore, EvaluationMessage } from '@/services/evaluation-message-store';

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
    const sessionId = searchParams.get('sessionId');

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 首先查找消息所属的 evaluationSession（用于获取 projectId）
    // 构建查询条件
    let where: any = { id };
    if (!userIsAdmin) {
      // 普通用户：通过 SessionMessage.EvaluationSession.Project.userId 验证所有权
      where.EvaluationSession = { Project: { userId: payload.userId } };
    }

    // 先查找消息以获取 evaluationSessionId
    const messageWithSession = await prisma.sessionMessage.findFirst({
      where: { id },
      select: {
        evaluationSessionId: true,
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

    // 尝试从 JSONL 读取
    try {
      const store = createEvaluationMessageStore(projectId, evaluationId);
      if (await store.exists()) {
        const jsonlMessage = await store.getMessageById(id);
        
        if (jsonlMessage) {
          logger.debug(LOG_MODULES.SESSION, '从 JSONL 获取消息:', { details: { messageId: id, source: 'jsonl' } });
          
          // 解析 content
          let parsedContent;
          if (typeof jsonlMessage.content === 'string') {
            try {
              parsedContent = JSON.parse(jsonlMessage.content);
            } catch {
              parsedContent = [{ type: 'text', text: jsonlMessage.content }];
            }
          } else if (Array.isArray(jsonlMessage.content)) {
            parsedContent = jsonlMessage.content;
          } else {
            parsedContent = [{ type: 'text', text: JSON.stringify(jsonlMessage.content) }];
          }
          
          return NextResponse.json({
            message: {
              id: jsonlMessage.id,
              role: jsonlMessage.role,
              content: parsedContent,
              metadata: {
                nodeId: jsonlMessage.nodeId,
                nodeIndex: jsonlMessage.nodeIndex,
                agentCallMsgId: jsonlMessage.agentCallMsgId,
                toolName: jsonlMessage.toolName,
                toolUseId: jsonlMessage.toolUseId,
                toolInput: jsonlMessage.toolInput,
                toolResult: jsonlMessage.toolResult,
              },
              createdAt: jsonlMessage.timestamp,
              session: {
                id: evaluationId,
                opencodeSessionId: messageWithSession.EvaluationSession.opencodeSessionId,
                status: messageWithSession.EvaluationSession.status,
              },
            },
            source: 'jsonl',
          });
        }
      }
    } catch (jsonlError) {
      logger.warn(LOG_MODULES.SESSION, 'JSONL 读取失败，fallback 到 Prisma:', { details: { error: String(jsonlError) } });
    }

    // Fallback: 从 Prisma 读取
    logger.debug(LOG_MODULES.SESSION, '从 Prisma 获取消息:', { details: { messageId: id, source: 'db' } });
    
    // 查找消息
    const message = await prisma.sessionMessage.findFirst({
      where,
      include: {
        EvaluationSession: {
          select: {
            id: true,
            opencodeSessionId: true,
            status: true,
          },
        },
      },
    });

    if (!message) {
      return NextResponse.json({ error: '消息不存在' }, { status: 404 });
    }

    // 如果提供了 sessionId，验证消息属于该会话
    // sessionId 可能是 evaluationSession.id 或 opencodeSessionId
    if (sessionId) {
      const belongsToSession =
        message.EvaluationSession.id === sessionId ||
        (message.EvaluationSession.opencodeSessionId && message.EvaluationSession.opencodeSessionId === sessionId);

      if (!belongsToSession) {
        return NextResponse.json({ error: '消息不属于该会话' }, { status: 403 });
      }
    }

    // 解析 content（存储为 JSON 字符串）
    let parsedContent;
    try {
      parsedContent = JSON.parse(message.content);
    } catch {
      // 如果不是 JSON，作为纯文本处理
      parsedContent = [{ type: 'text', text: message.content }];
    }

    // 解析 metadata
    let parsedMetadata = null;
    if (message.metadata) {
      try {
        parsedMetadata = JSON.parse(message.metadata);
      } catch {
        parsedMetadata = message.metadata;
      }
    }

    return NextResponse.json({
      message: {
        id: message.id,
        role: message.role,
        content: parsedContent,
        metadata: parsedMetadata,
        createdAt: message.createdAt,
        session: message.EvaluationSession,
      },
      source: 'db',
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, '获取消息错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}