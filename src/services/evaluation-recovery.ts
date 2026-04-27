/**
 * Evaluation Recovery Service
 * 
 * 服务重启后自动恢复被中断的评估执行
 * 
 * 工作原理：
 * 1. 查找 status='running' 但实际已停止的评估
 * 2. 查询 NodeExecution 记录，找到最后一个 completed 状态的节点
 * 3. 从下一个 pending/running 状态的节点开始恢复执行
 * 4. 重新构建执行配置，调用 FSM/DAG 执行服务继续执行
 */

import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';
import { generateId, generateIndexedId } from '@/lib/id-generator';
import { emitEvaluationStarted, emitPreparingProgress, emitEvaluationComplete } from '@/lib/event-bus';
import { completeEvaluationSuccess, completeEvaluationFailed } from '@/services/evaluation-completion';
import { lockProject, unlockProject } from '@/lib/evaluation-lock';
import { loadMcpServersForProject } from '@/lib/mcp-loader';
import type { ModelConfigForExecution, McpServerConfigForExecution, UnifiedNodeDefinition } from '@/lib/workflow/types';

const LOG_PREFIX = '[EvaluationRecovery]';

/**
 * 恢复状态
 */
export interface RecoveryStatus {
  evaluationId: string;
  projectId: string;
  workflowType: 'fsm' | 'custom';
  lastCompletedNodeIndex: number;
  nextNodeToExecute: number;
  totalNodes: number;
  recoveryReason: string;
}

/**
 * 检查并恢复被中断的评估
 * 
 * 在 instrumentation.ts 中调用
 */
