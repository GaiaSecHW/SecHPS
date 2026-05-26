/**
 * 运行中的 Agent 注册表
 *
 * 用于跟踪正在运行的 Agent 实例（RalphLoopAgent 和 UnifiedExecutionEngine），
 * 以便在需要时能够中止它们。
 */

import { RalphLoopAgent } from '@/services/evaluation';
import { UnifiedWorkflowExecutionEngine } from '@/lib/workflow/unified-execution-engine';
import { logger, LOG_MODULES } from '@/lib/logger';

// Agent 类型定义（支持多种 agent）
type AgentType = RalphLoopAgent | UnifiedWorkflowExecutionEngine;

// 使用 Map 存储运行中的 agent，key 是 evaluationSessionId
const runningAgents = new Map<string, AgentType>();

/**
 * 注册一个运行中的 agent（支持 RalphLoopAgent 或 UnifiedExecutionEngine）
 */
export function registerAgent(evaluationId: string, agent: AgentType): void {
  runningAgents.set(evaluationId, agent);
  logger.info(LOG_MODULES.AGENT, `注册 agent: ${evaluationId}, 类型: ${agent.constructor.name}, 当前数量: ${runningAgents.size}`);
}

/**
 * 获取 agent
 */
export function getAgent(evaluationId: string): AgentType | undefined {
  return runningAgents.get(evaluationId);
}

/**
 * 移除 agent（当 agent 完成后自动调用）
 */
export function removeAgent(evaluationId: string): boolean {
  const deleted = runningAgents.delete(evaluationId);
  if (deleted) {
    logger.info(LOG_MODULES.AGENT, `移除 agent: ${evaluationId}, 当前数量: ${runningAgents.size}`);
  }
  return deleted;
}

/**
 * 中止 agent
 * 返回 true 表示成功中止，false 表示 agent 不存在
 */
export function abortAgent(evaluationId: string): boolean {
  const agent = runningAgents.get(evaluationId);
  if (agent) {
    logger.info(LOG_MODULES.AGENT, `中止 agent: ${evaluationId}, 类型: ${agent.constructor.name}`);
    // UnifiedExecutionEngine 和 RalphLoopAgent 都有 abort() 方法
    agent.abort();
    runningAgents.delete(evaluationId);
    return true;
  }
  logger.info(LOG_MODULES.AGENT, `尝试中止不存在的 agent: ${evaluationId}`);
  return false;
}

/**
 * 获取所有运行中的 agent 数量
 */
export function getRunningCount(): number {
  return runningAgents.size;
}

/**
 * 检查 agent 是否在运行
 */
export function isAgentRunning(evaluationId: string): boolean {
  return runningAgents.has(evaluationId);
}