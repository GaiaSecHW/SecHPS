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
import { generateNodeList } from '@/lib/workflow/node-list-generator';
import type { UnifiedExecutionCallbacks, McpServerConfigForExecution } from '@/lib/workflow/types';
import { createRalphLoopAgent, type RalphLoopAgentCallbacks } from '@/services/evaluation';
import { loadMcpServersForProject } from '@/lib/mcp-loader';
import { logger, LOG_MODULES } from '@/lib/logger';
import { completeEvaluation, completeEvaluationSuccess, completeEvaluationFailed } from '@/services/evaluation-completion';

/** 获取模型配置 */
async function getModelConfig() {
  const model = await prisma.modelConfig.findFirst({ where: { isActive: true, isDefault: true } })
    || await prisma.modelConfig.findFirst({ where: { isActive: true } });
  if (!model) return null;
  const models = JSON.parse(model.models || '[]');
  return { providerType: model.providerType, apiKey: model.apiKey, apiBaseUrl: model.apiBaseUrl, models: model.models, model: models[0] || 'claude-sonnet-4-20250514' };
}

/** FSM 执行引擎 */
async function executeFSM(id: string, evaluation: any, modelConfig: any, body: any, mcpServers: McpServerConfigForExecution[] | undefined, userId: string) {
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
    onWorkflowComplete: async (r) => {
      const projectPath = evaluation.Project.projectPath || process.cwd();
      if (r.status === 'completed') {
        await completeEvaluationSuccess(id, evaluation.projectId, projectPath, `FSM: ${r.phaseResults.length} phases, ${r.agentZoneResults?.length || 0} agents`, { input: r.totalInputTokens, output: r.totalOutputTokens });
      } else {
        // FSM 失败时传递详细信息：从 phaseResults 中找到失败的阶段
        const failedPhases = r.phaseResults.filter(p => p.status === 'failed');
        const errorMsg = `FSM 执行失败，状态: ${r.status}`;
        const endMsg = failedPhases.length > 0 
          ? `失败阶段: ${failedPhases.map(p => `Phase ${p.phaseNumber} (${p.phaseName})`).join(', ')}`
          : `执行状态: ${r.status}, 总阶段数: ${r.phaseResults.length}`;
        await completeEvaluationFailed(id, evaluation.projectId, projectPath, errorMsg, r.status, endMsg);
      }
    },
    onWorkflowError: (e) => {
      const projectPath = evaluation.Project.projectPath || process.cwd();
      completeEvaluationFailed(id, evaluation.projectId, projectPath, e.message, 'error', e.stack).catch(() => {});
    },
  };

  const service = createFSMWorkflowExecutionService({
    evaluationSessionId: id, projectId: evaluation.projectId, workflowId: evaluation.workflowId || 'fsm-default',
    fsmTemplateId, workspacePath: evaluation.Project.projectPath || process.cwd(),
    maxIterationsPerPhase: body.maxIterationsPerPhase || 10, maxCostPerPhase: body.maxCostPerPhase || 2.0, modelConfig,
    userId,  // 传递 userId 用于加载 MCP
    mcpServers,  // 传递 MCP 配置（优先使用传入的，否则从数据库加载）
  }, callbacks);

  service.execute().catch(async (e) => {
    const projectPath = evaluation.Project.projectPath || process.cwd();
    await completeEvaluationFailed(id, evaluation.projectId, projectPath, e.message, 'error', e.stack);
  });
}

/** DAG 执行引擎 */
async function executeDAG(id: string, evaluation: any, modelConfig: any, body: any, mcpServers: McpServerConfigForExecution[] | undefined) {
  const workflowId = evaluation.workflowId;
  if (!workflowId) throw new Error('DAG 模式需要 workflowId');
  
  // 使用 generateNodeList 获取完整的节点定义（包含 skills, vulnerabilityCategories）
  const nodes = await generateNodeList(workflowId);
  if (!nodes.length) throw new Error('Workflow 节点不存在');

  const callbacks: UnifiedExecutionCallbacks = {
    onNodeStart: (i, _nid, n) => logger.debug(LOG_MODULES.WORKFLOW, `Node ${i}: ${n}`),
    onNodeChunk: () => {},
    onNodeToolCall: (i, t) => logger.debug(LOG_MODULES.WORKFLOW, `Node ${i} tool: ${t}`),
    onNodeComplete: (i) => logger.info(LOG_MODULES.WORKFLOW, `Node ${i} done`),
    onNodeError: (i) => logger.errorNoUser(LOG_MODULES.WORKFLOW, `Node ${i} error`),
    onNodeRetry: (i, _nid, _n, r, m) => logger.debug(LOG_MODULES.WORKFLOW, `Node ${i} retry ${r}/${m}`),
    onWorkflowComplete: async (r) => {
      const projectPath = evaluation.Project.projectPath || process.cwd();
      if (r.status === 'completed') {
        await completeEvaluationSuccess(id, evaluation.projectId, projectPath, `DAG: ${r.nodeResults.length} nodes`, { input: r.totalInputTokens, output: r.totalOutputTokens });
      } else {
        // 传递完整的错误信息：errorMessage（简短）+ endMessage（详细）
        await completeEvaluationFailed(id, evaluation.projectId, projectPath, r.error || 'DAG 执行失败', r.endReason, r.endMessage);
      }
    },
    onWorkflowError: (e) => {
      const projectPath = evaluation.Project.projectPath || process.cwd();
      completeEvaluationFailed(id, evaluation.projectId, projectPath, e.message, 'error', e.stack).catch(() => {});
    },
    onTokenUsage: () => {},
  };

  const engine = createUnifiedExecutionEngine({
    evaluationSessionId: id, projectId: evaluation.projectId, projectName: evaluation.Project.name, workflowId, workflowType: 'custom',
    workspacePath: evaluation.Project.projectPath || process.cwd(),
    defaultModelConfig: { id: 'dag-default', name: modelConfig.model, ...modelConfig },
    mcpServers,  // MCP 配置传递给统一执行引擎
    maxIterationsPerNode: body.maxIterations || 10, maxRetries: 15, retryDelayMs: 60000,
  }, callbacks);
  engine.setNodes(nodes);
  engine.execute().catch(async (e) => {
    const projectPath = evaluation.Project.projectPath || process.cwd();
    await completeEvaluationFailed(id, evaluation.projectId, projectPath, e.message);
  });
}