export async function recoverInterruptedEvaluations(): Promise<{
  recovered: number;
  failed: number;
  skipped: number;
  details: RecoveryStatus[];
}> {
  logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 开始检查被中断的评估...`);
  
  const result = {
    recovered: 0,
    failed: 0,
    skipped: 0,
    details: [] as RecoveryStatus[],
  };
  
  try {
    // 1. 查找所有 running 状态的评估
    const runningEvaluations = await prisma.evaluationSession.findMany({
      where: {
        status: 'running',
      },
      include: {
        Project: {
          select: {
            id: true,
            name: true,
            projectPath: true,
            userId: true,
          },
        },
        Workflow: {
          select: {
            id: true,
            name: true,
            workflowType: true,
            fsmTemplateId: true,
          },
        },
        NodeExecution: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            workflowNodeId: true,
            nodeLabel: true,
            nodeType: true,
            status: true,
            order: true,
            startedAt: true,
            completedAt: true,
            inputTokens: true,
            outputTokens: true,
          },
        },
      },
    });
    
    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 发现 ${runningEvaluations.length} 个 running 状态的评估`);
    
    for (const evaluation of runningEvaluations) {
      try {
        // 2. 检查是否需要恢复
        const recoveryStatus = await checkRecoveryNeeded(evaluation);
        
        if (!recoveryStatus) {
          // 不需要恢复（可能是刚启动的评估）
          logger.debug(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 评估 ${evaluation.id} 不需要恢复`);
          result.skipped++;
          continue;
        }
        
        logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 评估 ${evaluation.id} 需要恢复`, {
          lastCompletedNodeIndex: recoveryStatus.lastCompletedNodeIndex,
          nextNodeToExecute: recoveryStatus.nextNodeToExecute,
          totalNodes: recoveryStatus.totalNodes,
        });
        
        result.details.push(recoveryStatus);
        
        // 3. 尝试恢复执行
        const recoveryResult = await recoverEvaluation(evaluation, recoveryStatus);
        
        if (recoveryResult.success) {
          result.recovered++;
          logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 评估 ${evaluation.id} 恢复成功`);
        } else {
          result.failed++;
          logger.error(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 评估 ${evaluation.id} 恢复失败`, {
            error: recoveryResult.error,
          });
        }
        
      } catch (error) {
        result.failed++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 评估 ${evaluation.id} 恢复异常`, {
          error: errorMsg,
        });
      }
    }
    
    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 恢复完成`, {
      recovered: result.recovered,
      failed: result.failed,
      skipped: result.skipped,
    });
    
    return result;
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 恢复检查失败`, { error: errorMsg });
    return result;
  }
}

/**
 * 检查评估是否需要恢复
 * 
 * 判断规则：
 * 1. 有 running 状态的 NodeExecution -> 需要恢复（节点执行中断）
 * 2. 有 pending 状态的 NodeExecution 且前面有 completed -> 需要恢复（后续节点未执行）
 * 3. 所有节点都是 pending -> 不需要恢复（可能是刚启动）
 * 4. 所有节点都是 completed -> 不需要恢复（已完成）
 */
async function checkRecoveryNeeded(evaluation: any): Promise<RecoveryStatus | null> {
  const nodeExecutions = evaluation.NodeExecution || [];
  
  if (nodeExecutions.length === 0) {
    // 没有节点执行记录，可能是刚创建的评估
    logger.debug(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 评估 ${evaluation.id} 无节点执行记录`);
    return null;
  }
  
  // 统计各状态节点数量
  const statusCounts = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
  };
  
  let lastCompletedNodeIndex = -1;
  let lastCompletedNodeId = '';
  let lastCompletedNodeLabel = '';
  
  for (let i = 0; i < nodeExecutions.length; i++) {
    const node = nodeExecutions[i];
    statusCounts[node.status as keyof typeof statusCounts]++;
    
    if (node.status === 'completed') {
      lastCompletedNodeIndex = i;
      lastCompletedNodeId = node.workflowNodeId;
      lastCompletedNodeLabel = node.nodeLabel;
    }
  }
  
  logger.debug(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 评估 ${evaluation.id} 状态统计`, {
    pending: statusCounts.pending,
    running: statusCounts.running,
    completed: statusCounts.completed,
    failed: statusCounts.failed,
    lastCompletedNodeIndex,
  });
  
  // 所有节点已完成 -> 不需要恢复
  if (statusCounts.completed === nodeExecutions.length) {
    logger.debug(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 评估 ${evaluation.id} 所有节点已完成`);
    return null;
  }
  
  // 所有节点失败 -> 不需要恢复（标记为失败）
  if (statusCounts.failed > 0 && statusCounts.completed === 0) {
    logger.debug(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 评估 ${evaluation.id} 有失败节点，标记为失败`);
    // 更新评估状态为失败
    await prisma.evaluationSession.update({
      where: { id: evaluation.id },
      data: {
        status: 'failed',
        completedAt: new Date(),
        endReason: '节点执行失败',
        endMessage: `有 ${statusCounts.failed} 个节点执行失败`,
      },
    });
    return null;
  }
  
  // 所有节点 pending -> 不需要恢复（可能是刚启动）
  if (statusCounts.pending === nodeExecutions.length) {
    logger.debug(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 评估 ${evaluation.id} 所有节点 pending，可能是刚启动`);
    return null;
  }
  
  // 有 running 状态的节点 -> 需要恢复（节点执行中断）
  if (statusCounts.running > 0) {
    const runningNode = nodeExecutions.find((n: any) => n.status === 'running');
    return {
      evaluationId: evaluation.id,
      projectId: evaluation.projectId,
      workflowType: evaluation.workflowType as 'fsm' | 'custom',
      lastCompletedNodeIndex,
      nextNodeToExecute: runningNode ? nodeExecutions.indexOf(runningNode) : lastCompletedNodeIndex + 1,
      totalNodes: nodeExecutions.length,
      recoveryReason: `节点 ${runningNode?.nodeLabel || '未知'} 执行中断`,
    };
  }
  
  // 有 pending 状态的节点且前面有 completed -> 需要恢复
  if (statusCounts.pending > 0 && lastCompletedNodeIndex >= 0) {
    return {
      evaluationId: evaluation.id,
      projectId: evaluation.projectId,
      workflowType: evaluation.workflowType as 'fsm' | 'custom',
      lastCompletedNodeIndex,
      nextNodeToExecute: lastCompletedNodeIndex + 1,
      totalNodes: nodeExecutions.length,
      recoveryReason: `从节点 ${lastCompletedNodeLabel} 之后恢复`,
    };
  }
  
  return null;
}

/**
 * 恢复评估执行
 */
