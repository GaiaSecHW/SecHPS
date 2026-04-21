// src/app/api/sessions/[id]/children/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { getSessionMessages, listSubagents, getSubagentMessages } from '@anthropic-ai/claude-agent-sdk';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * 获取会话的子代理列表
 * GET /api/sessions/[id]/children
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  try {
    const { id: sessionId } = await params;
    const url = new URL(request.url);
    const childId = url.searchParams.get('childId'); // 获取子会话ID

    logger.access(LOG_MODULES.SESSION, payload, sessionId, { action: 'fetch_children', childId });

    // 查找关联的项目
    const evaluation = await prisma.evaluationSession.findFirst({
      where: { opencodeSessionId: sessionId },
      include: {
        Project: {
          select: { projectPath: true }
        }
      }
    });

    const projectPath = evaluation?.Project?.projectPath;

    // 如果请求子会话消息
    if (childId) {
      logger.logNoUser(LOG_MODULES.SESSION, 'Fetching messages for child', { details: { sessionId, childId } });
      
      try {
        let messages: any[] = [];
        
        if (projectPath) {
          // 使用 SDK 获取子会话消息
          messages = await getSubagentMessages(sessionId, childId, { dir: projectPath });
          logger.logNoUser(LOG_MODULES.SESSION, 'SDK returned messages for child', { details: { sessionId, childId, count: messages.length } });
        }
        
        return NextResponse.json({
          messages,
          total: messages.length,
        });
      } catch (error) {
        logger.errorWithUser(LOG_MODULES.SESSION, payload, 'Failed to get child messages', childId, { details: { sessionId, error: error instanceof Error ? error.message : String(error) } });
        return NextResponse.json({ 
          messages: [], 
          total: 0,
          error: 'Failed to fetch child messages' 
        });
      }
    }

    // 方法1: 尝试使用 SDK 获取子代理列表
    let subagentIds: string[] = [];
    try {
      subagentIds = await listSubagents(sessionId, projectPath ? { dir: projectPath } : undefined);
      logger.logNoUser(LOG_MODULES.SESSION, 'SDK returned subagents', { details: { sessionId, count: subagentIds.length } });
    } catch (error) {
      logger.warn(LOG_MODULES.SESSION, 'SDK listSubagents failed', { details: { sessionId, error: error instanceof Error ? error.message : String(error) } });
    }

    // 方法2: 如果 SDK 没有返回，从消息中提取 Agent/task 工具调用
    if (subagentIds.length === 0 && projectPath) {
      logger.logNoUser(LOG_MODULES.SESSION, 'Trying to extract subagents from messages', { details: { sessionId } });
      try {
        const messages = await getSessionMessages(sessionId, { dir: projectPath });
        
        // 提取所有 Agent 或 task 工具调用
        const agentCalls: Array<{
          id: string;
          messageId: string;
          messageIndex: number;
          description: string;
          status: string;
          startedAt: string | null;
          completedAt: string | null;
        }> = [];

        // 建立 tool_use id -> tool_result 的映射，用于提取结束时间
        const toolResultMap = new Map<string, { timestamp: string | null }>();
        messages.forEach((msg: any) => {
          if (msg.message?.content && Array.isArray(msg.message.content)) {
            msg.message.content.forEach((part: any) => {
              if (part.type === 'tool_result' && part.tool_use_id) {
                toolResultMap.set(part.tool_use_id, {
                  timestamp: msg.message?.timestamp || msg.timestamp || null,
                });
              }
            });
          }
        });

        messages.forEach((msg: any, msgIndex: number) => {
          if (msg.message?.content && Array.isArray(msg.message.content)) {
            msg.message.content.forEach((part: any) => {
              if (part.type === 'tool_use' && (part.name === 'Agent' || part.name === 'task')) {
                const description = part.input?.description ||
                                   part.input?.prompt?.substring(0, 100) ||
                                   `子任务 ${msgIndex + 1}`;

                // 提取开始时间（工具调用所在消息的时间戳）
                const startedAt = msg.message?.timestamp || msg.timestamp || null;
                // 提取结束时间（对应 tool_result 消息的时间戳）
                const resultInfo = toolResultMap.get(part.id);
                const completedAt = resultInfo?.timestamp || null;

                agentCalls.push({
                  id: part.id || `agent-${msgIndex}-${Date.now()}`,
                  messageId: msg.uuid || `msg-${msgIndex}`,
                  messageIndex: msgIndex,
                  description: description.substring(0, 100),
                  status: 'active',
                  startedAt,
                  completedAt,
                });
              }
            });
          }
        });

        logger.logNoUser(LOG_MODULES.SESSION, 'Found agent calls from messages', { details: { sessionId, count: agentCalls.length } });

        // 转换为前端期望的格式
        const children = agentCalls.map(call => ({
          id: call.id,
          sessionId: sessionId,
          messageId: call.messageId,
          messageIndex: call.messageIndex,
          title: call.description,
          status: call.status,
          startedAt: call.startedAt,
          completedAt: call.completedAt,
        }));

        // 不在此处获取第一条消息时间，避免阻塞 API 响应
        // 前端在点击展开子任务时会调用 fetchChildSessionMessages 获取消息并更新 startedAt

        return NextResponse.json({
          children,
          total: children.length,
          source: 'messages',
        });
      } catch (error) {
        logger.errorWithUser(LOG_MODULES.SESSION, payload, 'Failed to extract from messages', sessionId, { details: { error: error instanceof Error ? error.message : String(error) } });
      }
    }

    // 方法3: 如果都失败了，返回空列表
    const children = subagentIds.map(agentId => ({
      id: agentId,
      sessionId: sessionId,
      title: `子任务 ${agentId.substring(0, 8)}`,
      status: 'active',
    }));

    return NextResponse.json({
      children,
      total: children.length,
      source: 'sdk',
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, 'Children API error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
