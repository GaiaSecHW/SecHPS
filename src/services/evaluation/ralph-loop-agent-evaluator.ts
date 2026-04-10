// src/services/evaluation/ralph-loop-agent-evaluator.ts
//
// Ralph Loop Agent 验证器
// 定义完成验证的接口和类型
//

import type { GenerateTextResult, ToolSet } from 'ai';

/**
 * 验证上下文
 */
export interface VerifyCompletionContext<TOOLS extends ToolSet = {}> {
  /**
   * 当前迭代的结果
   */
  readonly result: GenerateTextResult<TOOLS, never>;

  /**
   * 当前迭代次数（1-indexed）
   */
  readonly iteration: number;

  /**
   * 所有已完成迭代的结果
   */
  readonly allResults: Array<GenerateTextResult<TOOLS, never>>;

  /**
   * 原始提示/任务
   */
  readonly originalPrompt: string;
}

/**
 * 验证结果
 */
export interface VerifyCompletionResult {
  /**
   * 任务是否完成
   */
  readonly complete: boolean;

  /**
   * 原因或反馈
   * - 如果 complete=true，这是完成原因
   * - 如果 complete=false，这是反馈给下一次迭代的建议
   */
  readonly reason?: string;
}

/**
 * 验证函数类型
 */
export type VerifyCompletionFunction<TOOLS extends ToolSet = {}> = (
  context: VerifyCompletionContext<TOOLS>,
) => VerifyCompletionResult | Promise<VerifyCompletionResult>;