/** Ralph 执行引擎 */
async function executeRalph(id: string, evaluation: any, modelConfig: any, body: any, mcpServers: McpServerConfigForExecution[] | undefined) {
  const agent = createRalphLoopAgent(modelConfig, evaluation.Project.projectPath, { maxIterations: body.maxIterations || 15, maxTokens: body.maxTokens || 100000, maxCost: body.maxCost || 5.0 }, { mcpServers });
  const context = { projectName: evaluation.Project.name, taskDescription: evaluation.Project.OpencodeConfig?.taskDescription, initialMessage: evaluation.Project.OpencodeConfig?.taskDescription, files: evaluation.Project.ProjectFile?.map((f: any) => ({ name: f.fileName, type: f.fileType, size: f.fileSize })) || [] };
  const callbacks: RalphLoopAgentCallbacks = {
    onChunk: () => {},
    onToolCall: (n) => logger.debug(LOG_MODULES.EVALUATION, `Tool: ${n}`),
    onToolResult: (n) => logger.debug(LOG_MODULES.EVALUATION, `Result: ${n}`),
    onComplete: () => {},
    onError: (e) => logger.errorNoUser(LOG_MODULES.EVALUATION, `Error: ${e.message}`),
    onRalphComplete: async (r) => {
      const projectPath = evaluation.Project.projectPath || process.cwd();
      if (r.completionReason === 'verified') {
        await completeEvaluationSuccess(id, evaluation.projectId, projectPath, `Ralph: ${r.iterations} iterations`, { input: r.totalUsage.inputTokens, output: r.totalUsage.outputTokens });
      } else {
        // Ralph 失败时传递详细信息
        const errorMsg = r.reason || `Ralph 执行未验证通过，原因: ${r.completionReason}`;
        const endMsg = `迭代次数: ${r.iterations}, 完成原因: ${r.completionReason}, Token: ${r.totalUsage.totalTokens}`;
        await completeEvaluationFailed(id, evaluation.projectId, projectPath, errorMsg, r.completionReason, endMsg);
      }
    },
  };
  agent.loop({ evaluationId: id, projectId: evaluation.projectId, context, callbacks }).catch((e) => {
    const projectPath = evaluation.Project.projectPath || process.cwd();
    completeEvaluationFailed(id, evaluation.projectId, projectPath, e.message, 'error', e.stack).catch(() => {});
  });
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

    // 加载 MCP 配置（用于所有 workflowType）
    const mcpServers = evaluation.projectId && payload.userId
      ? await loadMcpServersForProject(evaluation.projectId, payload.userId)
      : undefined;

    // 更新为 running 状态
    await prisma.evaluationSession.update({ where: { id }, data: { status: 'running', startedAt: new Date() } });

    switch (workflowType) {
      case 'fsm': await executeFSM(id, evaluation, modelConfig, body, mcpServers, payload.userId); break;
      case 'dag': await executeDAG(id, evaluation, modelConfig, body, mcpServers); break;
      case 'ralph': await executeRalph(id, evaluation, modelConfig, body, mcpServers); break;
      default: 
        await prisma.evaluationSession.update({ where: { id }, data: { status: 'ready', errorMessage: `未知的 workflowType: ${workflowType}` } });
        return NextResponse.json({ error: `未知的 workflowType: ${workflowType}` }, { status: 400 });
    }

    return NextResponse.json({ success: true, status: 'running', evaluationId: id, workflowType, message: `${workflowType} 工作流已启动` });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.EVALUATION, '统一执行启动错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '服务器内部错误', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}