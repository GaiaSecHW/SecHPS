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
      
      // 找到对应的 Agent 调用消息
      let toolCallMsg = null;
      let toolUseId = null;
      
      for (const msg of messages) {
        if (msg.role === 'tool_call' && msg.id === childId) {
          toolCallMsg = msg;
          break;
        }
      }
      
      // 如果没找到，可能是 toolUseId 或在 children 列表中
      if (!toolCallMsg) {
        const child = children.find(c => c.toolUseId === childId || c.id === childId);
        if (child) {
          toolCallMsg = messages.find(m => m.id === child.id);
          toolUseId = child.toolUseId;
        }
      }
      
      if (!toolCallMsg) {
        return NextResponse.json({ messages: [], total: 0 });
      }
      
      // 解析 Agent 调用内容
      let toolCallContent = toolCallMsg.content;
      if (typeof toolCallContent === 'string') {
        try { toolCallContent = JSON.parse(toolCallContent); } catch { toolCallContent = {}; }
      }
      
      toolUseId = toolUseId || toolCallContent.toolUseId || childId;
      const agentStartTime = toolCallMsg.createdAt?.toISOString();
      
      // 找到对应的最终 tool_result（获取结束时间）
      const finalResult = messages.find(m => {
        if (m.role !== 'tool_result') return false;
        let meta = m.metadata;
        if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { return false; } }
        return meta?.toolUseId === toolUseId;
      });
      
      const agentEndTime = finalResult?.createdAt?.toISOString();
      
      logger.logNoUser(LOG_MODULES.SESSION, 'Agent execution period', { 
        details: { childId, toolUseId, startTime: agentStartTime, endTime: agentEndTime }
      });
      
      // 构建子Agent消息列表：显示执行时间范围内的所有消息
      const childMessages: any[] = [];
      
      // 1. 添加 Agent 调用（用户输入）
      const args = toolCallContent.args || toolCallContent.input || {};
      childMessages.push({
        id: `${childId}-input`,
        role: 'user',
        content: args.prompt || args.description || JSON.stringify(args, null, 2),
        createdAt: agentStartTime,
        isAgentCall: true,
        toolUseId: toolUseId,
      });
      
      // 2. 添加执行时间范围内的所有消息（thinking, tool_call, assistant_chunk, tool_result）
      if (agentStartTime && agentEndTime) {
        const startMs = new Date(agentStartTime).getTime();
        const endMs = new Date(agentEndTime).getTime();
        
        for (const msg of messages) {
          const msgTime = new Date(msg.createdAt).getTime();
          
          // 只取时间范围内的消息
          if (msgTime >= startMs && msgTime <= endMs) {
            // 排除 Agent 调用本身和最终的汇总结果（已经单独处理）
            if (msg.id === toolCallMsg.id || msg.id === finalResult?.id) continue;
            
            // 解析 content
            let content = msg.content;
            if (typeof content === 'string') {
              try { content = JSON.parse(content); } catch { /* keep as string */ }
            }
            
            // 解析 metadata
            let metadata = msg.metadata;
            if (typeof metadata === 'string') {
              try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
            }
            
            childMessages.push({
              id: msg.id,
              role: msg.role,
              content: typeof content === 'object' ? JSON.stringify(content, null, 2) : content,
              createdAt: msg.createdAt?.toISOString(),
              isError: metadata?.isError,
              toolUseId: metadata?.toolUseId,
            });
          }
        }
      }
      
      // 3. 添加最终的汇总结果
      if (finalResult) {
        childMessages.push({
          id: finalResult.id,
          role: 'tool_result',
          content: finalResult.content,
          createdAt: finalResult.createdAt?.toISOString(),
          isFinalResult: true,
          toolUseId: toolUseId,
        });
      }
      
      // 按时间排序
      childMessages.sort((a, b) => {
        const timeA = new Date(a.createdAt).getTime();
        const timeB = new Date(b.createdAt).getTime();
        return timeA - timeB;
      });
      
      logger.logNoUser(LOG_MODULES.SESSION, 'Found messages for child', { 
        details: { childId, count: childMessages.length, periodMessages: childMessages.length - 2 }
      });
      
      return NextResponse.json({
        messages: childMessages,
        total: childMessages.length,
        periodMessages: childMessages.length - 2, // 执行期间的中间消息数量
        source: 'evaluation',
      });
    }

    // 解析消息中的 Agent/task 工具调用
    const children: Array<{
      id: string;
      toolUseId: string;  // 实际的 toolUseId，用于匹配 tool_result
      workflowNodeId: string | null;
      title: string;
      status: string;
      startedAt: string | null;
      completedAt: string | null;
      type: string;
    }> = [];

    // 收集所有 tool_result 的 toolUseId，用于确定子Agent是否完成
    const toolResultMap: Record<string, { completedAt: string; isError: boolean }> = {};
    for (const msg of messages) {
      if (msg.role === 'tool_result') {
        let meta = msg.metadata;
        if (typeof meta === 'string') {
          try { meta = JSON.parse(meta); } catch { continue; }
        }
        if (meta?.toolUseId && meta.toolUseId !== 'unknown') {
          toolResultMap[meta.toolUseId] = {
            completedAt: msg.createdAt?.toISOString() || null,
            isError: meta.isError || false,
          };
        }
      }
    }

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
          if (msg.role === 'tool_call' && (part.name === 'Agent' || part.name === 'task')) {
            const args = part.input || part.args || {};
            const description = args.description || 
                               args.prompt?.substring(0, 100) || 
                               args.category || 
                               `子任务 ${children.length + 1}`;
            
            // 使用 content 里的 toolUseId，而不是 msg.id
            const toolUseId = part.toolUseId || msg.id;
            
            // 检查是否有对应的 tool_result
            const result = toolResultMap[toolUseId];
            const status = result ? (result.isError ? 'failed' : 'completed') : 'active';
            const completedAt = result?.completedAt || null;
            
            // 避免重复添加
            const exists = children.some(c => c.toolUseId === toolUseId);
            if (!exists) {
              children.push({
                id: msg.id,  // 保留 msgId 用于获取消息详情
                toolUseId: toolUseId,  // 用于匹配 tool_result
                workflowNodeId: msg.workflowNodeId,
                title: description.substring(0, 100),
                status: status,
                startedAt: msg.createdAt?.toISOString() || null,
                completedAt: completedAt,
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
