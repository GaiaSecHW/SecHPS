// src/app/api/evaluations/[id]/children/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * 获取评估会话的子Agent列表（从NodeExecution表获取）
 * GET /api/evaluations/[id]/children
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

    logger.access(LOG_MODULES.SESSION, payload, evaluationId, { action: 'fetch_children_by_evaluation', nodeId });

    // 查询 NodeExecution 表获取子Agent列表
    const whereClause: any = { evaluationSessionId: evaluationId };
    if (nodeId) {
      whereClause.workflowNodeId = nodeId;
    }

    const nodeExecutions = await prisma.nodeExecution.findMany({
      where: whereClause,
      select: {
        id: true,
        workflowNodeId: true,
        nodeLabel: true,
        nodeType: true,
        status: true,
        startedAt: true,
        completedAt: true,
        opencodeSessionId: true,
        modelName: true,
      },
      orderBy: { order: 'asc' },
    });

    // 查询 SessionMessage 表获取每个节点的子Agent（Agent/task工具调用）
    // 从消息中提取子Agent信息
    const messages = await prisma.sessionMessage.findMany({
      where: {
        evaluationSessionId: evaluationId,
        role: 'tool_call',
      },
      select: {
        id: true,
        workflowNodeId: true,
        content: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // 解析消息中的Agent/task工具调用
    const agentCalls: Array<{
      id: string;
      workflowNodeId: string | null;
      title: string;
      status: string;
      startedAt: string | null;
      completedAt: string | null;
    }> = [];

    for (const msg of messages) {
      try {
        const content = JSON.parse(msg.content);
        if (content.name === 'Agent' || content.name === 'task') {
          const description = content.args?.description ||
                             content.args?.prompt?.substring(0, 100) ||
                             `子任务 ${agentCalls.length + 1}`;
          
          agentCalls.push({
            id: msg.id,
            workflowNodeId: msg.workflowNodeId,
            title: description.substring(0, 100),
            status: 'active',
            startedAt: msg.createdAt?.toISOString() || null,
            completedAt: null,
          });
        }
      } catch {
        // 解析失败，跳过
      }
    }

    // 合并 NodeExecution 和 Agent调用信息
    const children = [
      // 从 NodeExecution 获取的节点信息
      ...nodeExecutions.map(node => ({
        id: node.id,
        workflowNodeId: node.workflowNodeId,
        title: node.nodeLabel || `节点 ${node.workflowNodeId}`,
        status: node.status || 'pending',
        startedAt: node.startedAt?.toISOString() || null,
        completedAt: node.completedAt?.toISOString() || null,
        opencodeSessionId: node.opencodeSessionId,
        modelName: node.modelName,
      })),
      // 从消息中提取的Agent调用
      ...agentCalls,
    ];

    logger.logNoUser(LOG_MODULES.SESSION, 'Found children for evaluation', { 
      details: { evaluationId, count: children.length, nodeExecutions: nodeExecutions.length, agentCalls: agentCalls.length } 
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
