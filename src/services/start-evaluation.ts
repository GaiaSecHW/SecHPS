// src/services/start-evaluation.ts
// 评估启动服务 - 直接启动评估（不走 HTTP，避免网络依赖）

import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';
import { emitQueueError, emitEvaluationStarted, emitPreparingProgress, emitPhaseStart, emitNodeComplete, emitMessageChunk, emitTodoUpdate, emitPhaseTokenUsage, emitEvaluationComplete } from '@/lib/event-bus';
import { unlockProject } from '@/lib/evaluation-lock';
import { completeEvaluationSuccess, completeEvaluationFailed } from '@/services/evaluation-completion';
import { createSkillExecutionsForNode } from '@/services/skill-execution-tracker';
import { generateId, generateIndexedId } from '@/lib/id-generator';
import { copySkillsToProject } from '@/services/skill-files';
import { mkdir, access, rm } from 'fs/promises';
import { join } from 'path';
import { createUnifiedExecutionEngine } from '@/lib/workflow/unified-execution-engine';
import { generateNodeList } from '@/lib/workflow/node-list-generator';
import { loadMcpServersForProject } from '@/lib/mcp-loader';
import type { UnifiedExecutionCallbacks } from '@/lib/workflow/types';

const LOG_PREFIX = '[StartEvaluation]';

/**
 * 启动排队评估的核心逻辑
 * 不通过 HTTP，直接执行启动流程
 */
