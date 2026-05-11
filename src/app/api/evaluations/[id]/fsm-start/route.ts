// src/app/api/evaluations/[id]/fsm-start/route.ts
// FSM Workflow Execution API - Compatibility Layer
// Delegates to FSMWorkflowExecutionService internally

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { isAdmin } from '@/lib/api-auth';
import { createFSMWorkflowExecutionService, type FSMExecutionCallbacks } from '@/lib/fsm';
import { logger, LOG_MODULES } from '@/lib/logger';
import { abortAgent, isAgentRunning } from '@/lib/agent-registry';
import { completeEvaluationSuccess, completeEvaluationFailed } from '@/services/evaluation-completion';
import { loadMcpServersForProject } from '@/lib/mcp-loader';

/** Get active model config */
async function getModelConfig() {
  const m = await prisma.modelConfig.findFirst({ where: { isActive: true, isDefault: true } }) || await prisma.modelConfig.findFirst({ where: { isActive: true } });
  if (!m) return null;
  const models = JSON.parse(m.models || '[]');
  return { id: m.id, providerType: m.providerType, apiKey: m.apiKey, apiBaseUrl: m.apiBaseUrl, models: m.models, model: models[0] || 'claude-sonnet-4-20250514', contextWindow: m.contextWindow ?? 0 };
}

/** Create FSM callbacks */
function createCallbacks(id: string, projectId: string, projectPath: string): FSMExecutionCallbacks {
  return {
    onPhaseStart: async (p, n) => logger.debug(LOG_MODULES.FSM, `Phase ${p} (${n}) start`),
    onPhaseChunk: () => {},
    onPhaseToolCall: (p, t) => logger.debug(LOG_MODULES.FSM, `Phase ${p} tool: ${t}`),
    onPhaseComplete: async (p, r) => logger.info(LOG_MODULES.FSM, `Phase ${p} done`, { details: r }),
    onPhaseError: (p, e) => logger.errorNoUser(LOG_MODULES.FSM, `Phase ${p} error: ${e.message}`),
    onAgentZoneStart: async (a) => logger.info(LOG_MODULES.FSM, `AgentZone: ${a.join(',')}`),
    onAgentZoneProgress: (a, s) => logger.debug(LOG_MODULES.FSM, `Agent ${a}: ${s}`),
    onAgentZoneComplete: async (r) => logger.info(LOG_MODULES.FSM, `AgentZone done`, { details: r }),
    onWorkflowComplete: async (r) => {
      logger.info(LOG_MODULES.FSM, `FSM done`, { details: r });
      if (r.status === 'completed') {
        await completeEvaluationSuccess(id, projectId, projectPath, `FSM: ${r.phaseResults.length} phases, ${r.agentZoneResults.length} agents, ${r.generatedReports.length} reports`, { input: r.totalInputTokens, output: r.totalOutputTokens });
      } else {
        await completeEvaluationFailed(id, projectId, projectPath, 'FSM 执行失败');
      }
    },
    onWorkflowError: (e) => {
      logger.errorNoUser(LOG_MODULES.FSM, `FSM error: ${e.message}`);
      completeEvaluationFailed(id, projectId, projectPath, e.message).catch(() => {});
    },
  };
}

