// src/app/api/evaluations/[id]/execute/route.ts
//
// Unified Execution API - 根据 workflowType 自动选择执行引擎，后台执行，立即返回响应
//

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { isAdmin } from '@/lib/api-auth';
import { createFSMWorkflowExecutionService, type FSMExecutionCallbacks } from '@/lib/fsm';
import { createUnifiedExecutionEngine } from '@/lib/workflow/unified-execution-engine';
import type { UnifiedExecutionCallbacks } from '@/lib/workflow/types';
import { createRalphLoopAgent, parseAndSaveResults, type RalphLoopAgentCallbacks } from '@/services/evaluation';
import { logger, LOG_MODULES } from '@/lib/logger';

/** 获取模型配置 */
async function getModelConfig() {
  const model = await prisma.modelConfig.findFirst({ where: { isActive: true, isDefault: true } })
    || await prisma.modelConfig.findFirst({ where: { isActive: true } });
  if (!model) return null;
  const models = JSON.parse(model.models || '[]');
  return { providerType: model.providerType, apiKey: model.apiKey, apiBaseUrl: model.apiBaseUrl, models: model.models, model: models[0] || 'claude-sonnet-4-20250514' };
}

/** 更新会话状态 */
async function updateStatus(id: string, status: string, data?: Record<string, any>) {
  await prisma.evaluationSession.update({ where: { id }, data: { status, ...data, ...(status === 'failed' || status === 'completed' ? { completedAt: new Date() } : {}) } });
}

/** FSM 执行引擎 */
async function executeFSM(id: string, evaluation: any, modelConfig: any, body: any) {
  const fsmTemplateId = body.fsmTemplateId || evaluation.Workflow?.fsmTemplateId;
  if (!fsmTemplateId) throw new Error('FSM 模式需要指定 fsmTemplateId');
  const fsmTemplate = await prisma.fSMTemplate.findUnique({ where: { id: fsmTemplateId } });
  if (!fsmTemplate) throw new Error('FSM 模板不存在');

  const callbacks: FSMExecutionCallbacks = {
    onPhaseStart: (p, n) => logger.debug(LOG_MODULES.FSM, `Phase ${p}: ${n}`),
    onPhaseChunk: () => {},
    onPhaseToolCall: (p, t) => logger.debug(LOG_MODULES.FSM, `Phase ${p} tool: ${t}`),
    onPhaseComplete: (p) => logger.info(LOG_MODULES.FSM, `Phase ${p} done`),
    onPhaseError: (p, e) => logger.errorNoUser(LOG_MODULES.FSM, `Phase ${p} error`),
    onAgentZoneStart: (a) => logger.info(LOG_MODULES.FSM, `AgentZone: ${a.join(',')}`),
    onAgentZoneProgress: (a, s) => logger.debug(LOG_MODULES.FSM, `${a}: ${s}`),
    onAgentZoneComplete: () => logger.info(LOG_MODULES.FSM, 'AgentZone done'),
    onWorkflowComplete: async (r) => updateStatus(id, r.status === 'completed' ? 'completed' : 'failed', { summary: `FSM: ${r.phaseResults.length} phases` }),
    onWorkflowError: (e) => updateStatus(id, 'failed', { errorMessage: e.message }).catch(() => {}),
  };

  const service = createFSMWorkflowExecutionService({
    evaluationSessionId: id, projectId: evaluation.projectId, workflowId: evaluation.workflowId || 'fsm-default',
    fsmTemplateId, workspacePath: evaluation.Project.projectPath || process.cwd(),
    maxIterationsPerPhase: body.maxIterationsPerPhase || 10, maxCostPerPhase: body.maxCostPerPhase || 2.0, modelConfig,
  }, callbacks);

  service.execute().catch((e) => updateStatus(id, 'failed', { errorMessage: e.message }));
}

