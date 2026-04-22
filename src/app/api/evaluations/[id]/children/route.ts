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

    // 获取评估会话和工作流信息
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id: evaluationId },
      select: {
        workflowId: true,
        NodeExecution: {
          where: nodeId ? { workflowNodeId: nodeId } : undefined,
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!evaluation) {
      return NextResponse.json({ children: [], total: 0 });
    }

    // 获取工作流节点信息（用于获取节点标签）
    let workflowNodesMap = new Map<string, { label: string; type: string }>();
    if (evaluation.workflowId) {
      const workflow = await prisma.workflow.findUnique({
        where: { id: evaluation.workflowId },
        select: {
          WorkflowNode: {
            select: { id: true, data: true, type: true },
          },
        },
      });
      if (workflow?.WorkflowNode) {
        workflow.WorkflowNode.forEach(wn => {
          // data 字段是 JSON，包含 label
          let label = '';
          try {
            const data = typeof wn.data === 'string' ? JSON.parse(wn.data) : wn.data;
            label = data?.label || '';
          } catch {
            // 忽略解析错误
          }
          workflowNodesMap.set(wn.id, { label, type: wn.type });
        });
      }
    }

    // 构建 children 列表
    const children = evaluation.NodeExecution.map(exec => {
      const nodeInfo = workflowNodesMap.get(exec.workflowNodeId);
      return {
        id: exec.id,
        workflowNodeId: exec.workflowNodeId,
        title: exec.nodeLabel || nodeInfo?.label || `节点 ${exec.workflowNodeId?.substring(0, 8) || 'unknown'}`,
        type: exec.nodeType || nodeInfo?.type || 'unknown',
        status: exec.status || 'pending',
        startedAt: exec.startedAt?.toISOString() || null,
        completedAt: exec.completedAt?.toISOString() || null,
        opencodeSessionId: exec.opencodeSessionId,
        modelName: exec.modelName,
      };
    });

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
