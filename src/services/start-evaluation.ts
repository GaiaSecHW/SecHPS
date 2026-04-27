// src/services/start-evaluation.ts
// 评估启动服务 - 直接启动评估（不走 HTTP，避免网络依赖）

import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';
import { emitQueueError, emitEvaluationStarted, emitPreparingProgress, emitPhaseStart, emitNodeComplete, emitMessageChunk, emitTodoUpdate, emitPhaseTokenUsage, emitEvaluationComplete } from '@/lib/event-bus';
import { unlockProject } from '@/lib/evaluation-lock';
import { completeEvaluationSuccess, completeEvaluationFailed } from '@/services/evaluation-completion';
import { generateId, generateIndexedId } from '@/lib/id-generator';
import { copySkillsToProject } from '@/services/skill-files';
import { mkdir, access, rm } from 'fs/promises';
import { join } from 'path';

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
  console.log(`\n${LOG_PREFIX} ========== 开始启动排队评估 ==========`);
  console.log(`${LOG_PREFIX} evaluationId: ${evaluationId}`);
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

    console.log(`${LOG_PREFIX} 项目信息: projectId=${projectId}, projectName=${projectName}, status=${evaluation.status}`);

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

    console.log(`${LOG_PREFIX} 模型配置: ${modelConfig.name}, provider=${modelConfig.providerType}`);

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

    console.log(`${LOG_PREFIX} 工作流: ${workflow.name}, type=${workflow.workflowType}`);

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

    console.log(`${LOG_PREFIX} ✓ 评估状态更新为 preparing，开始后台执行`);

    // Step 7: 后台异步执行 FSM（不阻塞响应）
    void executeFSMBackground(
      evaluationId,
      projectId,
      workflowId,
      projectPath || '',
      modelConfig,
      globalConfig,
      workflow.fsmTemplateId || 'threat-modeling'
    );

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
  fsmTemplateId: string
): Promise<void> {
  console.log(`${LOG_PREFIX} [Background] 开始 FSM 执行...`);

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
    
    console.log(`${LOG_PREFIX} [Background] FSM 执行完成`);

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