// src/app/api/evaluations/[id]/children/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * 获取评估会话的子Agent列表（从消息中提取 Agent/task 工具调用）
 * GET /api/evaluations/[id]/children
 * 
 * 参数:
 * - nodeId: 可选，按节点过滤
 * - childId: 可选，获取特定子Agent的消息
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
    const { id: evaluationId } = await params;
    const url = new URL(request.url);
    const nodeId = url.searchParams.get('nodeId'); // 可选：按节点过滤
    const childId = url.searchParams.get('childId'); // 可选：获取特定子Agent消息

    logger.access(LOG_MODULES.SESSION, payload, evaluationId, { action: 'fetch_children_by_evaluation', nodeId, childId });

    // 从消息中提取 Agent/task 工具调用
    // FSM模式：nodeId在metadata中；DAG模式：nodeId在workflowNodeId中
    const messages = await prisma.sessionMessage.findMany({
      where: { evaluationSessionId: evaluationId },
      select: {
        id: true,
        role: true,
        content: true,
        workflowNodeId: true,
        metadata: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // 如果有nodeId参数，过滤消息
    let filteredMessages = messages;
    if (nodeId) {
      // 先尝试workflowNodeId（DAG模式）
      const dagMessages = messages.filter(m => m.workflowNodeId === nodeId);
      
      if (dagMessages.length > 0) {
        filteredMessages = dagMessages;
      } else {
        // FSM模式：从metadata.nodeId过滤
        filteredMessages = messages.filter(m => {
          try {
            const meta = m.metadata ? JSON.parse(m.metadata) : {};
            return meta.nodeId === nodeId;
          } catch {
            return false;
          }
        });
      }
    }

    // 如果请求特定子Agent的消息
    if (childId) {
      logger.logNoUser(LOG_MODULES.SESSION, 'Fetching messages for child', { details: { childId } });
      
      // 解析 childId：格式是 `${msgId}-${partId}` 或直接是 msgId
      const msgId = childId.includes('-') ? childId.split('-')[0] : childId;
      
      // 找到 tool_call 消息
      const toolCallMsg = messages.find(m => m.id === msgId);
      
      if (!toolCallMsg) {
        return NextResponse.json({ messages: [], total: 0 });
      }
      
      // 解析 tool_call 消息内容，获取 toolUseId
      let toolCallContent: any = toolCallMsg.content;
      if (typeof toolCallContent === 'string') {
        try {
          toolCallContent = JSON.parse(toolCallContent);
        } catch {
          toolCallContent = { args: {} };
        }
      }
      
      const toolUseId = toolCallContent.toolUseId || toolCallMsg.id;
      
      // 构建子Agent消息列表
      const childMessages: any[] = [];
      
      // 添加 tool_call 消息（用户输入）
      const args = toolCallContent.args || {};
      childMessages.push({
        id: `${childId}-input`,
        role: 'user',
        content: args.prompt || args.description || JSON.stringify(args, null, 2),
        createdAt: toolCallMsg.createdAt?.toISOString(),
      });
      
      // 找到所有相关的 tool_result 消息
      for (const msg of messages) {
        if (msg.role === 'tool_result') {
          let msgContent = msg.content;
          let msgMetadata: any = msg.metadata;
          
          if (typeof msgMetadata === 'string') {
            try {
              msgMetadata = JSON.parse(msgMetadata);
            } catch {
              msgMetadata = { toolUseId: null };
            }
          }
          
          // 检查 metadata 中的 toolUseId 是否匹配
          if (msgMetadata?.toolUseId === toolUseId || msgMetadata?.toolUseId === childId) {
            childMessages.push({
              id: msg.id,
              role: 'assistant',
              content: msgContent,
              createdAt: msg.createdAt?.toISOString(),
              isError: msgMetadata.isError,
            });
          }
        }
      }
      
      logger.logNoUser(LOG_MODULES.SESSION, 'Found messages for child', { details: { childId, count: childMessages.length } });
      
      return NextResponse.json({
        messages: childMessages,
        total: childMessages.length,
        source: 'evaluation',
      });
    }

    // 解析消息中的 Agent/task 工具调用
    const children: Array<{
      id: string;
      workflowNodeId: string | null;
      title: string;
      status: string;
      startedAt: string | null;
      completedAt: string | null;
      type: string;
    }> = [];

    for (const msg of messages) {
      try {
        // 解析消息内容
        let content = msg.content;
        if (typeof content === 'string') {
          try {
            content = JSON.parse(content);
          } catch {
            continue;
          }
        }

        // 处理数组形式的内容
        const parts = Array.isArray(content) ? content : [content];
        
        for (const part of parts) {
          if (!part || typeof part !== 'object') continue;
          
          // 检查是否是 Agent 或 task 工具调用
          if (part.type === 'tool_use' && (part.name === 'Agent' || part.name === 'task')) {
            const args = part.input || part.args || {};
            const description = args.description || 
                               args.prompt?.substring(0, 100) || 
                               args.category || 
                               `子任务 ${children.length + 1}`;
            
            children.push({
              id: `${msg.id}-${part.id || children.length}`,
              workflowNodeId: msg.workflowNodeId,
              title: description.substring(0, 100),
              status: 'active',
              startedAt: msg.createdAt?.toISOString() || null,
              completedAt: null,
              type: part.name,
            });
          }
          
          // 也检查 role === 'tool_call' 的情况
          if (msg.role === 'tool_call' && (part.name === 'Agent' || part.name === 'task')) {
            const args = part.input || part.args || {};
            const description = args.description || 
                               args.prompt?.substring(0, 100) || 
                               args.category || 
                               `子任务 ${children.length + 1}`;
            
            // 避免重复添加
            const exists = children.some(c => c.id === msg.id);
            if (!exists) {
              children.push({
                id: msg.id,
                workflowNodeId: msg.workflowNodeId,
                title: description.substring(0, 100),
                status: 'active',
                startedAt: msg.createdAt?.toISOString() || null,
                completedAt: null,
                type: part.name,
              });
            }
          }
        }
      } catch {
        // 解析失败，跳过
      }
    }

    logger.logNoUser(LOG_MODULES.SESSION, 'Found children for evaluation', { 
      details: { evaluationId, count: children.length } 
    });

    return NextResponse.json({
      children,
      total: children.length,
      source: 'evaluation',
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, 'Children API error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