async function recoverEvaluation(
  evaluation: any,
  recoveryStatus: RecoveryStatus
): Promise<{ success: boolean; error?: string }> {
  try {
    const projectId = evaluation.projectId;
    const project = evaluation.Project;
    const workflow = evaluation.Workflow;
    
    if (!project || !workflow) {
      return { success: false, error: '缺少项目或工作流信息' };
    }
    
    // 1. 锁定项目（防止并发恢复）
    const locked = await lockProject(projectId, evaluation.id);
    if (!locked) {
      return { success: false, error: '项目已被锁定，无法恢复' };
    }
    
    // 2. 更新评估状态为恢复中
    await prisma.evaluationSession.update({
      where: { id: evaluation.id },
      data: {
        status: 'recovering',
        updatedAt: new Date(),
      },
    });
    
    // 3. 发送恢复事件
    emitPreparingProgress(evaluation.id, {
      stage: 'evaluation_start',
      message: `开始恢复评估，从节点 ${recoveryStatus.nextNodeToExecute + 1} 继续`,
    });
    
    // 4. 获取模型配置
    const modelConfig = await getModelConfigForRecovery(evaluation);
    if (!modelConfig) {
      return { success: false, error: '无法获取模型配置' };
    }
    
    // 5. 获取 MCP 配置
    const mcpServers = await loadMcpServersForProject(projectId, project.userId);
    
    // 6. 根据工作流类型恢复执行
    if (workflow.workflowType === 'fsm') {
      return await recoverFSMEvaluation(evaluation, recoveryStatus, modelConfig, mcpServers);
    } else {
      return await recoverDAGEvaluation(evaluation, recoveryStatus, modelConfig, mcpServers);
    }
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMsg };
  }
}

/**
 * 获取模型配置（用于恢复）
 */
