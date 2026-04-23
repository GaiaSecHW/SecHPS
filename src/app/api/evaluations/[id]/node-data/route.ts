// src/app/api/evaluations/[id]/node-data/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';
import { createNodeStreamStore } from '@/services/node-stream-store';

/**
 * 归一化节点数据API - 一次性返回所有节点相关数据
 * GET /api/evaluations/[id]/node-data?nodeId={nodeId}
 * 
 * 数据源: stream.jsonl + agents/*.jsonl (纯文件读取)
 * 返回: messages, todos, children, agentMessages (预加载所有子Agent消息)
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
    const nodeId = url.searchParams.get('nodeId');

    logger.access(LOG_MODULES.SESSION, payload, evaluationId, { action: 'fetch_node_data', nodeId });

    // 必须指定 nodeId
    if (!nodeId) {
      return NextResponse.json({ 
        error: '缺少 nodeId 参数',
        messages: [], 
        todos: [], 
        children: [],
        agentMessages: {},
      }, { status: 400 });
    }

    // 获取 evaluationSession 以获取 projectId（归属校验）
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id: evaluationId },
      select: { 
        projectId: true,
        Project: { select: { userId: true } }
      },
    });
    
    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 归属校验（管理员绕过）
    const userIsAdmin = payload.roles?.includes('admin');
    if (!userIsAdmin && evaluation.Project.userId !== payload.userId) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    const projectId = evaluation.projectId;
    const store = createNodeStreamStore(projectId, evaluationId);

    // === 一次读取所有数据 ===
    
    let messages: any[] = [];
    let todos: any[] = [];
    let children: any[] = [];
    let agentMessages: Record<string, any[]> = {}; // 预加载所有子Agent消息

    try {
      // 1. 读取主节点流
      const events = await store.readStream(nodeId);

      // 2. 格式化消息
      messages = events.map((event, index) => ({
        id: `msg-${nodeId}-${index}`,
        role: event.event === 'user' ? 'user' :
              event.event === 'text' || event.event === 'thinking' ? 'assistant' :
              event.event === 'tool_use' ? 'tool_call' :
              event.event === 'tool_result' ? 'tool_result' :
              event.event,
        content: typeof event.data === 'string' ? event.data : JSON.stringify(event.data),
        createdAt: event.timestamp,
        workflowNodeId: nodeId,
        nodeId: nodeId,
        event: event.event,
      }));

      // 3. 解析 TodoWrite（找最近一次，并添加 nodeId）
      for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        if (event.event === 'tool_use' && event.data?.name === 'TodoWrite') {
          const rawTodos = event.data?.args?.todos || [];
          // 给每个 todo 添加 nodeId，便于前端过滤
          todos = rawTodos.map((todo: any, idx: number) => ({
            ...todo,
            id: todo.id || `todo-${nodeId}-${idx}`,
            nodeId: nodeId,
            workflowNodeId: nodeId,
          }));
          break;
        }
      }

      // 4. 解析 Agent/task 调用
      const agentCalls: any[] = [];
      for (const event of events) {
        if (event.event === 'tool_use') {
          const name = event.data?.name;
          if (name === 'Agent' || name === 'task') {
            agentCalls.push({
              toolUseId: event.data?.toolUseId,
              name,
              args: event.data?.args,
              timestamp: event.timestamp,
            });
          }
        }
        
        // 检查 tool_result 是否有 async_launched
        if (event.event === 'tool_result') {
          const result = event.data;
          if (result?.isAsync || result?.status === 'async_launched') {
            const toolUseId = result.toolUseId;
            const call = agentCalls.find(c => c.toolUseId === toolUseId);
            if (call) {
              call.agentId = result.agentId;
              call.status = 'running';
              call.description = result.description;
            }
          }
        }
      }

      // 5. 列出并预加载所有 agent 流文件
      const agentFiles = await store.listAgents(nodeId);
      
      // 预加载每个 agent 的消息流
      for (const agentId of agentFiles) {
        try {
          const agentEvents = await store.readAgentStream(nodeId, agentId);
          agentMessages[agentId] = agentEvents.map((event, index) => ({
            id: `${agentId}-${index}`,
            role: event.event === 'user' ? 'user' :
                  event.event === 'text' || event.event === 'thinking' ? 'assistant' :
                  event.event === 'tool_use' ? 'tool_call' :
                  event.event === 'tool_result' ? 'tool_result' :
                  event.event,
            content: typeof event.data === 'string' ? event.data : JSON.stringify(event.data),
            createdAt: event.timestamp,
            event: event.event,
            agentId: event.agentId || agentId,
          }));
        } catch {
          agentMessages[agentId] = [];
        }
      }

      // 6. 构建子Agent列表（合并 agentCalls 和 agentFiles）
      const processedAgents = new Set<string>();
      
      for (const call of agentCalls) {
        const hasStreamFile = agentFiles.includes(call.toolUseId) || 
                             agentFiles.includes(call.agentId);
        const agentId = call.agentId || call.toolUseId;
        
        // 检查是否有 tool_result（表示完成）
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
        
        // 如果没有 agent 流文件，从主 stream 提取相关消息
        if (!hasStreamFile && !agentMessages[agentId]) {
          // 找 Agent 调用时间范围
          const agentStartTime = call.timestamp;
          const agentEndTime = result?.timestamp;
          
          if (agentStartTime) {
            const startMs = new Date(agentStartTime).getTime();
            const endMs = agentEndTime ? new Date(agentEndTime).getTime() : Date.now();
            
            // 提取时间范围内的消息作为子Agent消息
            const extractedMessages: any[] = [];
            
            // 1. 添加用户输入（Agent 调用的 prompt）
            extractedMessages.push({
              id: `${agentId}-input`,
              role: 'user',
              content: call.args?.prompt || call.args?.description || '子任务启动',
              createdAt: agentStartTime,
              event: 'user_input',
              agentId: agentId,
            });
            
            // 2. 提取时间范围内的 text/thinking/tool 事件
            for (const event of events) {
              if (!event.timestamp) continue;
              const eventTime = new Date(event.timestamp).getTime();
              
              // 在时间范围内且不是 Agent tool_use 本身
              if (eventTime >= startMs && eventTime <= endMs) {
                // 排除 Agent tool_use（已处理）和 TodoWrite
                if (event.event === 'tool_use' && 
                    (event.data?.name === 'Agent' || event.data?.name === 'TodoWrite')) {
                  continue;
                }
                
                // 添加相关事件
                if (event.event === 'text' || event.event === 'thinking' || 
                    event.event === 'tool_use' || event.event === 'tool_result') {
                  extractedMessages.push({
                    id: `${agentId}-${eventTime}-${extractedMessages.length}`,
                    role: event.event === 'text' || event.event === 'thinking' ? 'assistant' :
                          event.event === 'tool_use' ? 'tool_call' : 'tool_result',
                    content: typeof event.data === 'string' ? event.data : 
                             (event.data?.text || event.data?.content || JSON.stringify(event.data)),
                    createdAt: event.timestamp,
                    event: event.event,
                    agentId: agentId,
                  });
                }
              }
            }
            
            // 3. 添加最终结果
            if (result) {
              extractedMessages.push({
                id: `${agentId}-result`,
                role: 'tool_result',
                content: typeof result.data === 'string' ? result.data : 
                         (result.data?.content || JSON.stringify(result.data)),
                createdAt: result.timestamp,
                event: 'tool_result',
                agentId: agentId,
                isFinalResult: true,
              });
            }
            
            // 按时间排序
            extractedMessages.sort((a, b) => 
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            );
            
            // 缓存提取的消息
            if (extractedMessages.length > 0) {
              agentMessages[agentId] = extractedMessages;
            }
          }
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
          agentId: agentId,
          hasStreamFile,
          messageCount: agentMessages[agentId]?.length || 0,
        });
        
        processedAgents.add(agentId);
        processedAgents.add(call.toolUseId);
      }

      // 7. 添加有流文件但不在 agentCalls 中的 agent
      for (const agentId of agentFiles) {
        if (!processedAgents.has(agentId)) {
          const agentMsgs = agentMessages[agentId] || [];
          const firstEvent = agentMsgs[0];
          
          children.push({
            id: agentId,
            toolUseId: agentId,
            workflowNodeId: nodeId,
            title: `子任务 ${children.length + 1}`,
            status: 'running',
            startedAt: firstEvent?.createdAt || null,
            completedAt: null,
            type: 'Agent',
            agentId: agentId,
            hasStreamFile: true,
            messageCount: agentMsgs.length,
          });
        }
      }

    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.error(LOG_MODULES.SESSION, '读取节点流失败', { details: { error: String(error) } });
      }
      // 文件不存在时返回空数据
    }

    logger.debug(LOG_MODULES.SESSION, '节点数据加载完成', { 
      details: { 
        evaluationId, 
        nodeId, 
        messages: messages.length, 
        todos: todos.length, 
        children: children.length,
        agentStreams: Object.keys(agentMessages).length,
        totalAgentMessages: Object.values(agentMessages).reduce((sum: number, msgs: any[]) => sum + msgs.length, 0)
      } 
    });

    return NextResponse.json({
      messages,
      todos,
      children,
      agentMessages,  // 预加载的所有子Agent消息 { agentId: messages[] }
      total: {
        messages: messages.length,
        todos: todos.length,
        children: children.length,
        agentStreams: Object.keys(agentMessages).length,
      },
      source: 'stream',
      nodeId,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SESSION, 'Node data API error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}