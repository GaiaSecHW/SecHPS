// src/app/api/evaluations/start/route.ts
// Unified Evaluation Start API - prepares evaluation session for FSM/DAG/Ralph workflows

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { isAdmin } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { generateId, generateIndexedId } from '@/lib/id-generator';
import { logger, LOG_MODULES } from '@/lib/logger';

/** Get active model config (default first, then first active) */
async function getModelConfig(modelId?: string) {
  if (modelId) {
    const model = await prisma.modelConfig.findUnique({ where: { id: modelId } });
    if (model?.isActive) {
      const models = JSON.parse(model.models || '[]');
      return { id: model.id, providerType: model.providerType, model: models[0] || 'claude-sonnet-4-20250514' };
    }
  }
  const defaultModel = await prisma.modelConfig.findFirst({ where: { isActive: true, isDefault: true } });
  if (defaultModel) {
    const models = JSON.parse(defaultModel.models || '[]');
    return { id: defaultModel.id, providerType: defaultModel.providerType, model: models[0] || 'claude-sonnet-4-20250514' };
  }
  const firstModel = await prisma.modelConfig.findFirst({ where: { isActive: true } });
  if (!firstModel) return null;
  const models = JSON.parse(firstModel.models || '[]');
  return { id: firstModel.id, providerType: firstModel.providerType, model: models[0] || 'claude-sonnet-4-20250514' };
}

/** Generate node list from workflow (FSM/DAG) */
async function generateNodeList(workflowId: string): Promise<Array<{ id: string; label: string; type: string; order: number }> | null> {
  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
    include: { WorkflowNode: true, WorkflowEdge: true, FSMTemplate: true },
  });
  if (!workflow) return null;

  // FSM: parse FSMTemplate.nodes
  if (workflow.FSMTemplate?.nodes) {
    try {
      const fsmNodes = JSON.parse(workflow.FSMTemplate.nodes);
      
      // 过滤掉占位节点（skillPath=null && fsmPhase=6 的 fsm-node-penetration）
      const filteredNodes = fsmNodes.filter((n: any) => {
        const isPlaceholder = n.skillPath === null && n.fsmPhase === 6;
        if (isPlaceholder) {
          console.log(`[generateNodeList] 过滤占位节点: ${n.id} (${n.label})`);
        }
        return !isPlaceholder;
      });
      
      // 查询用户编排的 task 节点
      const userNodes = workflow.WorkflowNode.filter(n => n.type === 'task');
      console.log(`[generateNodeList] 找到 ${userNodes.length} 个用户节点`);
      
      // 在 fsmPhase=6 位置插入用户节点
      const result: Array<{ id: string; label: string; type: string; order: number }> = [];
      
      // 处理 FSM 固定节点
      for (const n of filteredNodes) {
        result.push({
          id: n.id,
          label: n.label || `Phase ${n.fsmPhase}`,
          type: 'fsm_phase',
          order: n.fsmOrder ?? n.fsmPhase ?? result.length,
        });
      }
      
      // 在 P5 (fsmPhase=5) 和 P6 (fsmPhase=7) 之间插入用户节点
      const p5Index = result.findIndex(r => r.id === 'fsm-node-p5');
      const insertIndex = p5Index >= 0 ? p5Index + 1 : result.length;
      
      // 按 positionX 排序用户节点
      const sortedUserNodes = userNodes.sort((a, b) => a.positionX - b.positionX);
      
      for (let i = 0; i < sortedUserNodes.length; i++) {
        const wn = sortedUserNodes[i];
        const data = wn.data ? JSON.parse(wn.data) : {};
        result.splice(insertIndex + i, 0, {
          id: wn.id,
          label: data.label || '用户节点',
          type: wn.type,
          order: 6 + i * 0.1, // 6.0, 6.1, 6.2...
        });
      }
      
      console.log(`[generateNodeList] 最终节点列表 (${result.length} 个):`);
      for (const n of result) {
        const isUser = n.id.startsWith('wn-');
        console.log(`  ${isUser ? '[USER]' : '[FSM]'} ${n.order}: ${n.id} (${n.label})`);
      }
      
      return result;
    } catch { return null; }
  }

  // DAG: topological sort
  if (workflow.WorkflowNode.length === 0) return [];
  const adj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  workflow.WorkflowNode.forEach(n => { inDeg.set(n.id, 0); adj.set(n.id, []); });
  workflow.WorkflowEdge.forEach(e => {
    adj.get(e.sourceId)?.push(e.targetId);
    inDeg.set(e.targetId, (inDeg.get(e.targetId) || 0) + 1);
  });
  const queue = [...inDeg.entries()].filter(([_, d]) => d === 0).map(([id]) => id);
  const sorted: string[] = [];
  while (queue.length) {
    const cur = queue.shift()!;
    sorted.push(cur);
    adj.get(cur)?.forEach(n => { const d = inDeg.get(n)! - 1; inDeg.set(n, d); if (d === 0) queue.push(n); });
  }
  const order = sorted.length === workflow.WorkflowNode.length ? sorted : workflow.WorkflowNode.map(n => n.id);
  const nodeMap = new Map(workflow.WorkflowNode.map(n => [n.id, n]));
  return order.map((id, i) => {
    const n = nodeMap.get(id);
    if (!n) return null;
    const data = n.data ? JSON.parse(n.data) : {};
    return { id: n.id, label: data.label || data.name || `Node ${i}`, type: n.type, order: i };
  }).filter((n): n is NonNullable<typeof n> => n !== null);
}