async function getModelConfigForRecovery(evaluation: any): Promise<ModelConfigForExecution | null> {
  try {
    // 优先使用评估记录中的 modelConfigId
    if (evaluation.modelConfigId) {
      const modelConfig = await prisma.modelConfig.findUnique({
        where: { id: evaluation.modelConfigId },
      });
      
      if (modelConfig) {
        return {
          id: modelConfig.id,
          name: modelConfig.name,
          providerType: modelConfig.providerType,
          apiKey: modelConfig.apiKey,
          apiBaseUrl: modelConfig.apiBaseUrl || '',
          models: modelConfig.models,
          contextWindow: modelConfig.contextWindow,
        };
      }
    }
    
    // 使用默认模型配置
    const defaultConfig = await prisma.modelConfig.findFirst({
      where: { isDefault: true, isActive: true },
    });
    
    if (defaultConfig) {
      return {
        id: defaultConfig.id,
        name: defaultConfig.name,
        providerType: defaultConfig.providerType,
        apiKey: defaultConfig.apiKey,
        apiBaseUrl: defaultConfig.apiBaseUrl || '',
        models: defaultConfig.models,
        contextWindow: defaultConfig.contextWindow,
      };
    }
    
    // 使用第一个激活的模型配置
    const firstConfig = await prisma.modelConfig.findFirst({
      where: { isActive: true },
    });
    
    if (firstConfig) {
      return {
        id: firstConfig.id,
        name: firstConfig.name,
        providerType: firstConfig.providerType,
        apiKey: firstConfig.apiKey,
        apiBaseUrl: firstConfig.apiBaseUrl || '',
        models: firstConfig.models,
        contextWindow: firstConfig.contextWindow,
      };
    }
    
    return null;
    
  } catch (error) {
    logger.error(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 获取模型配置失败`, { error });
    return null;
  }
}

/**
 * 恢复 FSM 工作流评估
 */
async function recoverFSMEvaluation(
  evaluation: any,
  recoveryStatus: RecoveryStatus,
  modelConfig: ModelConfigForExecution,
  mcpServers: McpServerConfigForExecution[] | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const project = evaluation.Project;
    const workflow = evaluation.Workflow;
    
    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 开始恢复 FSM 评估 ${evaluation.id}`);
    
    // 1. 加载 FSM 模板
    const fsmTemplate = await prisma.fSMTemplate.findUnique({
      where: { id: workflow.fsmTemplateId },
    });
    
    if (!fsmTemplate) {
      return { success: false, error: 'FSM 模板不存在' };
    }
    
    // 2. 解析节点定义
    const nodes = JSON.parse(fsmTemplate.nodes) as any[];
    
    // 3. 构建恢复节点列表（从断点开始）
    const recoveryNodes: UnifiedNodeDefinition[] = [];
    const startIndex = recoveryStatus.nextNodeToExecute;
    
    for (let i = startIndex; i < nodes.length; i++) {
      const node = nodes[i];
      recoveryNodes.push({
        id: node.id,
        label: node.label,
        type: 'fsm_phase',
        fsmPhase: node.fsmPhase,
        fsmOrder: node.fsmOrder || node.fsmPhase,
        skillPath: node.skillPath,
        description: node.description,
      });
    }
    
    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} FSM 恢复节点列表`, {
      startIndex,
      recoveryNodesCount: recoveryNodes.length,
      nodes: recoveryNodes.map((n: UnifiedNodeDefinition) => n.label),
    });
    
    // 4. 更新评估状态为 running
    await prisma.evaluationSession.update({
      where: { id: evaluation.id },
      data: {
        status: 'running',
        updatedAt: new Date(),
      },
    });
    
    // 5. 发送恢复完成事件
    emitEvaluationStarted(evaluation.id, {
      workflowType: 'fsm',
      message: `FSM 工作流已恢复，从节点 ${startIndex + 1} 继续`,
    });
    
    // 6. 调用 FSM 执行服务（从断点继续）
    const { createFSMWorkflowExecutionService } = await import('@/lib/fsm');
    
    // 构建恢复配置
    const recoveryConfig = {
      evaluationSessionId: evaluation.id,
      projectId: evaluation.projectId,
      workflowId: workflow.id,
      fsmTemplateId: fsmTemplate.id,
      workspacePath: project.projectPath || '',
      maxIterationsPerPhase: 10,
      maxCostPerPhase: 2.0,
      modelConfig: {
        id: modelConfig.id,
        providerType: modelConfig.providerType,
        apiKey: modelConfig.apiKey,
        apiBaseUrl: modelConfig.apiBaseUrl || '',
        models: typeof modelConfig.models === 'string' ? modelConfig.models : JSON.stringify(modelConfig.models),
        contextWindow: modelConfig.contextWindow,
      },
      mcpServers: mcpServers || undefined,
    };
    
    // 构建回调
    const callbacks = {
      onPhaseStart: async (phase: number, phaseName: string) => {
        logger.debug(LOG_MODULES.FSM, `[Recovery] Phase ${phase} (${phaseName}) 开始`);
      },
      onPhaseChunk: (phase: number, text: string) => {
        // 推送实时文本流
        emitMessageChunk(evaluation.id, text);
      },
      onPhaseToolCall: (phase: number, tool: string, args: Record<string, unknown>) => {
        logger.debug(LOG_MODULES.FSM, `[Recovery] Phase ${phase} 工具调用: ${tool}`);
      },
      onPhaseComplete: async (phase: number, result: any) => {
        logger.info(LOG_MODULES.FSM, `[Recovery] Phase ${phase} 完成`, {
          iterations: result.iterations,
          duration: result.duration,
          status: result.status,
        });
      },
      onPhaseError: (phase: number, error: Error) => {
        logger.error(LOG_MODULES.FSM, `[Recovery] Phase ${phase} 错误: ${error.message}`);
      },
      onAgentZoneStart: async (agents: string[]) => {
        logger.info(LOG_MODULES.FSM, `[Recovery] Agent Zone 启动: ${agents.join(', ')}`);
      },
      onAgentZoneProgress: (agent: string, status: string) => {
        logger.debug(LOG_MODULES.FSM, `[Recovery] Agent ${agent} 状态: ${status}`);
      },
      onAgentZoneComplete: async (results: any[]) => {
        logger.info(LOG_MODULES.FSM, `[Recovery] Agent Zone 完成`, { total: results.length });
      },
      onWorkflowComplete: async (result: any) => {
        logger.info(LOG_MODULES.FSM, `[Recovery] FSM 工作流完成`, {
          status: result.status,
          duration: result.totalDuration,
        });
        
        // 使用统一评估完成服务
        const projectPath = project.projectPath || process.cwd();
        if (result.status === 'completed') {
          await completeEvaluationSuccess(evaluation.id, evaluation.projectId, projectPath, `FSM Recovery: ${result.phaseResults.length} phases`, { input: result.totalInputTokens, output: result.totalOutputTokens });
        } else {
          await completeEvaluationFailed(evaluation.id, evaluation.projectId, projectPath, '恢复执行未完成');
        }
        
        // 发送评估完成事件
        emitEvaluationComplete(evaluation.id, {
          status: result.status,
          totalDuration: result.totalDuration,
          totalTokens: result.totalTokens,
          message: result.status === 'completed' ? 'FSM 工作流恢复执行完成' : 'FSM 工作流恢复执行失败',
        });
        
        // 解锁项目
        await unlockProject(evaluation.projectId);
      },
      onWorkflowError: async (error: Error) => {
        logger.error(LOG_MODULES.FSM, `[Recovery] FSM 工作流错误: ${error.message}`);
        
        const projectPath = project.projectPath || process.cwd();
        await completeEvaluationFailed(evaluation.id, evaluation.projectId, projectPath, error.message);
        
        emitEvaluationComplete(evaluation.id, {
          status: 'failed',
          error: error.message,
          message: 'FSM 工作流恢复执行失败',
        });
        
        await unlockProject(evaluation.projectId);
      },
      onTokenUsage: (data: any) => {
        logger.debug(LOG_MODULES.FSM, `[Recovery] Token 使用:`, data);
      },
    };
    
    // 创建 FSM 服务
    const fsmService = createFSMWorkflowExecutionService(recoveryConfig, callbacks);
    
    // 执行恢复（后台异步）
    void (async () => {
      try {
        await fsmService.execute();
      } catch (error) {
        logger.error(LOG_MODULES.EVALUATION, `${LOG_PREFIX} FSM 恢复执行异常`, { error });
      }
    })();
    
    return { success: true };
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMsg };
  }
}

/**
 * 恢复 DAG 工作流评估
 */
async function recoverDAGEvaluation(
  evaluation: any,
  recoveryStatus: RecoveryStatus,
  modelConfig: ModelConfigForExecution,
  mcpServers: McpServerConfigForExecution[] | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const project = evaluation.Project;
    const workflow = evaluation.Workflow;
    
    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 开始恢复 DAG 评估 ${evaluation.id}`);
    
    // 1. 加载 WorkflowNode 定义
    const workflowNodes = await prisma.workflowNode.findMany({
      where: { workflowId: workflow.id },
      orderBy: { positionX: 'asc' },
    });
    
    if (workflowNodes.length === 0) {
      return { success: false, error: '工作流节点不存在' };
    }
    
    // 2. 构建恢复节点列表（从断点开始）
    const recoveryNodes: UnifiedNodeDefinition[] = [];
    const startIndex = recoveryStatus.nextNodeToExecute;
    
    for (let i = startIndex; i < workflowNodes.length; i++) {
      const node = workflowNodes[i];
      const data = node.data ? JSON.parse(node.data) : {};
      
      recoveryNodes.push({
        id: node.id,
        label: data.label || node.type,
        type: node.type,
        roleId: node.roleId,
        skills: node.skills ? JSON.parse(node.skills) : undefined,
        vulnerabilityCategories: node.vulnerabilityCategories ? JSON.parse(node.vulnerabilityCategories) : undefined,
        description: data.description || '',
        data,
      });
    }
    
    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} DAG 恢复节点列表`, {
      startIndex,
      recoveryNodesCount: recoveryNodes.length,
      nodes: recoveryNodes.map((n: UnifiedNodeDefinition) => n.label),
    });
    
    // 3. 更新评估状态为 running
    await prisma.evaluationSession.update({
      where: { id: evaluation.id },
      data: {
        status: 'running',
        updatedAt: new Date(),
      },
    });
    
// 4. 发送恢复完成事件
    emitEvaluationStarted(evaluation.id, {
      workflowType: 'fsm',  // DAG 使用 'fsm' 类型（统一引擎支持）
      message: `DAG 工作流已恢复，从节点 ${startIndex + 1} 继续`,
    });
    
    // 5. 调用统一执行引擎（从断点继续）
    const { createUnifiedExecutionEngine } = await import('@/lib/workflow/unified-execution-engine');
    
    // 构建恢复配置
    const recoveryConfig = {
      evaluationSessionId: evaluation.id,
      projectId: evaluation.projectId,
      projectName: project.name,
      workflowId: workflow.id,
      workflowType: 'dag' as const,
      workspacePath: project.projectPath || '',
      defaultModelConfig: modelConfig,
      mcpServers: mcpServers || undefined,
      maxIterationsPerNode: 10,
      maxRetries: 15,
      retryDelayMs: 60000,
    };
    
    // 构建回调
    const callbacks = {
      onNodeStart: async (nodeIndex: number, nodeId: string, nodeName: string) => {
        logger.debug(LOG_MODULES.EVALUATION, `[Recovery] Node ${nodeIndex} (${nodeName}) 开始`);
      },
      onNodeChunk: (nodeIndex: number, text: string) => {
        emitMessageChunk(evaluation.id, text);
      },
      onNodeToolCall: (nodeIndex: number, tool: string, args: Record<string, unknown>) => {
        logger.debug(LOG_MODULES.EVALUATION, `[Recovery] Node ${nodeIndex} 工具调用: ${tool}`);
      },
      onTokenUsage: (data: any) => {
        logger.debug(LOG_MODULES.EVALUATION, `[Recovery] Token 使用:`, data);
      },
      onNodeRetry: (nodeIndex: number, nodeId: string, nodeName: string, retryCount: number, maxRetries: number, error: Error) => {
        logger.warn(LOG_MODULES.EVALUATION, `[Recovery] Node ${nodeIndex} 重试 (${retryCount}/${maxRetries}): ${error.message}`);
      },
      onNodeComplete: async (nodeIndex: number, result: any) => {
        logger.info(LOG_MODULES.EVALUATION, `[Recovery] Node ${nodeIndex} 完成`, {
          status: result.status,
          duration: result.duration,
        });
      },
      onNodeError: (nodeIndex: number, nodeId: string, nodeName: string, error: Error) => {
        logger.error(LOG_MODULES.EVALUATION, `[Recovery] Node ${nodeIndex} 错误: ${error.message}`);
      },
      onWorkflowComplete: async (result: any) => {
        logger.info(LOG_MODULES.EVALUATION, `[Recovery] DAG 工作流完成`, {
          status: result.status,
          duration: result.totalDuration,
        });
        
        const projectPath = project.projectPath || process.cwd();
        if (result.status === 'completed') {
          await completeEvaluationSuccess(evaluation.id, evaluation.projectId, projectPath, `DAG Recovery: ${result.nodeResults.length} nodes`, { input: result.totalInputTokens, output: result.totalOutputTokens });
        } else {
          await completeEvaluationFailed(evaluation.id, evaluation.projectId, projectPath, '恢复执行未完成');
        }
        
        emitEvaluationComplete(evaluation.id, {
          status: result.status,
          totalDuration: result.totalDuration,
          message: result.status === 'completed' ? 'DAG 工作流恢复执行完成' : 'DAG 工作流恢复执行失败',
        });
        
        await unlockProject(evaluation.projectId);
      },
      onWorkflowError: async (error: Error) => {
        logger.error(LOG_MODULES.EVALUATION, `[Recovery] DAG 工作流错误: ${error.message}`);
        
        const projectPath = project.projectPath || process.cwd();
        await completeEvaluationFailed(evaluation.id, evaluation.projectId, projectPath, error.message);
        
        emitEvaluationComplete(evaluation.id, {
          status: 'failed',
          error: error.message,
          message: 'DAG 工作流恢复执行失败',
        });
        
        await unlockProject(evaluation.projectId);
      },
    };
    
    // 创建执行引擎
    const engine = createUnifiedExecutionEngine(recoveryConfig, callbacks);
    engine.setNodes(recoveryNodes);
    
    // 执行恢复（后台异步）
    void (async () => {
      try {
        await engine.execute();
      } catch (error) {
        logger.error(LOG_MODULES.EVALUATION, `${LOG_PREFIX} DAG 恢复执行异常`, { error });
      }
    })();
    
    return { success: true };
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMsg };
  }
}

// 导入 emitMessageChunk（用于恢复时的实时流）
import { emitMessageChunk } from '@/lib/event-bus';