// src/app/api/evaluations/[id]/children/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';
import { createNodeStreamStore } from '@/services/node-stream-store';

/**
 * 获取评估会话的子Agent列表（从 stream.jsonl 解析 Agent/task 工具调用）
 * GET /api/evaluations/[id]/children
 * 
 * 参数:
 * - nodeId: 必须，按节点过滤
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
    const nodeId = url.searchParams.get('nodeId'); // 必须：按节点过滤
    const childId = url.searchParams.get('childId'); // 可选：获取特定子Agent消息

    logger.access(LOG_MODULES.SESSION, payload, evaluationId, { action: 'fetch_children_by_evaluation', nodeId, childId });

    // 获取 evaluationSession 以获取 projectId
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id: evaluationId },
      select: { projectId: true },
    });
    
    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }
    
    const projectId = evaluation.projectId;

    // 必须指定 nodeId
    if (!nodeId) {
      return NextResponse.json({ children: [], total: 0, source: 'stream' });
    }

    const store = createNodeStreamStore(projectId, evaluationId);

    // 如果请求特定子Agent的消息
    if (childId) {
      logger.logNoUser(LOG_MODULES.SESSION, 'Fetching messages for child', { details: { childId, nodeId } });
      
      // 尝试从 agent 流文件读取
      try {
        const agentEvents = await store.readAgentStream(nodeId, childId);
        
        if (agentEvents.length > 0) {
          // 格式化子Agent消息
          const childMessages = agentEvents.map((event, index) => ({
            id: `${childId}-${index}`,
            role: event.event === 'user' ? 'user' :
                  event.event === 'text' || event.event === 'thinking' ? 'assistant' :
                  event.event === 'tool_use' ? 'tool_call' :
                  event.event === 'tool_result' ? 'tool_result' :
                  event.event,
            content: typeof event.data === 'string' ? event.data : JSON.stringify(event.data),
            createdAt: event.timestamp,
            event: event.event,
            agentId: event.agentId,
          }));
          
          return NextResponse.json({
            messages: childMessages,
            total: childMessages.length,
            source: 'agent_stream',
            nodeId,
            agentId: childId,
          });
        }
      } catch (error) {
        logger.warn(LOG_MODULES.SESSION, '从 agent 流读取失败', { details: { error: String(error) } });
      }
      
      // 如果 agent 流文件不存在，从主节点流中查找
      const events = await store.readStream(nodeId);
      
      // 找到 agent_launched 事件
      const agentLaunched = events.find(e => 
        e.event === 'agent_launched' && e.data?.agentId === childId
      );
      
      if (!agentLaunched) {
        return NextResponse.json({ messages: [], total: 0 });
      }
      
      const toolUseId = agentLaunched.data?.toolUseId;
      const agentStartTime = agentLaunched.timestamp;
      
      // 找到对应的 tool_result（获取结束时间）
      const finalResult = events.find(e =>
        e.event === 'tool_result' && e.data?.toolUseId === toolUseId
      );
      
      const agentEndTime = finalResult?.timestamp;
      
      // 构建子Agent消息列表
      const childMessages: any[] = [];
      
      // 1. 添加 Agent 调用（用户输入）
      const args = agentLaunched.data?.args || {};
      childMessages.push({
        id: `${childId}-input`,
        role: 'user',
        content: args.prompt || args.description || JSON.stringify(args, null, 2),
        createdAt: agentStartTime,
        isAgentCall: true,
        toolUseId: toolUseId,
        agentId: childId,
      });
      
      // 2. 添加执行时间范围内的消息
      if (agentStartTime && agentEndTime) {
        const startMs = new Date(agentStartTime).getTime();
        const endMs = new Date(agentEndTime).getTime();
        
        for (const event of events) {
          if (!event.timestamp) continue;
          const eventTime = new Date(event.timestamp).getTime();
          
          if (eventTime >= startMs && eventTime <= endMs) {
            // 排除 agent_launched 本身
            if (event.event === 'agent_launched') continue;
            
            childMessages.push({
              id: `msg-${eventTime}-${childMessages.length}`,
              role: event.event === 'text' || event.event === 'thinking' ? 'assistant' :
                    event.event === 'tool_use' ? 'tool_call' :
                    event.event === 'tool_result' ? 'tool_result' :
                    event.event,
              content: typeof event.data === 'string' ? event.data : JSON.stringify(event.data),
              createdAt: event.timestamp,
              event: event.event,
              agentId: childId,
            });
          }
        }
      }
      
      // 3. 添加最终的汇总结果
      if (finalResult) {
        childMessages.push({
          id: `${childId}-result`,
          role: 'tool_result',
          content: typeof finalResult.data === 'string' ? finalResult.data : JSON.stringify(finalResult.data),
          createdAt: finalResult.timestamp,
          isFinalResult: true,
          toolUseId: toolUseId,
          agentId: childId,
        });
      }
      
      // 按时间排序
      childMessages.sort((a, b) => {
        const timeA = new Date(a.createdAt).getTime();
        const timeB = new Date(b.createdAt).getTime();
        return timeA - timeB;
      });
      
      return NextResponse.json({
        messages: childMessages,
        total: childMessages.length,
        source: 'stream',
        nodeId,
        agentId: childId,
      });
    }

    // 获取子Agent列表
    // 1. 从 agents 目录列出文件
    const agentFiles = await store.listAgents(nodeId);
    
    // 2. 从流中解析 Agent/task 调用（获取更多信息）
    const agentCalls = await store.getAgentCalls(nodeId);
    
    // 构建结果
    const children: Array<{
      id: string;
      toolUseId: string;
      workflowNodeId: string;
      title: string;
      status: string;
      startedAt: string | null;
      completedAt: string | null;
      type: string;
      agentId?: string;
      hasStreamFile: boolean;
    }> = [];
    
    for (const call of agentCalls) {
      // 检查是否有对应的 agent 流文件
      const hasStreamFile = agentFiles.includes(call.toolUseId) || 
                           agentFiles.includes(call.agentId);
      
      // 检查是否有 tool_result（表示完成）
      const events = await store.readStream(nodeId);
      const result = events.find(e =>
        e.event === 'tool_result' && e.data?.toolUseId === call.toolUseId
      );
      
      let status = 'active';
      let completedAt: string | null = null;
      
      if (call.status === 'running') {
        status = 'running';
      } else if (result) {
        const resultData = result.data;
        if (resultData?.isError) {
          status = 'failed';
        } else {
          status = 'completed';
        }
        completedAt = result.timestamp || null;
      }
      
      children.push({
        id: call.toolUseId,
        toolUseId: call.toolUseId,
        workflowNodeId: nodeId,
        title: call.description || call.args?.description || call.args?.prompt?.substring(0, 100) || `子任务 ${children.length + 1}`,
        status,
        startedAt: call.timestamp,
        completedAt,
        type: call.name,
        agentId: call.agentId,
        hasStreamFile,
      });
    }
    
    // 如果有 agent 流文件但不在 agentCalls 中（可能 agent_launch 后没有 tool_result）
    for (const agentId of agentFiles) {
      const exists = children.some(c => c.agentId === agentId || c.toolUseId === agentId);
      if (!exists) {
        // 尝试读取 agent 流获取信息
        try {
          const agentEvents = await store.readAgentStream(nodeId, agentId);
          const firstEvent = agentEvents[0];
          
          children.push({
            id: agentId,
            toolUseId: agentId,
            workflowNodeId: nodeId,
            title: `子任务 ${children.length + 1}`,
            status: 'running',
            startedAt: firstEvent?.timestamp || null,
            completedAt: null,
            type: 'Agent',
            agentId: agentId,
            hasStreamFile: true,
          });
        } catch {
          // 忽略读取错误
        }
      }
    }

    logger.logNoUser(LOG_MODULES.SESSION, 'Found children for evaluation', { 
      details: { evaluationId, nodeId, count: children.length } 
    });

    return NextResponse.json({
      children,
      total: children.length,
      source: 'stream',
      nodeId,
      agentFiles,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, 'Children API error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}