/** POST /api/evaluations/start - Unified evaluation preparation */
export async function POST(request: Request) {
  try {
    // 1. Verify authorization
    const authHeader = request.headers.get('authorization');
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    if (!hasPermission(payload.permissions, PERMISSIONS.EVALUATION_CREATE)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 2. Parse request body
    const body = await request.json();
    const { projectId, workflowId, modelId, roleModels } = body as {
      projectId: string; workflowId?: string; modelId?: string; roleModels?: Array<{ roleId: string; modelId: string }>;
    };
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

    // 3. Verify project ownership
    const userIsAdmin = isAdmin(payload);
    const project = await prisma.project.findFirst({
      where: userIsAdmin ? { id: projectId } : { id: projectId, userId: payload.userId },
    });
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    // 4. Load workflow and determine type
    let workflowType = 'ralph'; // default
    let nodeCount = 0;
    if (workflowId) {
      const workflow = await prisma.workflow.findUnique({ where: { id: workflowId }, include: { FSMTemplate: true } });
      if (!workflow) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
      workflowType = workflow.workflowType || (workflow.FSMTemplate ? 'fsm' : 'dag');
    }

    // 5. Get model config
    const modelConfig = await getModelConfig(modelId);
    if (!modelConfig) return NextResponse.json({ error: 'No active model config' }, { status: 404 });

    // 6. Create EvaluationSession with status='preparing'
    const evaluationId = generateId('eval');
    await prisma.evaluationSession.create({
      data: {
        id: evaluationId,
        projectId,
        workflowId,
        modelConfigId: modelConfig.id,
        modelName: modelConfig.model,
        providerType: modelConfig.providerType,
        workflowType,
        roleModels: roleModels ? JSON.stringify(roleModels) : null,
        status: 'preparing',
        startedAt: new Date(),
      },
    });

    // 7. Generate node list (FSM/DAG only)
    let nodes: Array<{ id: string; label: string; type: string; order: number }> | null = null;
    if (workflowId && workflowType !== 'ralph') {
      nodes = await generateNodeList(workflowId);
      if (!nodes) {
        await prisma.evaluationSession.update({ where: { id: evaluationId }, data: { status: 'failed', errorMessage: 'Failed to generate nodes' } });
        return NextResponse.json({ error: 'Failed to generate node list' }, { status: 500 });
      }
      nodeCount = nodes.length;
    }

    // 8. Pre-create NodeExecution (FSM/DAG only, not Ralph)
    if (nodes && nodes.length > 0) {
      await prisma.$transaction(
        nodes.map((node, i) =>
          prisma.nodeExecution.create({
            data: {
              id: generateIndexedId('nodeexec', i),
              evaluationSessionId: evaluationId,
              workflowNodeId: node.id,
              nodeLabel: node.label,
              nodeType: node.type,
              status: 'pending',
              order: node.order,
              updatedAt: new Date(),
            },
          })
        )
      );
    }

    // 9. Update session status='ready'
    await prisma.evaluationSession.update({ where: { id: evaluationId }, data: { status: 'ready' } });

    logger.info(LOG_MODULES.EVALUATION, 'Evaluation prepared', { evaluationId, workflowType, nodeCount });

    // 10. Return response
    return NextResponse.json({
      evaluationId,
      workflowType,
      nodeCount,
      status: 'ready',
      config: { modelId: modelConfig.id, modelName: modelConfig.model, workflowId, roleModels },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.EVALUATION, 'Start error', { error: String(error) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}