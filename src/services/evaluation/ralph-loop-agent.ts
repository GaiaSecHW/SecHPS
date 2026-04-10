// src/services/evaluation/ralph-loop-agent.ts
//
// Ralph Loop Agent 核心实现
// 基于 ralph-loop-agent 的核心代码，适配到项目现有的评估系统
//

import type {
  ToolSet,
  GenerateTextResult,
} from 'ai';

/**
 * 停止条件上下文
 */
export type RalphStopConditionContext<TOOLS extends ToolSet = {}> = {
  /**
   * 当前迭代次数（1-indexed）
   */
  readonly iteration: number;

  /**
   * 所有已完成迭代的结果
   */
  readonly allResults: Array<GenerateTextResult<TOOLS, never>>;

  /**
   * 聚合的 token 使用量
   */
  readonly totalUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };

  /**
   * 模型标识符
   */
  readonly model: string;
};

/**
 * 停止条件函数
 */
export type RalphStopCondition<TOOLS extends ToolSet = {}> = (
  context: RalphStopConditionContext<TOOLS>
) => PromiseLike<boolean> | boolean;

/**
 * 成本费率（每百万 token）
 */
export type CostRates = {
  inputCostPerMillionTokens: number;
  outputCostPerMillionTokens: number;
  cacheReadCostPerMillionTokens?: number;
  cacheWriteCostPerMillionTokens?: number;
};

/**
 * 常见模型定价
 */
const MODEL_PRICING: Record<string, CostRates> = {
  'anthropic/claude-3.5-sonnet': {
    inputCostPerMillionTokens: 3.0,
    outputCostPerMillionTokens: 15.0,
  },
  'anthropic/claude-sonnet-4': {
    inputCostPerMillionTokens: 3.0,
    outputCostPerMillionTokens: 15.0,
  },
  'anthropic/claude-opus-4.5': {
    inputCostPerMillionTokens: 5.0,
    outputCostPerMillionTokens: 25.0,
  },
  'openai/gpt-4o': {
    inputCostPerMillionTokens: 2.5,
    outputCostPerMillionTokens: 10.0,
  },
  'openai/gpt-4o-mini': {
    inputCostPerMillionTokens: 0.15,
    outputCostPerMillionTokens: 0.6,
  },
};

/**
 * 获取模型定价
 */
export function getModelPricing(model: string): CostRates | undefined {
  return MODEL_PRICING[model];
}

/**
 * 计算 token 使用量
 */
export function addLanguageModelUsage(
  usage1: { inputTokens: number; outputTokens: number; totalTokens: number },
  usage2: { inputTokens: number; outputTokens: number; totalTokens: number }
): { inputTokens: number; outputTokens: number; totalTokens: number } {
  return {
    inputTokens: (usage1.inputTokens || 0) + (usage2.inputTokens || 0),
    outputTokens: (usage1.outputTokens || 0) + (usage2.outputTokens || 0),
    totalTokens: (usage1.totalTokens || 0) + (usage2.totalTokens || 0),
  };
}

/**
 * 聚合步骤的 token 使用量
 */
export function aggregateStepUsage<TOOLS extends ToolSet>(
  result: GenerateTextResult<TOOLS, never>
): { inputTokens: number; outputTokens: number; totalTokens: number } {
  let aggregated = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  for (const step of result.steps) {
    if (step.usage) {
      aggregated = addLanguageModelUsage(aggregated, {
        inputTokens: step.usage.inputTokens || 0,
        outputTokens: step.usage.outputTokens || 0,
        totalTokens: step.usage.totalTokens || 0,
      });
    }
  }

  // 使用 result.usage 和聚合值中的较大者
  return {
    inputTokens: Math.max(aggregated.inputTokens, result.usage.inputTokens || 0),
    outputTokens: Math.max(aggregated.outputTokens, result.usage.outputTokens || 0),
    totalTokens: Math.max(aggregated.totalTokens, result.usage.totalTokens || 0),
  };
}

/**
 * 计算成本
 */
export function calculateCost(
  usage: { inputTokens: number; outputTokens: number; totalTokens: number },
  rates: CostRates
): number {
  const outputTokens = usage.outputTokens || 0;
  const inputTokens = usage.inputTokens || 0;

  const inputCost = (inputTokens / 1_000_000) * rates.inputCostPerMillionTokens;
  const outputCost = (outputTokens / 1_000_000) * rates.outputCostPerMillionTokens;

  return inputCost + outputCost;
}

/**
 * 迭代次数限制
 */
export function iterationCountIs(count: number): RalphStopCondition<any> {
  return ({ iteration }) => iteration >= count;
}

/**
 * Token 总数限制
 */
export function tokenCountIs(maxTokens: number): RalphStopCondition<any> {
  return ({ totalUsage }) => (totalUsage.totalTokens || 0) >= maxTokens;
}

/**
 * 成本限制
 */
export function costIs(
  maxCostDollars: number,
  ratesOrModel?: CostRates | string
): RalphStopCondition<any> {
  return ({ totalUsage, model }) => {
    let rates: CostRates;

    if (typeof ratesOrModel === 'object') {
      rates = ratesOrModel as CostRates;
    } else {
      const modelToUse = typeof ratesOrModel === 'string' ? ratesOrModel : model;
      const pricing = getModelPricing(modelToUse);

      if (!pricing) {
        throw new Error(`Unknown model "${modelToUse}". Provide explicit rates.`);
      }

      rates = pricing;
    }

    const currentCost = calculateCost(totalUsage, rates);
    return currentCost >= maxCostDollars;
  };
}

/**
 * 检查是否满足任何停止条件
 */
export async function isRalphStopConditionMet<TOOLS extends ToolSet>({
  stopConditions,
  context,
}: {
  stopConditions: Array<RalphStopCondition<TOOLS>>;
  context: RalphStopConditionContext<TOOLS>;
}): Promise<boolean> {
  const results = await Promise.all(
    stopConditions.map((condition) => condition(context))
  );
  return results.some((result) => result);
}