/** DAG 执行引擎 */
async function executeDAG(id: string, evaluation: any, modelConfig: any, body: any) {
  const workflowId = evaluation.workflowId;
  if (!workflowId) throw new Error('DAG 模式需要 workflowId');
  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId }, include: { WorkflowNode: true } });
  if (!workflow?.WorkflowNode?.length) throw new Error('Workflow 或节点不存在');

  const nodes = workflow.WorkflowNode.map((n: any) => ({ id: n.id, label: n.label, type: n.type, roleId: n.roleId, skillPath: n.skillPath, description: n.description, fsmPhase: n.fsmPhase, fsmOrder: n.fsmOrder, data: n.data ? JSON.parse(n.data) : undefined }));
  const callbacks: UnifiedExecutionCallbacks = {
    onNodeStart: (i, _nid, n) => logger.debug(LOG_MODULES.WORKFLOW, `Node ${i}: ${n}`),
    onNodeChunk: () => {},
    onNodeToolCall: (i, t) => logger.debug(LOG_MODULES.WORKFLOW, `Node ${i} tool: ${t}`),
    onNodeComplete: (i) => logger.info(LOG_MODULES.WORKFLOW, `Node ${i} done`),
    onNodeError: (i) => logger.errorNoUser(LOG_MODULES.WORKFLOW, `Node ${i} error`),
    onNodeRetry: (i, _nid, _n, r, m) => logger.debug(LOG_MODULES.WORKFLOW, `Node ${i} retry ${r}/${m}`),
    onWorkflowComplete: async (r) => updateStatus(id, r.status, { summary: `DAG: ${r.nodeResults.length} nodes` }),
    onWorkflowError: (e) => updateStatus(id, 'failed', { errorMessage: e.message }).catch(() => {}),
    onTokenUsage: () => {},
  };

  const engine = createUnifiedExecutionEngine({
    evaluationSessionId: id, projectId: evaluation.projectId, projectName: evaluation.Project.name, workflowId, workflowType: 'custom',
    workspacePath: evaluation.Project.projectPath || process.cwd(),
    defaultModelConfig: { id: 'dag-default', name: modelConfig.model, ...modelConfig },
    maxIterationsPerNode: body.maxIterations || 10, maxRetries: 15, retryDelayMs: 60000,
  }, callbacks);
  engine.setNodes(nodes as any);
  engine.execute().catch((e) => updateStatus(id, 'failed', { errorMessage: e.message }));
}

/** Ralph 执行引擎 */
async function executeRalph(id: string, evaluation: any, modelConfig: any, body: any) {
  const agent = createRalphLoopAgent(modelConfig, evaluation.Project.projectPath, { maxIterations: body.maxIterations || 15, maxTokens: body.maxTokens || 100000, maxCost: body.maxCost || 5.0 });
  const context = { projectName: evaluation.Project.name, taskDescription: evaluation.Project.OpencodeConfig?.taskDescription, initialMessage: evaluation.Project.OpencodeConfig?.taskDescription, files: evaluation.Project.ProjectFile?.map((f: any) => ({ name: f.fileName, type: f.fileType, size: f.fileSize })) || [] };
  const callbacks: RalphLoopAgentCallbacks = {
    onChunk: () => {},
    onToolCall: (n) => logger.debug(LOG_MODULES.EVALUATION, `Tool: ${n}`),
    onToolResult: (n) => logger.debug(LOG_MODULES.EVALUATION, `Result: ${n}`),
    onComplete: () => {},
    onError: (e) => logger.errorNoUser(LOG_MODULES.EVALUATION, `Error: ${e.message}`),
    onRalphComplete: async (r) => {
      // 漏洞入库流程有问题，暂时停止调用 parseAndSaveResults
      // TODO: 修复漏洞入库流程后重新启用
      // try { await parseAndSaveResults(id, evaluation.projectId, r.text); } catch {}
      updateStatus(id, r.completionReason === 'verified' ? 'completed' : 'failed', { summary: `Ralph: ${r.iterations} iterations` });
    },
  };
  agent.loop({ evaluationId: id, projectId: evaluation.projectId, context, callbacks }).catch((e) => updateStatus(id, 'failed', { errorMessage: e.message }));
}

/** POST /api/evaluations/[id]/execute - 统一执行 API */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) return NextResponse.json({ error: '未授权' }, { status: 401 });
    const payload = verifyToken(authHeader.replace('Bearer ', ''));
    if (!payload) return NextResponse.json({ error: '无效的令牌' }, { status: 401 });

    const { id } = await params;
    const evaluation = await prisma.evaluationSession.findFirst({
      where: isAdmin(payload) ? { id } : { id, Project: { userId: payload.userId } },
      include: { Project: { select: { id: true, name: true, projectPath: true, userId: true, OpencodeConfig: true, ProjectFile: true } }, Workflow: { include: { FSMTemplate: true } } },
    });
    if (!evaluation) return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    if (evaluation.status !== 'ready') return NextResponse.json({ error: `状态必须为 'ready'，当前: ${evaluation.status}` }, { status: 400 });

    const modelConfig = await getModelConfig();
    if (!modelConfig) return NextResponse.json({ error: '未找到激活的模型配置' }, { status: 404 });

    const body = await request.json();
    const workflowType = evaluation.workflowType || body.workflowType || 'ralph';

    await updateStatus(id, 'running', { startedAt: new Date() });

    switch (workflowType) {
      case 'fsm': await executeFSM(id, evaluation, modelConfig, body); break;
      case 'dag': await executeDAG(id, evaluation, modelConfig, body); break;
      case 'ralph': await executeRalph(id, evaluation, modelConfig, body); break;
      default: await updateStatus(id, 'ready', { errorMessage: `未知的 workflowType: ${workflowType}` }); return NextResponse.json({ error: `未知的 workflowType: ${workflowType}` }, { status: 400 });
    }

    return NextResponse.json({ success: true, status: 'running', evaluationId: id, workflowType, message: `${workflowType} 工作流已启动` });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.EVALUATION, '统一执行启动错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}