export async function startQueuedEvaluation(evaluationId: string): Promise<{
  success: boolean;
  error?: string;
  evaluation?: any;
}> {
  logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 开始启动排队评估`, { evaluationId });

  try {
    // Step 1: 获取排队评估信息
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id: evaluationId },
      include: {
        Project: {
          include: {
            User: { select: { id: true, name: true, username: true } },
          },
        },
      },
    });

    if (!evaluation) {
      logger.errorNoUser(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 评估不存在`, { evaluationId });
      return { success: false, error: '评估不存在' };
    }

    const projectName = evaluation.Project?.name || '未知项目';
    const projectPath = evaluation.Project?.projectPath;
    const projectId = evaluation.projectId;

    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 项目信息`, {
      projectId,
      projectName,
      status: evaluation.status,
    });

    if (evaluation.status !== 'queued') {
      logger.errorNoUser(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 评估状态不是 queued`, { 
        evaluationId, 
        status: evaluation.status 
      });
      return { success: false, error: `评估不在排队状态，当前状态: ${evaluation.status}` };
    }

    // Step 2: 获取模型配置
    const modelConfig = await prisma.modelConfig.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!modelConfig) {
      const errorMsg = '没有可用的模型配置';
      logger.errorNoUser(LOG_MODULES.EVALUATION, `${LOG_PREFIX} ${errorMsg}`, { evaluationId });
      
      emitQueueError({
        evaluationId,
        projectName,
        error: errorMsg,
        errorDetails: '启动排队评估时无法找到活跃的模型配置',
      });

      await prisma.evaluationSession.update({
        where: { id: evaluationId },
        data: {
          status: 'failed',
          errorMessage: errorMsg,
          endReason: 'no_model_config',
          completedAt: new Date(),
        },
      });

      await unlockProject(projectId);

      return { success: false, error: errorMsg };
    }

    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 模型配置`, {
      name: modelConfig.name,
      provider: modelConfig.providerType,
    });

    // Step 3: 获取全局配置
    const globalConfig = await prisma.opencodeConfig.findFirst({
      where: { isActive: true },
    });

    if (!globalConfig?.customSystemPrompt) {
      const errorMsg = '系统配置缺少系统提示词（customSystemPrompt）';
      logger.errorNoUser(LOG_MODULES.EVALUATION, `${LOG_PREFIX} ${errorMsg}`, { evaluationId });
      
      await prisma.evaluationSession.update({
        where: { id: evaluationId },
        data: {
          status: 'failed',
          errorMessage: errorMsg,
          endReason: 'no_system_prompt',
          completedAt: new Date(),
        },
      });

      await unlockProject(projectId);

      return { success: false, error: errorMsg };
    }

    // Step 3.5: 加载项目工具权限配置
    const toolPermissions = await prisma.toolPermission.findMany({
      where: { projectId },
    });
    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 工具权限配置`, {
      count: toolPermissions.length,
      rules: toolPermissions.map(p => `${p.toolPattern}:${p.permission}`),
    });

    // Step 3.6: 加载 MCP Servers 配置
    const userId = evaluation.Project?.User?.id;
    const mcpServers = userId ? await loadMcpServersForProject(projectId, userId) : [];
    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} MCP Servers 配置`, {
      count: mcpServers.length,
      names: mcpServers.map(m => m.name),
    });

    // Step 4: 获取工作流信息
    const workflowId = evaluation.workflowId;
    if (!workflowId) {
      const errorMsg = '评估缺少 workflowId';
      logger.errorNoUser(LOG_MODULES.EVALUATION, `${LOG_PREFIX} ${errorMsg}`, { evaluationId });
      
      await prisma.evaluationSession.update({
        where: { id: evaluationId },
        data: {
          status: 'failed',
          errorMessage: errorMsg,
          endReason: 'no_workflow',
          completedAt: new Date(),
        },
      });

      await unlockProject(projectId);

      return { success: false, error: errorMsg };
    }

    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId },
      select: {
        id: true,
        name: true,
        workflowType: true,
        fsmTemplateId: true,
      },
    });

    if (!workflow) {
      const errorMsg = '工作流不存在';
      logger.errorNoUser(LOG_MODULES.EVALUATION, `${LOG_PREFIX} ${errorMsg}`, { evaluationId, workflowId });
      
      await prisma.evaluationSession.update({
        where: { id: evaluationId },
        data: {
          status: 'failed',
          errorMessage: errorMsg,
          endReason: 'workflow_not_found',
          completedAt: new Date(),
        },
      });

      await unlockProject(projectId);

      return { success: false, error: errorMsg };
    }

    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 工作流信息`, {
      name: workflow.name,
      type: workflow.workflowType,
    });

    // Step 5: 更新评估状态为 preparing
    const updatedEvaluation = await prisma.evaluationSession.update({
      where: { id: evaluationId },
      data: {
        status: 'preparing',
        providerType: modelConfig.providerType,
        workflowType: workflow.workflowType || 'fsm',
        modelConfigId: modelConfig.id,
        modelName: modelConfig.name,
      },
      include: { Project: true },
    });

    // Step 6: 更新项目状态为 running
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'running' },
    });

    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 评估状态更新为 preparing，开始后台执行`);

    // Step 7: 根据 workflowType 选择执行方式
    if (workflow.workflowType === 'fsm') {
      // FSM 流程：使用 FSM 模板
      const fsmTemplateId = workflow.fsmTemplateId || 'threat-modeling';
      void executeFSMBackground(
        evaluationId,
        projectId,
        workflowId,
        projectPath || '',
        modelConfig,
        globalConfig,
        fsmTemplateId,
        toolPermissions.map(p => ({
          toolPattern: p.toolPattern,
          permission: p.permission,
          description: p.description || undefined,
        }))
      );
    } else {
      // DAG/Custom 流程：使用 DAG 执行服务
      void executeDAGBackground(
        evaluationId,
        projectId,
        workflowId,
        projectPath || '',
        modelConfig,
        globalConfig,
        mcpServers,
        toolPermissions.map(p => ({
          toolPattern: p.toolPattern,
          permission: p.permission,
          description: p.description || undefined,
        }))
      );
    }

    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 排队评估已启动`, { 
      evaluationId, 
      projectId, 
      workflowType: workflow.workflowType 
    });

    return {
      success: true,
      evaluation: updatedEvaluation,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    
    logger.errorNoUser(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 启动排队评估异常`, {
      evaluationId,
      error: errorMessage,
      stack: errorStack,
    });

    // 尝试更新失败状态
    try {
      const evalData = await prisma.evaluationSession.findUnique({
        where: { id: evaluationId },
        include: { Project: { select: { name: true } } },
      });

      if (evalData) {
        emitQueueError({
          evaluationId,
          projectName: evalData.Project?.name || '未知项目',
          error: errorMessage,
          errorDetails: errorStack || '无堆栈信息',
        });

        await prisma.evaluationSession.update({
          where: { id: evaluationId },
          data: {
            status: 'failed',
            errorMessage: `启动异常: ${errorMessage}`,
            endReason: 'start_exception',
            completedAt: new Date(),
          },
        });

        await prisma.project.update({
          where: { id: evalData.projectId },
          data: { status: 'idle' },
        });

        await unlockProject(evalData.projectId);
      }
    } catch (dbError) {
      logger.errorNoUser(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 更新失败状态时出错`, { error: String(dbError) });
    }

    return { success: false, error: errorMessage };
  }
}

