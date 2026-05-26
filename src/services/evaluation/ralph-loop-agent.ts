// src/services/evaluation/ralph-loop-agent.ts
//
// Ralph Loop Agent 核心实现
// 基于 ralph-loop-agent 的核心代码，适配到项目现有的评估系统
//

import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * 简化的 ToolSet 类型（替代 ai 包）
 */
type SimpleToolSet = Record<string, any>;

/**
 * 简化的 GenerateTextResult 类型（替代 ai 包）
 */
interface SimpleGenerateTextResult<TOOLS extends SimpleToolSet = {}> {
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
 * 停止条件上下文
 */
export type RalphStopConditionContext<TOOLS extends SimpleToolSet = {}> = {
  /**
   * 当前迭代次数（1-indexed）
   */
  readonly iteration: number;

  /**
   * 所有已完成迭代的结果
   */
  readonly allResults: Array<SimpleGenerateTextResult<TOOLS>>;

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
export type RalphStopCondition<TOOLS extends SimpleToolSet = {}> = (
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
 * 常见模型定价（人民币/百万Token）
 */
const MODEL_PRICING: Record<string, CostRates> = {
  // 公司自部署模型（人民币定价）
  'zai-org/GLM-5': {
    inputCostPerMillionTokens: 6,   // 输入：6元/百万Token
    outputCostPerMillionTokens: 22, // 输出：22元/百万Token
  },
  'THUDM/GLM-4': {
    inputCostPerMillionTokens: 6,
    outputCostPerMillionTokens: 22,
  },
  'glm-5': {
    inputCostPerMillionTokens: 6,
    outputCostPerMillionTokens: 22,
  },
  'glm-4': {
    inputCostPerMillionTokens: 6,
    outputCostPerMillionTokens: 22,
  },
  // Anthropic Claude（美元定价，仅供参考）
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
  // OpenAI GPT（美元定价，仅供参考）
  'openai/gpt-4o': {
    inputCostPerMillionTokens: 2.5,
    outputCostPerMillionTokens: 10.0,
  },
  'openai/gpt-4o-mini': {
    inputCostPerMillionTokens: 0.15,
    outputCostPerMillionTokens: 0.6,
  },
  'gpt-4o': {
    inputCostPerMillionTokens: 2.5,
    outputCostPerMillionTokens: 10.0,
  },
  'gpt-4o-mini': {
    inputCostPerMillionTokens: 0.15,
    outputCostPerMillionTokens: 0.6,
  },
  'claude-3-5-sonnet': {
    inputCostPerMillionTokens: 3.0,
    outputCostPerMillionTokens: 15.0,
  },
};

/**
 * 获取模型定价
 */
export function getModelPricing(model: string): CostRates | undefined {
  return MODEL_PRICING[model];
}

/**
 * 获取模型定价，如果不存在则返回默认值（人民币定价）
 */
export function getModelPricingOrDefault(model: string): CostRates {
  const pricing = MODEL_PRICING[model];
  if (pricing) {
    return pricing;
  }
  // 对于未知模型，使用默认人民币定价
  logger.info(LOG_MODULES.EVALUATION, `模型 "${model}" 未在定价表中，使用默认定价（人民币）`);
  return {
    inputCostPerMillionTokens: 6,   // 输入：6元/百万Token
    outputCostPerMillionTokens: 22, // 输出：22元/百万Token
  };
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
export function aggregateStepUsage<TOOLS extends SimpleToolSet>(
  result: SimpleGenerateTextResult<TOOLS>
): { inputTokens: number; outputTokens: number; totalTokens: number } {
  let aggregated = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  for (const step of result.steps || []) {
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
    inputTokens: Math.max(aggregated.inputTokens, result.usage?.inputTokens || 0),
    outputTokens: Math.max(aggregated.outputTokens, result.usage?.outputTokens || 0),
    totalTokens: Math.max(aggregated.totalTokens, result.usage?.totalTokens || 0),
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
      // 使用默认定价而不是抛出错误
      rates = getModelPricingOrDefault(modelToUse);
    }

    const currentCost = calculateCost(totalUsage, rates);
    return currentCost >= maxCostDollars;
  };
}

/**
 * 检查是否满足任何停止条件
 */
export async function isRalphStopConditionMet<TOOLS extends SimpleToolSet>({
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
