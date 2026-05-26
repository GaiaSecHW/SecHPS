// src/types/ralph-loop-config.ts
//
// Ralph Loop 配置和验证接口定义
// 用于 AgentTeam 的迭代执行模式
//

import type { ExperienceMatch } from '@/services/autonomous-evolution/experience-query-service';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * Ralph Loop 配置
 * 存储在 AgentTeam.ralphConfig (JSON 字符串)
 */
export interface RalphLoopConfig {
  /**
   * 最大迭代次数
   * @default 10
   */
  maxIterations: number;

  /**
   * 最大成本 (USD)
   * @default 5.00
   */
  maxCostUsd: number;

  /**
   * 验证脚本路径或内联代码
   * 可选，如果不提供则使用默认验证器
   */
  verifyCompletion?: string;

  /**
   * 经验学习触发时机
   * - on_failure: 仅验证失败时查询经验 (推荐)
   * - always: 每次迭代后都查询
   * - disabled: 禁用经验学习
   * @default "on_failure"
   */
  experienceTrigger: 'on_failure' | 'always' | 'disabled';

  /**
   * 是否启用 Ralph Loop
   * @default false
   */
  enabled: boolean;
}

/**
 * 默认 Ralph Loop 配置
 */
export const DEFAULT_RALPH_LOOP_CONFIG: RalphLoopConfig = {
  maxIterations: 10,
  maxCostUsd: 5.00,
  experienceTrigger: 'on_failure',
  enabled: false,
};

/**
 * 子 Agent 调用记录
 */
export interface SubagentCallRecord {
  /**
   * Agent 名称
   */
  agentName: string;

  /**
   * 执行结果摘要
   */
  result: string;

  /**
   * 消耗的 Token 数量
   */
  tokensUsed: number;

  /**
   * 成本 (USD)
   */
  costUsd?: number;

  /**
   * 执行状态
   */
  status: 'completed' | 'failed' | 'pending';
}

/**
 * Agent Team 验证上下文
 * 扩展自 VerifyCompletionContext，增加 Team 相关信息
 */
export interface AgentTeamVerificationContext {
  /**
   * Lead Agent 最终输出文本
   */
  finalText: string;

  /**
   * 总输入 Token 数
   */
  totalInputTokens: number;

  /**
   * 总输出 Token 数
   */
  totalOutputTokens: number;

  /**
   * 估算成本 (USD)
   */
  estimatedCostUsd: number;

  /**
   * 子 Agent 调用记录
   */
  subagentCalls: SubagentCallRecord[];

  /**
   * 当前迭代次数 (1-indexed)
   */
  iteration: number;

  /**
   * 最大迭代次数
   */
  maxIterations: number;

  /**
   * 相关失败经验 (如果已查询)
   */
  relevantExperiences?: ExperienceMatch[];

  /**
   * 原始任务描述
   */
  originalTask: string;

  /**
   * Team ID
   */
  teamId: string;

  /**
   * Execution ID
   */
  executionId: string;
}

/**
 * Agent Team 验证结果
 */
export interface AgentTeamVerificationResult {
  /**
   * 是否验证完成
   */
  verified: boolean;

  /**
   * 反馈信息
   * - 如果 verified=true，这是完成原因
   * - 如果 verified=false，这是注入到下一轮的建议
   */
  feedback?: string;

  /**
   * 停止原因
   */
  stopReason?: 'verified' | 'max_iterations' | 'max_cost' | 'error' | 'aborted';

  /**
   * 建议的下一步行动
   */
  suggestedAction?: string;
}

/**
 * 验证函数类型
 */
export type AgentTeamVerifyFunction = (
  context: AgentTeamVerificationContext
) => AgentTeamVerificationResult | Promise<AgentTeamVerificationResult>;

/**
 * 迭代记录
 */
export interface IterationRecord {
  /**
   * 迭代次数
   */
  iteration: number;

  /**
   * 开始时间
   */
  startedAt: Date;

  /**
   * 完成时间
   */
  completedAt?: Date;

  /**
   * Lead Agent 输出
   */
  result: string;

  /**
   * 验证结果
   */
  verification: AgentTeamVerificationResult;

  /**
   * Token 使用量
   */
  tokensUsed: {
    input: number;
    output: number;
  };

  /**
   * 成本 (USD)
   */
  costUsd: number;

  /**
   * 是否查询了经验
   */
  experienceQueried: boolean;

  /**
   * 查询到的经验数量
   */
  experiencesFound?: number;
}

/**
 * Ralph Loop 执行结果
 */
export interface RalphLoopExecutionResult {
  /**
   * 最终输出文本
   */
  finalText: string;

  /**
   * 总迭代次数
   */
  totalIterations: number;

  /**
   * 完成原因
   */
  completionReason: 'verified' | 'max_iterations' | 'max_cost' | 'aborted';

  /**
   * 所有迭代记录
   */
  iterations: IterationRecord[];

  /**
   * 总 Token 使用量
   */
  totalTokens: {
    input: number;
    output: number;
  };

  /**
   * 总成本 (USD)
   */
  totalCostUsd: number;

  /**
   * 是否使用了经验学习
   */
  usedExperienceLearning: boolean;
}

/**
 * 解析 RalphLoopConfig JSON
 */
export function parseRalphConfig(json: string | null | undefined): RalphLoopConfig {
  if (!json) {
    return DEFAULT_RALPH_LOOP_CONFIG;
  }

  try {
    const parsed = JSON.parse(json) as Partial<RalphLoopConfig>;
    return {
      ...DEFAULT_RALPH_LOOP_CONFIG,
      ...parsed,
    };
  } catch (error) {
    logger.warn(LOG_MODULES.CONFIG, 'Failed to parse config JSON', { details: { error: error instanceof Error ? error.message : String(error) } });
    return DEFAULT_RALPH_LOOP_CONFIG;
  }
}

/**
 * 序列化 RalphLoopConfig 为 JSON
 */
export function serializeRalphConfig(config: Partial<RalphLoopConfig>): string {
  return JSON.stringify({
    ...DEFAULT_RALPH_LOOP_CONFIG,
    ...config,
  });
}