/**
 * 后台异步执行 FSM 工作流
 */
async function executeFSMBackground(
  evaluationId: string,
  projectId: string,
  workflowId: string,
  projectPath: string,
  modelConfig: any,
  globalConfig: any,
  fsmTemplateId: string,
  toolPermissions: Array<{ toolPattern: string; permission: string; description?: string }>
): Promise<void> {
  logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} [Background] 开始 FSM 执行...`);

  try {
    // Step 1: 清理工作目录
    if (projectPath) {
      const cleanupTargets = [
        { path: join(projectPath, 'workspace'), type: 'dir' },
        { path: join(projectPath, 'vulnerabilities'), type: 'dir' },
        { path: join(projectPath, 'outputs'), type: 'dir' },
      ];
      
      for (const target of cleanupTargets) {
        try {
          await access(target.path);
          await rm(target.path, { recursive: true, force: true });
        } catch {
          // 不存在，跳过
        }
      }

      // 创建工作目录
      const workDirs = [
        join(projectPath, 'vulnerabilities'),
        join(projectPath, 'workspace'),
        join(projectPath, 'outputs'),
        join(projectPath, 'outputs', 'phases'),
        join(projectPath, 'outputs', 'reports'),
      ];
      
      for (const dir of workDirs) {
        try {
          await mkdir(dir, { recursive: true });
        } catch {
          // 忽略创建失败
        }
      }
    }

    emitPreparingProgress(evaluationId, {
      stage: 'mcp_complete',
      message: '工作目录已准备',
    });

    // Step 2: 同步 Skills
    emitPreparingProgress(evaluationId, {
      stage: 'skills_sync',
      message: '开始同步 Skills...',
    });

    let skillsUsedJson: string | null = null;
    if (projectPath) {
      try {
        const copyResult = await copySkillsToProject(projectPath, undefined, undefined, null);
        
        if (copyResult.skillIds.length > 0) {
          const skills = await prisma.skill.findMany({
            where: { id: { in: copyResult.skillIds } },
            select: { id: true, name: true },
          });
          skillsUsedJson = JSON.stringify(skills.map(s => ({ skillId: s.id, skillName: s.name })));
        }

        emitPreparingProgress(evaluationId, {
          stage: 'skills_sync',
          message: `Skills 同步完成，成功 ${copyResult.success} 个`,
        });
      } catch (skillError) {
        logger.warn(LOG_MODULES.SKILL, `${LOG_PREFIX} Skills 同步失败（继续执行）`, { error: skillError });
      }
    }

    // Step 3: 更新状态为 running
    await prisma.evaluationSession.update({
      where: { id: evaluationId },
      data: { 
        status: 'running', 
        startedAt: new Date(),
        skillsUsed: skillsUsedJson,
      },
    });

    emitEvaluationStarted(evaluationId, {
      workflowType: 'fsm',
      message: 'FSM 工作流已启动',
    });

    // Step 4: 获取 FSMTemplate.nodes
    let fsmPhaseToNodeId: Record<number, string> = {};
    let fsmNodesList: Array<{ id: string; label: string; fsmPhase: number; fsmOrder: number }> = [];
    
    const fsmTemplate = await prisma.fSMTemplate.findUnique({
      where: { id: fsmTemplateId },
      select: { nodes: true },
    });
    
    if (fsmTemplate?.nodes) {
      try {
        const fsmNodes = JSON.parse(fsmTemplate.nodes);
        fsmNodesList = fsmNodes.map((node: any) => ({
          id: node.id,
          label: node.label || `Phase ${node.fsmPhase}`,
          fsmPhase: node.fsmPhase,
          fsmOrder: node.fsmOrder || node.fsmPhase,
        }));
        fsmNodes.forEach((node: any) => {
          if (node.fsmPhase) {
            fsmPhaseToNodeId[node.fsmPhase] = node.id;
          }
        });
      } catch (e) {
        logger.warn(LOG_MODULES.EVALUATION, `${LOG_PREFIX} FSMTemplate.nodes 解析失败`, { error: String(e) });
      }
    }

    // Step 5: 预创建 NodeExecution 记录
    if (fsmNodesList.length > 0) {
      try {
        await prisma.$transaction(
          fsmNodesList.map((node, i) =>
            prisma.nodeExecution.create({
              data: {
                id: generateIndexedId('nodeexec', i),
                evaluationSessionId: evaluationId,
                workflowNodeId: node.id,
                nodeLabel: node.label,
                nodeType: 'fsm_phase',
                status: 'pending',
                order: node.fsmOrder || i,
                updatedAt: new Date(),
              },
            })
          )
        );
        logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} NodeExecution 预创建完成`, { count: fsmNodesList.length });
      } catch (e) {
        logger.warn(LOG_MODULES.EVALUATION, `${LOG_PREFIX} NodeExecution 预创建失败（继续执行）`, { error: String(e) });
      }
    }

    // Step 6: 调用 FSM 执行服务
    const { createFSMWorkflowExecutionService } = await import('@/lib/fsm');
    
    const modelConfigForExecution = {
      id: modelConfig.id,
      providerType: modelConfig.providerType,
      name: modelConfig.name,
      models: JSON.parse(modelConfig.models || '[]'),
      apiKey: modelConfig.apiKey || '',
      apiBaseUrl: modelConfig.apiBaseUrl || '',
      contextWindow: modelConfig.contextWindow,
    };

    const fsmService = createFSMWorkflowExecutionService(
      {
        evaluationSessionId: evaluationId,
        projectId,
        workflowId,
        fsmTemplateId,
        workspacePath: projectPath,
        maxIterationsPerPhase: 10,
        maxCostPerPhase: 2.0,
        modelConfig: modelConfigForExecution,
        systemPrompt: globalConfig.customSystemPrompt,
        roleModels: undefined,
        toolPermissions: toolPermissions.map(p => ({
          toolPattern: p.toolPattern,
          permission: p.permission as 'allow' | 'deny' | 'ask',
          description: p.description,
        })),
      },
      {
        onPhaseStart: async (phase, phaseName) => {
          emitPhaseStart(evaluationId, {
            nodeIndex: phase,
            nodeId: `fsm-node-p${phase}`,
            nodeName: phaseName,
            modelName: modelConfig.name,
            totalNodes: 7,
          });
        },
        onPhaseChunk: (phase, text) => {
          emitMessageChunk(evaluationId, text);
        },
        onPhaseToolCall: (phase, tool, args) => {
          if (tool === 'TodoWrite' && args?.todos && Array.isArray(args.todos)) {
            const nodeId = fsmPhaseToNodeId[phase] || `fsm-node-p${phase}`;
            const todosWithNodeId = args.todos.map((todo: any) => ({
              ...todo,
              nodeId,
              workflowNodeId: nodeId,
              phase,
            }));
            emitTodoUpdate(evaluationId, todosWithNodeId);
          }
        },
        onPhaseComplete: async (phase, result) => {
          emitNodeComplete(evaluationId, `fsm-node-p${phase}`);
        },
        onPhaseError: (phase, error) => {
          logger.errorNoUser(LOG_MODULES.FSM, `${LOG_PREFIX} Phase ${phase} 错误`, { error: error.message });
        },
        onAgentZoneStart: async (agents) => {
          logger.info(LOG_MODULES.FSM, `${LOG_PREFIX} Agent Zone 启动`, { agents });
        },
        onAgentZoneProgress: (agent, status) => {},
        onAgentZoneComplete: async (results) => {
          logger.info(LOG_MODULES.FSM, `${LOG_PREFIX} Agent Zone 完成`, { count: results.length });
        },
        onWorkflowComplete: async (result) => {
          logger.info(LOG_MODULES.FSM, `${LOG_PREFIX} FSM 工作流完成`, { status: result.status });
          
          if (result.status === 'completed') {
            await completeEvaluationSuccess(evaluationId, projectId, projectPath, `FSM: ${result.phaseResults.length} phases`, {
              input: result.totalInputTokens,
              output: result.totalOutputTokens,
            });
          } else {
            await completeEvaluationFailed(evaluationId, projectId, projectPath, '工作流未完成');
          }
          
          emitEvaluationComplete(evaluationId, {
            status: result.status,
            totalDuration: result.totalDuration,
            totalTokens: result.totalTokens,
            totalCost: result.totalCost,
            message: result.status === 'completed' ? 'FSM 工作流执行完成' : 'FSM 工作流执行失败',
          });
          
          await prisma.project.update({
            where: { id: projectId },
            data: { status: result.status === 'completed' ? 'completed' : 'failed' },
          });
        },
        onWorkflowError: async (error) => {
          logger.errorNoUser(LOG_MODULES.FSM, `${LOG_PREFIX} FSM 工作流错误`, { error: error.message });
          
          await completeEvaluationFailed(evaluationId, projectId, projectPath, error.message);
          
          emitEvaluationComplete(evaluationId, {
            status: 'failed',
            error: error.message,
            errorMessage: error.message,
            message: 'FSM 工作流执行失败',
          });
          
          await prisma.project.update({
            where: { id: projectId },
            data: { status: 'failed' },
          });
        },
        onTokenUsage: (data) => {
          emitPhaseTokenUsage(evaluationId, {
            nodeIndex: data.phase,
            nodeName: data.phaseName,
            modelName: data.modelName,
            inputTokens: data.inputTokens,
            outputTokens: data.outputTokens,
            cumulativeInputTokens: data.cumulativeInputTokens,
            cumulativeOutputTokens: data.cumulativeOutputTokens,
          });
        },
      }
    );

    await fsmService.execute();

    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} [Background] FSM 执行完成`);

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.errorNoUser(LOG_MODULES.EVALUATION, `${LOG_PREFIX} [Background] FSM 执行失败`, { error: errorMsg });
    
    emitPreparingProgress(evaluationId, {
      stage: 'mcp_error',
      message: '后台执行过程发生错误',
      error: errorMsg,
    });
    
    await prisma.evaluationSession.update({
      where: { id: evaluationId },
      data: {
        status: 'failed',
        errorMessage: errorMsg,
        completedAt: new Date(),
        endReason: 'error',
        endMessage: errorMsg,
      },
    });
    
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'failed' },
    });
    
    await unlockProject(projectId);
  }
}

/**
 * 后台异步执行 DAG 工作流
 */
async function executeDAGBackground(
  evaluationId: string,
  projectId: string,
  workflowId: string,
  projectPath: string,
  modelConfig: any,
  globalConfig: any,
  mcpServers: any[],
  toolPermissions: any[]
): Promise<void> {
  logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} [DAG-Background] 开始 DAG 执行`, {
    mcpServersCount: mcpServers.length,
  });

  try {
    // Step 1: 获取 WorkflowNode 定义
    const workflowNodes = await prisma.workflowNode.findMany({
      where: { workflowId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        type: true,
        data: true,
        roleId: true,
      }
    });

    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} [DAG-Background] WorkflowNode 数量`, {
      count: workflowNodes.length,
    });

    // 构建 DAG 节点列表
    const dagNodesList: Array<{ id: string; label: string; type: string; roleId?: string | null }> = [];
    
    for (const node of workflowNodes) {
      let label = node.type;
      if (node.data) {
        try {
          const data = JSON.parse(node.data);
          label = data.label || node.type;
        } catch {}
      }
      dagNodesList.push({
        id: node.id,
        label,
        type: node.type,
        roleId: node.roleId ?? undefined,
      });
    }

    // Step 2: 预创建 NodeExecution 记录
    if (dagNodesList.length > 0) {
      try {
        await prisma.$transaction(
          dagNodesList.map((node, i) =>
            prisma.nodeExecution.create({
              data: {
                id: generateIndexedId('nodeexec', i),
                evaluationSessionId: evaluationId,
                workflowNodeId: node.id,
                nodeLabel: node.label,
                nodeType: node.type,
                status: 'pending',
                order: i,
                updatedAt: new Date(),
                roleId: node.roleId,
              },
            })
          )
        );
        logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} [DAG-Background] NodeExecution 预创建完成`, {
          count: dagNodesList.length,
        });
      } catch (e) {
        logger.error(LOG_MODULES.EVALUATION, `${LOG_PREFIX} [DAG-Background] NodeExecution 预创建失败`, {
          error: String(e),
        });
      }
    }

    // Step 3: 更新评估状态为 running
    await prisma.evaluationSession.update({
      where: { id: evaluationId },
      data: {
        status: 'running',
        startedAt: new Date(),
      },
    });

    emitEvaluationStarted(evaluationId, {
      workflowType: 'dag',
      message: 'DAG 工作流已启动',
    });

    // Step 4: 调用 DAG 执行服务
    logger.debug(LOG_MODULES.EVALUATION, `${LOG_PREFIX} [DAG-Background] 开始调用统一执行引擎...`);

    // 获取完整的节点定义（包含 skills, vulnerabilityCategories）
    const nodes = await generateNodeList(workflowId);
    if (!nodes.length) {
      logger.error(LOG_MODULES.EVALUATION, `${LOG_PREFIX} [DAG-Background] Workflow 节点不存在`);
      throw new Error('Workflow 节点不存在');
    }

    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} [DAG-Background] 获取到节点`, {
      count: nodes.length,
    });

    // ========================================
    // Step 4.1: 预创建 SkillExecution 记录（关键！）
    // ========================================
    for (const node of nodes) {
      const nodeSkills = node.skills || [];

      if (nodeSkills.length > 0) {
        try {
          await createSkillExecutionsForNode({
            evaluationId,
            nodeId: node.id,
            skills: nodeSkills,
            projectId,
          });
          logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} [DAG-Background] 为节点 ${node.id} (${node.label}) 创建 SkillExecution 记录`, {
            count: nodeSkills.length,
          });
        } catch (error) {
          logger.error(LOG_MODULES.EVALUATION, `${LOG_PREFIX} [DAG-Background] 为节点 ${node.id} 创建 SkillExecution 失败`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // 构建 modelConfigForExecution
    const modelConfigForExecution = {
      id: modelConfig.id,
      providerType: modelConfig.providerType,
      name: modelConfig.name,
      models: JSON.parse(modelConfig.models || '[]'),
      apiKey: modelConfig.apiKey || '',
      apiBaseUrl: modelConfig.apiBaseUrl || '',
      contextWindow: modelConfig.contextWindow,
    };

    // 构建 callbacks
    const callbacks: UnifiedExecutionCallbacks = {
      onNodeStart: (i, _nid, n) => {
        logger.debug(LOG_MODULES.EVALUATION, `${LOG_PREFIX} [DAG-Background] Node ${i}: ${n} 开始`);
        emitPhaseStart(evaluationId, {
          nodeIndex: i,
          nodeId: _nid,
          nodeName: n,
          modelName: modelConfig.name,
          totalNodes: nodes.length,
        });
      },
      onNodeChunk: (i, text) => {
        emitMessageChunk(evaluationId, text);
      },
      onNodeToolCall: (i, tool) => {
        logger.debug(LOG_MODULES.EVALUATION, `${LOG_PREFIX} [DAG-Background] Node ${i} tool: ${tool}`);
      },
      onNodeComplete: (i) => {
        logger.debug(LOG_MODULES.EVALUATION, `${LOG_PREFIX} [DAG-Background] Node ${i} 完成`);
        emitNodeComplete(evaluationId, nodes[i]?.id || `node-${i}`);
      },
      onNodeError: (i) => {
        logger.error(LOG_MODULES.EVALUATION, `${LOG_PREFIX} [DAG-Background] Node ${i} 错误`);
      },
      onNodeRetry: (i, _nid, _n, retry, max) => {
        logger.warn(LOG_MODULES.EVALUATION, `${LOG_PREFIX} [DAG-Background] Node ${i} retry ${retry}/${max}`);
      },
      onWorkflowComplete: async (r) => {
        logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} [DAG-Background] 工作流完成`, { status: r.status });
        
        if (r.status === 'completed') {
          await completeEvaluationSuccess(evaluationId, projectId, projectPath, `DAG: ${r.nodeResults.length} nodes`, {
            input: r.totalInputTokens,
            output: r.totalOutputTokens,
          });
        } else {
          await completeEvaluationFailed(evaluationId, projectId, projectPath, r.error || 'DAG 执行失败', r.endReason, r.endMessage);
        }
        
        emitEvaluationComplete(evaluationId, {
          status: r.status,
          totalDuration: r.totalDuration,
          totalTokens: r.totalTokens,
          totalCost: r.totalCost,
          message: r.status === 'completed' ? 'DAG 工作流执行完成' : 'DAG 工作流执行失败',
        });
        
        await prisma.project.update({
          where: { id: projectId },
          data: { status: r.status === 'completed' ? 'completed' : 'failed' },
        });
        
        await unlockProject(projectId);
      },
      onWorkflowError: async (e) => {
        logger.error(LOG_MODULES.EVALUATION, `${LOG_PREFIX} [DAG-Background] 工作流错误`, { error: e.message });

        await completeEvaluationFailed(evaluationId, projectId, projectPath, e.message, 'error', e.stack);

        emitEvaluationComplete(evaluationId, {
          status: 'failed',
          error: e.message,
          errorMessage: e.message,
          message: 'DAG 工作流执行失败',
        });

        await prisma.project.update({
          where: { id: projectId },
          data: { status: 'failed' },
        });

        await unlockProject(projectId);
      },
      onTokenUsage: (data) => {
        emitPhaseTokenUsage(evaluationId, {
          nodeIndex: data.nodeIndex,
          nodeName: data.nodeName,
          modelName: data.modelName,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          cumulativeInputTokens: data.cumulativeInputTokens,
          cumulativeOutputTokens: data.cumulativeOutputTokens,
        });
      },
    };

    // 创建统一执行引擎
    const engine = createUnifiedExecutionEngine({
      evaluationSessionId: evaluationId,
      projectId,
      projectName: 'DAG Project',
      workflowId,
      workflowType: 'dag',
      workspacePath: projectPath,
      defaultModelConfig: modelConfigForExecution,
      mcpServers,  // MCP Servers 配置（从数据库加载）
      toolPermissions,  // 工具权限配置
      systemPrompt: globalConfig.customSystemPrompt,
      maxIterationsPerNode: 10,
      maxRetries: 15,
      retryDelayMs: 60000,
    }, callbacks);
    
    engine.setNodes(nodes);

    // 执行（异步，不阻塞）
    engine.execute().catch(async (e) => {
      logger.error(LOG_MODULES.EVALUATION, `${LOG_PREFIX} [DAG-Background] 执行异常`, { error: e.message });

      await completeEvaluationFailed(evaluationId, projectId, projectPath, e.message, 'error', e.stack);

      await unlockProject(projectId);
    });

    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} [DAG-Background] DAG 执行引擎已启动`);

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(LOG_MODULES.EVALUATION, `${LOG_PREFIX} [DAG-Background] 执行失败`, { error: errorMsg });

    await prisma.evaluationSession.update({
      where: { id: evaluationId },
      data: {
        status: 'failed',
        errorMessage: errorMsg,
        completedAt: new Date(),
        endReason: 'error',
      },
    });

    await unlockProject(projectId);
  }
}