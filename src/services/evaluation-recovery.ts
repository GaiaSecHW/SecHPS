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
import { emitEvaluationStarted, emitPreparingProgress, emitEvaluationComplete, emitMessageChunk } from '@/lib/event-bus';
import { completeEvaluationSuccess, completeEvaluationFailed } from '@/services/evaluation-completion';
import { lockProject, unlockProject } from '@/lib/evaluation-lock';
import { loadMcpServersForProject } from '@/lib/mcp-loader';
import { createEnhancedEvaluationCaller } from '@/services/evaluation';
import { createEvaluationMessageStore } from '@/services/evaluation-message-store';
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
    // 注意：EvaluationSession 没有 Workflow 关系，只有 workflowId 字段
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
        // ❌ EvaluationSession 没有 Workflow 关系
        // Workflow: { ... } // 移除
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
            opencodeSessionId: true,  // 🔑 关键：用于恢复对话
            modelConfigId: true,
            modelName: true,
          },
        },
      },
    });
    
    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 发现 ${runningEvaluations.length} 个 running 状态的评估`);
    
    for (const evaluation of runningEvaluations) {
      try {
        console.log(`${LOG_PREFIX} 检查评估: ${evaluation.id}`);
        console.log(`${LOG_PREFIX}   projectId: ${evaluation.projectId}`);
        console.log(`${LOG_PREFIX}   workflowId: ${evaluation.workflowId}`);
        console.log(`${LOG_PREFIX}   workflowType: ${evaluation.workflowType}`);
        console.log(`${LOG_PREFIX}   Project: ${evaluation.Project ? '存在' : '不存在'}`);
        console.log(`${LOG_PREFIX}   NodeExecution 数量: ${evaluation.NodeExecution?.length || 0}`);
        
        if (evaluation.NodeExecution?.length > 0) {
          evaluation.NodeExecution.forEach((n: any, i: number) => {
            console.log(`${LOG_PREFIX}     Node[${i}]: ${n.nodeLabel} - status=${n.status}, opencodeSessionId=${n.opencodeSessionId || '无'}`);
          });
        }
        
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
          console.log(`${LOG_PREFIX} ✅ 评估 ${evaluation.id} 恢复成功`);
          logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 评估 ${evaluation.id} 恢复成功`);
        } else {
          result.failed++;
          console.log(`${LOG_PREFIX} ❌ 评估 ${evaluation.id} 恢复失败: ${recoveryResult.error}`);
          logger.error(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 评估 ${evaluation.id} 恢复失败`, {
            error: recoveryResult.error,
          });
        }
        
      } catch (error) {
        result.failed++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : '';
        console.log(`${LOG_PREFIX} ❌ 评估 ${evaluation.id} 恢复异常: ${errorMsg}`);
        console.log(`${LOG_PREFIX} 异常堆栈: ${errorStack}`);
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
    const errorStack = error instanceof Error ? error.stack : '';
    logger.error(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 恢复检查失败`, { 
      error: errorMsg,
      stack: errorStack,
    });
    console.error(`${LOG_PREFIX} 恢复检查失败:`, errorMsg);
    console.error(`${LOG_PREFIX} 错误堆栈:`, errorStack);
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
  
  // 所有节点 pending -> 从头启动评估
  if (statusCounts.pending === nodeExecutions.length) {
    console.log(`${LOG_PREFIX} 评估 ${evaluation.id} 所有节点 pending，从头启动`);
    return {
      evaluationId: evaluation.id,
      projectId: evaluation.projectId,
      workflowType: evaluation.workflowType as 'fsm' | 'custom',
      lastCompletedNodeIndex: -1,
      nextNodeToExecute: 0,
      totalNodes: nodeExecutions.length,
      recoveryReason: `从头启动评估`,
    };
  }
  
  // 有 running 状态的节点 -> 检查是否真正中断
  if (statusCounts.running > 0) {
    const runningNode = nodeExecutions.find((n: any) => n.status === 'running');
    
    // 检查节点最近是否有活动（5分钟内有更新说明正在执行）
    const updatedAt = runningNode?.updatedAt;
    const ageMinutes = updatedAt ? (Date.now() - new Date(updatedAt).getTime()) / 60000 : Infinity;
    
    console.log(`${LOG_PREFIX} running 节点 ${runningNode?.nodeLabel}: updatedAt=${updatedAt}, ageMinutes=${ageMinutes.toFixed(2)}`);
    
    if (ageMinutes < 5) {
      // 最近5分钟内有更新，节点正在执行，不需要恢复
      console.log(`${LOG_PREFIX} 节点正在执行（${ageMinutes.toFixed(2)}分钟前有更新），跳过恢复`);
      return null;
    }
    
    // 超过5分钟无更新，节点真正中断，需要恢复
    console.log(`${LOG_PREFIX} 节点已中断（${ageMinutes.toFixed(2)}分钟无更新），触发恢复`);
    return {
      evaluationId: evaluation.id,
      projectId: evaluation.projectId,
      workflowType: evaluation.workflowType as 'fsm' | 'custom',
      lastCompletedNodeIndex,
      nextNodeToExecute: runningNode ? nodeExecutions.indexOf(runningNode) : lastCompletedNodeIndex + 1,
      totalNodes: nodeExecutions.length,
      recoveryReason: `节点 ${runningNode?.nodeLabel || '未知'} 执行中断 (${ageMinutes.toFixed(0)}分钟无活动)`,
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
 * 通过 opencodeSessionId 恢复节点对话
 * 
 * 核心恢复逻辑：
 * 1. 找到 running 状态的节点
 * 2. 使用该节点的 opencodeSessionId 恢复对话
 * 3. 发送"继续执行未完成的工作"消息
 * 4. 大模型会继续之前的执行
 */
async function recoverNodeConversation(
  evaluation: any,
  runningNode: any,
  modelConfig: ModelConfigForExecution,
  mcpServers: McpServerConfigForExecution[] | null
): Promise<{ success: boolean; error?: string }> {
  const LOG_RECOVERY = '[Recovery-Conversation]';
  
  console.log(`${LOG_RECOVERY} 开始通过 opencodeSessionId 恢复对话...`);
  console.log(`${LOG_RECOVERY}   evaluationId: ${evaluation.id}`);
  console.log(`${LOG_RECOVERY}   nodeId: ${runningNode.workflowNodeId}`);
  console.log(`${LOG_RECOVERY}   nodeLabel: ${runningNode.nodeLabel}`);
  console.log(`${LOG_RECOVERY}   opencodeSessionId: ${runningNode.opencodeSessionId}`);
  
  // 1. 检查是否有 opencodeSessionId
  if (!runningNode.opencodeSessionId) {
    console.log(`${LOG_RECOVERY} 节点没有 opencodeSessionId，无法恢复对话`);
    return { success: false, error: '节点没有 opencodeSessionId' };
  }
  
  const project = evaluation.Project;
  
  try {
    // 2. 创建 EnhancedEvaluationCaller 并传入 resumeSession
    console.log(`${LOG_RECOVERY} 创建 EnhancedEvaluationCaller...`);
    
    console.log(`${LOG_RECOVERY} 创建 EnhancedEvaluationCaller...`);
    
    const caller = createEnhancedEvaluationCaller(
      {
        id: modelConfig.id,
        providerType: modelConfig.providerType,
        apiKey: modelConfig.apiKey,
        apiBaseUrl: modelConfig.apiBaseUrl || '',
        models: typeof modelConfig.models === 'string' 
          ? modelConfig.models 
          : JSON.stringify(modelConfig.models),
        contextWindow: modelConfig.contextWindow,
      },
      project.projectPath || process.cwd(),
      {
        resumeSession: runningNode.opencodeSessionId,  // 🔑 关键：传入 sessionId 恢复对话
        workflowNodeId: runningNode.workflowNodeId,     // 用于更新节点执行状态
        mcpServers: mcpServers || undefined,
      }
    );
    
    // 3. 更新评估状态为 running
    await prisma.evaluationSession.update({
      where: { id: evaluation.id },
      data: {
        status: 'running',
        lastActivity: new Date(),
      },
    });
    
    // 4. 发送恢复事件
    emitEvaluationStarted(evaluation.id, {
      workflowType: evaluation.workflowType || 'custom',
      message: `通过 opencodeSessionId 恢复对话，从节点 ${runningNode.nodeLabel} 继续`,
    });
    
    console.log(`${LOG_RECOVERY} ========== 发送恢复消息 ==========`);
    console.log(`${LOG_RECOVERY} 消息: "检查之前执行的子任务进度，继续完成未完成的任务。"`);
    
// 5. 发送恢复消息（提示大模型检查子任务并继续）
    const recoveryMessage = `请反馈当前任务的进度：
1. 查看已执行的子任务列表和结果
2. 找出未完成或失败的子任务
3. 继续执行未完成的子任务
4. 完成后报告整体进度

请继续执行未完成的工作。`;
    
    // 6. 创建消息存储（用于保存到 JSONL）
    const messageStore = createEvaluationMessageStore(evaluation.projectId, evaluation.id);
    await messageStore.initialize();
    
    // 7. 保存用户恢复消息到 JSONL
    await messageStore.appendMessage({
      role: 'user',
      nodeId: runningNode.workflowNodeId,
      nodeIndex: runningNode.order || 0,
      content: recoveryMessage,
      agentCallMsgId: null,
    });
    console.log(`${LOG_RECOVERY} 用户恢复消息已保存到 JSONL`);
    
    // 8. 收集 assistant 响应文本（用于保存）
    let collectedResponse = '';
    
    // 执行恢复（后台异步，不阻塞）
    void (async () => {
      try {
        await caller.startEvaluation(evaluation.id, evaluation.projectId, {
          projectName: project.name,
          projectDescription: project.description || undefined,
          files: [],  // 恢复时不需要文件列表（已在 session 中）
          initialMessage: recoveryMessage,  // 🔑 恢复消息
        }, {
          onChunk: (text: string) => {
            // 推送实时文本流
            console.log(`${LOG_RECOVERY} [chunk] ${text.substring(0, 100)}...`);
            emitMessageChunk(evaluation.id, text);
            // 收集响应文本
            collectedResponse += text;
          },
          onToolCall: (toolUseId: string, name: string, parameters: Record<string, unknown>) => {
            console.log(`${LOG_RECOVERY} [tool] ${name} (${toolUseId})`);
          },
          onToolResult: (toolUseId: string, content: unknown, isError?: boolean) => {
            console.log(`${LOG_RECOVERY} [tool-result] ${toolUseId} - isError=${isError}`);
          },
          onComplete: async (fullResponse: string) => {
            console.log(`${LOG_RECOVERY} ========== 恢复对话完成 ==========`);
            console.log(`${LOG_RECOVERY} 响应长度: ${fullResponse.length}`);
            
            // 保存 assistant 响应到 JSONL
            try {
              await messageStore.appendMessage({
                role: 'assistant',
                nodeId: runningNode.workflowNodeId,
                nodeIndex: runningNode.order || 0,
                content: fullResponse,
                agentCallMsgId: null,
              });
              console.log(`${LOG_RECOVERY} Assistant 响应已保存到 JSONL`);
            } catch (saveError) {
              console.error(`${LOG_RECOVERY} 保存 assistant 响应失败:`, saveError);
            }
            
            // 注意：不在恢复时标记节点为 completed
            // 让大模型自己决定什么时候完成所有子任务
            // 节点状态会在正常执行流程中由 evaluation-completion 服务标记
            logger.info(LOG_MODULES.EVALUATION, `${LOG_RECOVERY} 恢复对话完成，等待大模型完成子任务`);
          },
          onError: async (error: Error) => {
            console.error(`${LOG_RECOVERY} ========== 恢复对话失败 ==========`);
            console.error(`${LOG_RECOVERY} 错误: ${error.message}`);
            
            // 保存错误信息到 JSONL（如果有部分响应）
            if (collectedResponse) {
              try {
                await messageStore.appendMessage({
                  role: 'assistant',
                  nodeId: runningNode.workflowNodeId,
                  nodeIndex: runningNode.order || 0,
                  content: collectedResponse + `\n\n[错误: ${error.message}]`,
                  agentCallMsgId: null,
                });
              } catch (saveError) {
                console.error(`${LOG_RECOVERY} 保存部分响应失败:`, saveError);
              }
            }
            
            // 更新节点状态为 failed
            await prisma.nodeExecution.update({
              where: { id: runningNode.id },
              data: {
                status: 'failed',
                completedAt: new Date(),
                updatedAt: new Date(),
              },
            });
            
            logger.error(LOG_MODULES.EVALUATION, `${LOG_RECOVERY} 恢复对话失败`, { error: error.message });
          },
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error(`${LOG_RECOVERY} 恢复执行异常:`, err.message);
        logger.error(LOG_MODULES.EVALUATION, `${LOG_RECOVERY} 恢复执行异常`, { error: err.message });
      }
    })();
    
    console.log(`${LOG_RECOVERY} 恢复消息已发送，等待响应...`);
    return { success: true };
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_RECOVERY} 创建恢复 caller 失败:`, errorMsg);
    return { success: false, error: errorMsg };
  }
}

/**
 * 恢复评估执行
 */
async function recoverEvaluation(
  evaluation: any,
  recoveryStatus: RecoveryStatus
): Promise<{ success: boolean; error?: string }> {
  const LOG_RECOVER = '[RecoverEvaluation]';
  console.log(`${LOG_RECOVER} ========== 开始恢复评估 ==========`);
  console.log(`${LOG_RECOVER}   evaluationId: ${evaluation.id}`);
  console.log(`${LOG_RECOVER}   projectId: ${evaluation.projectId}`);
  console.log(`${LOG_RECOVER}   workflowId: ${evaluation.workflowId}`);
  console.log(`${LOG_RECOVER}   workflowType: ${evaluation.workflowType}`);
  
  try {
    const projectId = evaluation.projectId;
    const project = evaluation.Project;
    
    console.log(`${LOG_RECOVER} Step 1: 检查 workflowId...`);
    
    // ❌ EvaluationSession 没有 Workflow 关系，需要用 workflowId 查询
    if (!evaluation.workflowId) {
      console.log(`${LOG_RECOVER} ❌ 失败: 评估没有关联工作流`);
      return { success: false, error: '评估没有关联工作流，无法恢复' };
    }
    
    console.log(`${LOG_RECOVER} Step 2: 查询 Workflow...`);
    const workflow = await prisma.workflow.findUnique({
      where: { id: evaluation.workflowId },
    });
    
    console.log(`${LOG_RECOVER}   workflow: ${workflow ? '找到' : '未找到'}`);
    console.log(`${LOG_RECOVER}   workflowType: ${workflow?.workflowType}`);
    
    if (!project || !workflow) {
      console.log(`${LOG_RECOVER} ❌ 失败: 缺少项目或工作流信息`);
      return { success: false, error: '缺少项目或工作流信息' };
    }
    
    console.log(`${LOG_RECOVER} Step 3: 锁定项目...`);
    // 1. 锁定项目（防止并发恢复）
    const locked = await lockProject(projectId, evaluation.id);
    console.log(`${LOG_RECOVER}   locked: ${locked}`);
    
    if (!locked) {
      console.log(`${LOG_RECOVER} ❌ 失败: 项目已被锁定，无法恢复`);
      return { success: false, error: '项目已被锁定，无法恢复' };
    }
    
    console.log(`${LOG_RECOVER} Step 4: 更新评估状态为 recovering...`);
    // 2. 更新评估状态为恢复中
    try {
      await prisma.evaluationSession.update({
        where: { id: evaluation.id },
        data: {
          status: 'recovering',
          lastActivity: new Date(),
        },
      });
      console.log(`${LOG_RECOVER}   状态更新成功: recovering`);
    } catch (dbError: any) {
      console.log(`${LOG_RECOVER} ❌ 状态更新失败: ${dbError.message}`);
      console.log(`${LOG_RECOVER}   错误详情: ${JSON.stringify(dbError)}`);
      // 继续执行，不因状态更新失败而中断恢复
    }
    
    console.log(`${LOG_RECOVER} Step 5: 发送恢复事件...`);
    // 3. 发送恢复事件
    emitPreparingProgress(evaluation.id, {
      stage: 'evaluation_start',
      message: `开始恢复评估，从节点 ${recoveryStatus.nextNodeToExecute + 1} 继续`,
    });
    
    console.log(`${LOG_RECOVER} Step 6: 获取模型配置...`);
    // 4. 获取模型配置
    const modelConfig = await getModelConfigForRecovery(evaluation);
    console.log(`${LOG_RECOVER}   modelConfig: ${modelConfig ? '找到' : '未找到'}`);
    
    if (!modelConfig) {
      console.log(`${LOG_RECOVER} ❌ 失败: 无法获取模型配置`);
      return { success: false, error: '无法获取模型配置' };
    }
    
    // 5. 获取 MCP 配置
    const mcpServers = await loadMcpServersForProject(projectId, project.userId);
    console.log(`${LOG_RECOVER}   mcpServers: ${mcpServers?.length || 0} 个`);
    
    // 🔑 优先使用 opencodeSessionId 恢复对话（如果有 running 状态节点且有 sessionId）
    console.log(`${LOG_RECOVER} Step 7: 检查 running 节点...`);
    const nodeExecutions = evaluation.NodeExecution || [];
    console.log(`${LOG_RECOVER}   nodeExecutions 数量: ${nodeExecutions.length}`);
    
    const runningNode = nodeExecutions.find((n: any) => n.status === 'running');
    console.log(`${LOG_RECOVER}   runningNode: ${runningNode ? '找到' : '未找到'}`);
    
    if (runningNode) {
      console.log(`${LOG_RECOVER}   runningNode.workflowNodeId: ${runningNode.workflowNodeId}`);
      console.log(`${LOG_RECOVER}   runningNode.nodeLabel: ${runningNode.nodeLabel}`);
      console.log(`${LOG_RECOVER}   runningNode.opencodeSessionId: ${runningNode.opencodeSessionId || '无'}`);
    }
    
    if (runningNode && runningNode.opencodeSessionId) {
      console.log(`${LOG_RECOVER} ✅ 发现 running 节点有 opencodeSessionId，优先恢复对话`);
      console.log(`${LOG_RECOVER}   opencodeSessionId: ${runningNode.opencodeSessionId}`);
      
      // 尝试通过 opencodeSessionId 恢复对话
      const recoveryResult = await recoverNodeConversation(evaluation, runningNode, modelConfig, mcpServers);
      
      console.log(`${LOG_RECOVER}   recoveryResult.success: ${recoveryResult.success}`);
      console.log(`${LOG_RECOVER}   recoveryResult.error: ${recoveryResult.error || '无'}`);
      
if (recoveryResult.success) {
        console.log(`${LOG_RECOVER} ✅ opencodeSessionId 恢复对话成功`);
        return { success: true };
      } else {
        console.log(`${LOG_RECOVER} ❌ opencodeSessionId 恢复对话失败: ${recoveryResult.error}`);
        console.log(`${LOG_RECOVER} 从头启动评估`);
        
        // 解锁项目
        await unlockProject(projectId);
        
        // 改状态为 queued
        await prisma.evaluationSession.update({
          where: { id: evaluation.id },
          data: {
            status: 'queued',
            lastActivity: new Date(),
          },
        });
        
        // 调用 startQueuedEvaluation 从头启动
        const { startQueuedEvaluation } = await import('@/services/start-evaluation');
        const startResult = await startQueuedEvaluation(evaluation.id);
        
        console.log(`${LOG_RECOVER} startQueuedEvaluation 结果: ${startResult.success}`);
        
        return { success: startResult.success, error: startResult.error };
      }
    } else {
      console.log(`${LOG_RECOVER} ⚠️ 没有找到有 opencodeSessionId 的 running 节点`);
      
      // 从头启动评估
      console.log(`${LOG_RECOVER} 从头启动评估: 改状态为 queued，调用 startQueuedEvaluation`);
      
      // 解锁项目（startQueuedEvaluation 会重新锁定）
      await unlockProject(projectId);
      
      // 改状态为 queued
      await prisma.evaluationSession.update({
        where: { id: evaluation.id },
        data: {
          status: 'queued',
          lastActivity: new Date(),
        },
      });
      
      // 调用 startQueuedEvaluation 从头启动
      const { startQueuedEvaluation } = await import('@/services/start-evaluation');
      const startResult = await startQueuedEvaluation(evaluation.id);
      
      console.log(`${LOG_RECOVER} startQueuedEvaluation 结果: ${startResult.success}`);
      
      return { success: startResult.success, error: startResult.error };
    }
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    console.log(`${LOG_RECOVER} ❌ recoverEvaluation 异常: ${errorMsg}`);
    console.log(`${LOG_RECOVER} 异常堆栈: ${errorStack}`);
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
    
    // ❌ EvaluationSession 没有 Workflow 关系，需要用 workflowId 查询
    if (!evaluation.workflowId) {
      return { success: false, error: '评估没有关联工作流，无法恢复' };
    }
    
    const workflow = await prisma.workflow.findUnique({
      where: { id: evaluation.workflowId },
    });
    
    if (!workflow) {
      return { success: false, error: '工作流不存在' };
    }
    
    logger.info(LOG_MODULES.EVALUATION, `${LOG_PREFIX} 开始恢复 FSM 评估 ${evaluation.id}`);
    
    // 1. 加载 FSM 模板
    if (!workflow.fsmTemplateId) {
      return { success: false, error: 'FSM 工作流缺少模板ID' };
    }
    
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
        lastActivity: new Date(),
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
    const errorStack = error instanceof Error ? error.stack : '';
    console.log(`[recoverFSMEvaluation] ❌ 异常: ${errorMsg}`);
    console.log(`[recoverFSMEvaluation] 异常堆栈: ${errorStack}`);
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
    
    // ❌ EvaluationSession 没有 Workflow 关系，需要用 workflowId 查询
    if (!evaluation.workflowId) {
      return { success: false, error: '评估没有关联工作流，无法恢复' };
    }
    
    const workflow = await prisma.workflow.findUnique({
      where: { id: evaluation.workflowId },
    });
    
    if (!workflow) {
      return { success: false, error: '工作流不存在' };
    }
    
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
        lastActivity: new Date(),
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
      workflowType: 'custom' as const,  // DAG 使用 'custom' 类型
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
    const errorStack = error instanceof Error ? error.stack : '';
    console.log(`[recoverDAGEvaluation] ❌ 异常: ${errorMsg}`);
    console.log(`[recoverDAGEvaluation] 异常堆栈: ${errorStack}`);
    return { success: false, error: errorMsg };
  }
}