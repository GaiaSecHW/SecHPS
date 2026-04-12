// src/services/evaluation/ralph-loop-agent-evaluator.ts
//
// Ralph Loop Agent 验证器
// 定义完成验证的接口和类型
//

/**
 * 简化的 ToolSet 类型（替代 ai 包）
 */
export type SimpleToolSet = Record<string, any>;

/**
 * 简化的 GenerateTextResult 类型（替代 ai 包）
 */
export interface SimpleGenerateTextResult<TOOLS extends SimpleToolSet = {}> {
  readonly text: string;
  readonly toolCalls?: Array<{
    toolName: string;
    args: Record<string, any>;
  }>;
  readonly usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  readonly steps?: Array<{
    readonly usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  }>;
}

/**
 * 验证上下文
 */
export interface VerifyCompletionContext<TOOLS extends SimpleToolSet = {}> {
  /**
   * 当前迭代的结果
   */
  readonly result: SimpleGenerateTextResult<TOOLS>;

  /**
   * 当前迭代次数（1-indexed）
   */
  readonly iteration: number;

  /**
   * 所有已完成迭代的结果
   */
  readonly allResults: Array<SimpleGenerateTextResult<TOOLS>>;

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
export type VerifyCompletionFunction<TOOLS extends SimpleToolSet = {}> = (
  context: VerifyCompletionContext<TOOLS>,
) => VerifyCompletionResult | Promise<VerifyCompletionResult>;
