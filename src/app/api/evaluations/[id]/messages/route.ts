// src/app/api/evaluations/[id]/messages/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { isAdmin } from '@/lib/api-auth';
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/evaluations/[id]/messages - 获取评估会话的消息列表
// 数据隔离：普通用户只能查看自己项目评估的消息，管理员可以查看所有
// 支持按 workflowNodeId 过滤（从数据库查询）
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

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 检查评估会话是否存在，并验证所有权
    let where: any = { id };
    
    const evaluation = await prisma.evaluationSession.findFirst({
      where,
      include: {
        Project: {
          select: {
            id: true,
            projectPath: true,
            userId: true,
          },
        },
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 归属校验（管理员绕过）
    if (!userIsAdmin && evaluation.Project.userId !== payload.userId) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 解析 URL 参数获取分页信息
    const url = new URL(request.url);
    const limitParam = url.searchParams.get('limit');
    const offsetParam = url.searchParams.get('offset');
    const startTimeParam = url.searchParams.get('startTime');
    const endTimeParam = url.searchParams.get('endTime');
    const sourceParam = url.searchParams.get('source'); // 'db' | 'sdk' | 'auto'
    const nodeIdParam = url.searchParams.get('nodeId'); // 按节点 ID 过滤
    
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    const offset = offsetParam ? parseInt(offsetParam, 10) : 0;
    const startTime = startTimeParam ? new Date(startTimeParam) : null;
    const endTime = endTimeParam ? new Date(endTimeParam) : null;

    // 如果指定了 source=db，从数据库查询（支持 nodeId 过滤）
    if (sourceParam === 'db') {
      return await getMessagesFromDB(id, nodeIdParam, limit, offset);
    }

    // 否则从 SDK 获取消息（原有逻辑）
    if (!evaluation.opencodeSessionId) {
      logger.debug(LOG_MODULES.EVALUATION, '评估会话没有 opencodeSessionId:', { details: { id } });
      return NextResponse.json({
        messages: [],
        total: 0,
        hasMore: false,
        offset: 0,
        limit: null,
      });
    }

    const sessionId = evaluation.opencodeSessionId;
    const projectPath = evaluation.Project?.projectPath;

    logger.debug(LOG_MODULES.EVALUATION, '使用 SDK getSessionMessages:', { details: { sessionId } });

    // 使用 SDK 获取消息
    const sdkMessages = await getSessionMessages(sessionId, {
      dir: projectPath ?? undefined,
    });

    logger.debug(LOG_MODULES.EVALUATION, 'SDK 返回结果:', { details: {
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
    } });

    // 转换消息格式为前端期望的统一格式
    const formattedMessages = sdkMessages.map((msg: any, index: number) => {
      // 详细日志前3条消息
      if (index < 3) {
        logger.debug(LOG_MODULES.EVALUATION, `消息 ${index}:`, { details: {
          type: msg.type,
          role: msg.role,
          uuid: msg.uuid,
          messageId: msg.message?.id,
          hasMessage: !!msg.message,
          hasContent: !!msg.message?.content,
          contentLength: Array.isArray(msg.message?.content) ? msg.message.content.length : 0,
        } });
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

    // 应用时间范围过滤（用于节点关联）
    let filteredMessages = formattedMessages;
    
    if (startTime && endTime) {
      filteredMessages = formattedMessages.filter((msg: any) => {
        const msgTime = new Date(msg.createdAt);
        return msgTime >= startTime && msgTime <= endTime;
      });
      logger.debug(LOG_MODULES.EVALUATION, '时间范围过滤:', { details: {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        beforeCount: formattedMessages.length,
        afterCount: filteredMessages.length,
      } });
    }
    
    // 应用分页
    const total = filteredMessages.length;
    const paginatedMessages = limit
      ? filteredMessages.slice(offset, offset + limit)
      : filteredMessages.slice(offset);
    const hasMore = limit ? offset + limit < total : false;

    logger.debug(LOG_MODULES.EVALUATION, '返回格式化消息:', { details: {
      formattedCount: paginatedMessages.length,
      total,
      firstMessageId: paginatedMessages[0]?.id,
      lastMessageId: paginatedMessages[paginatedMessages.length - 1]?.id,
    } });

    return NextResponse.json({
      messages: paginatedMessages,
      total,
      hasMore,
      offset,
      limit: limit || null,
      source: 'sdk',
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.EVALUATION, '获取评估消息错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * 从数据库查询消息
 * FSM 模式：nodeId 保存在 metadata.nodeId 中，需要在内存中过滤
 * DAG 模式：nodeId 保存在 workflowNodeId 字段，可以直接查询
 */
async function getMessagesFromDB(
  evaluationId: string,
  nodeId: string | null,
  limit: number | undefined,
  offset: number
): Promise<Response> {
  try {
    // 构建查询条件
    const where: any = {
      evaluationSessionId: evaluationId,
    };
    
    // DAG 模式：直接使用 workflowNodeId 过滤
    // FSM 模式：不设置 workflowNodeId，后续从 metadata.nodeId 过滤
    let isFSMMode = false;
    
    if (nodeId) {
      // 检查 nodeId 是否存在于 WorkflowNode 表（DAG 模式）
      const workflowNodeExists = await prisma.workflowNode.findUnique({
        where: { id: nodeId },
        select: { id: true },
      });
      
      if (workflowNodeExists) {
        // DAG 模式：使用 workflowNodeId 外键
        where.workflowNodeId = nodeId;
      } else {
        // FSM 模式：从 metadata 中过滤
        isFSMMode = true;
      }
    }

    // FSM 模式需要获取更多消息用于内存过滤
    const queryLimit = isFSMMode ? 1000 : limit;
    const queryOffset = isFSMMode ? 0 : offset;

    // 查询消息列表
    const messages = await prisma.sessionMessage.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip: queryOffset,
      take: queryLimit,
    });

    // FSM 模式：从 metadata.nodeId 过滤
    let filteredMessages = messages;
    if (isFSMMode && nodeId) {
      filteredMessages = messages.filter((msg) => {
        try {
          const metadata = msg.metadata ? JSON.parse(msg.metadata) : {};
          return metadata.nodeId === nodeId;
        } catch {
          return false;
        }
      });
      // 应用分页
      if (limit) {
        filteredMessages = filteredMessages.slice(offset, offset + limit);
      }
    }

    const total = isFSMMode ? filteredMessages.length : await prisma.sessionMessage.count({ where });
    const hasMore = limit ? offset + limit < total : false;

    // 格式化消息
    const formattedMessages = filteredMessages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt.toISOString(),
      workflowNodeId: msg.workflowNodeId,
      metadata: msg.metadata ? JSON.parse(msg.metadata) : null,
      // 从 metadata 中提取 nodeId（用于前端显示）
      nodeId: msg.metadata ? (JSON.parse(msg.metadata).nodeId || msg.workflowNodeId) : msg.workflowNodeId,
    }));

    logger.debug(LOG_MODULES.EVALUATION, '从数据库返回消息:', { details: {
      nodeId,
      total,
      count: formattedMessages.length,
      source: 'db',
      fsmMode: isFSMMode,
    } });

    return NextResponse.json({
      messages: formattedMessages,
      total,
      hasMore,
      offset,
      limit: limit || null,
      source: 'db',
      nodeId,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.EVALUATION, '从数据库获取消息错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}