/** POST /api/evaluations/[id]/fsm-start - Start FSM workflow */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = verifyToken(authHeader.replace('Bearer ', ''));
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const { id } = await params;
    // Fetch evaluation without include to avoid Prisma hang
    const evaluation = await prisma.evaluationSession.findFirst({
      where: { id },
      select: {
        id: true,
        projectId: true,
        workflowId: true,
        status: true,
        opencodeSessionId: true,
        workflowType: true,
      },
    });
    if (!evaluation) return NextResponse.json({ error: 'Evaluation not found' }, { status: 404 });

    // Ownership check: separate query for Project
    if (!isAdmin(payload)) {
      const ownerProject = evaluation.projectId ? await prisma.project.findUnique({
        where: { id: evaluation.projectId },
        select: { userId: true },
      }) : null;
      if (ownerProject?.userId !== payload.userId) return NextResponse.json({ error: 'Evaluation not found' }, { status: 404 });
    }

    // Separate query for Project
    const project = evaluation.projectId ? await prisma.project.findUnique({
      where: { id: evaluation.projectId },
      select: { id: true, name: true, projectPath: true, userId: true },
    }) : null;

    // Separate query for Workflow + FSMTemplate
    const workflow = evaluation.workflowId ? await prisma.workflow.findUnique({
      where: { id: evaluation.workflowId },
      include: { FSMTemplate: true },
    }) : null;
    if (evaluation.status === 'running') return NextResponse.json({ error: 'Already running' }, { status: 400 });

    const body = await request.json();
    let fsmTemplateId = body.fsmTemplateId as string | undefined;
    if (!fsmTemplateId && workflow) fsmTemplateId = (workflow as any).fsmTemplateId;
    if (!fsmTemplateId) return NextResponse.json({ error: 'FSM template ID required' }, { status: 400 });
    const fsmTemplate = await prisma.fSMTemplate.findUnique({ where: { id: fsmTemplateId } });
    if (!fsmTemplate) return NextResponse.json({ error: 'FSM template not found' }, { status: 404 });

    const modelConfig = await getModelConfig();
    if (!modelConfig) return NextResponse.json({ error: 'No active model config' }, { status: 404 });

    await prisma.evaluationSession.update({ where: { id }, data: { status: 'running', startedAt: new Date() } });
    const workspacePath = project?.projectPath || process.cwd();
    const workflowId = evaluation.workflowId || 'fsm-default';
    const maxIterationsPerPhase = body.maxIterationsPerPhase as number || 10;
    const maxCostPerPhase = body.maxCostPerPhase as number || 2.0;

    // 加载 MCP 服务器配置
    const mcpServers = await loadMcpServersForProject(evaluation.projectId, project?.userId || '');
    logger.debug(LOG_MODULES.MCP, 'FSM 加载 MCP 配置', { count: mcpServers.length, names: mcpServers.map(m => m.name) });

    // 加载系统提示词（从全局配置）
    const globalConfig = await prisma.opencodeConfig.findFirst({ where: { isActive: true } });
    const systemPrompt = globalConfig?.customSystemPrompt || undefined;
    if (systemPrompt) {
      logger.debug(LOG_MODULES.EVALUATION, 'FSM 使用自定义系统提示词', { length: systemPrompt.length });
    }

    const fsmService = createFSMWorkflowExecutionService(
      { 
        evaluationSessionId: id, 
        projectId: evaluation.projectId, 
        workflowId, 
        fsmTemplateId, 
        workspacePath, 
        maxIterationsPerPhase, 
        maxCostPerPhase, 
        modelConfig,
        userId: project?.userId || '',  // 传递 userId 用于加载 MCP
        mcpServers,  // 传递 MCP 配置
        systemPrompt,  // 传递系统提示词
      },
      createCallbacks(id, evaluation.projectId, workspacePath)
    );
    fsmService.execute().catch(async (e) => {
      logger.errorNoUser(LOG_MODULES.FSM, `FSM failed: ${e}`);
      await completeEvaluationFailed(id, evaluation.projectId, workspacePath, String(e));
    });

    return NextResponse.json({ success: true, message: 'FSM workflow started', evaluationId: id, config: { fsmTemplateId, fsmTemplateName: fsmTemplate.name, maxIterationsPerPhase, maxCostPerPhase, model: modelConfig.model, workspacePath } });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.FSM, `FSM start error: ${error}`);
    return NextResponse.json({ error: 'Internal server error', details: String(error) }, { status: 500 });
  }
}

/** DELETE /api/evaluations/[id]/fsm-start - Abort FSM workflow */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const payload = verifyToken(authHeader.replace('Bearer ', ''));
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    const { id } = await params;

    if (isAgentRunning(id)) { abortAgent(id); await prisma.evaluationSession.update({ where: { id }, data: { status: 'cancelled', completedAt: new Date() } }); return NextResponse.json({ success: true, message: 'FSM workflow aborted', evaluationId: id }); }
    return NextResponse.json({ success: false, message: 'No running FSM workflow', evaluationId: id });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.FSM, `Abort error: ${error}`);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}