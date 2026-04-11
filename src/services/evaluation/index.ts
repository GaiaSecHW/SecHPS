// src/services/evaluation/index.ts

export { ConversationHistory } from './history';
export { PromptBuilder } from './prompt';
export { EvaluationCaller, createEvaluationCaller } from './caller';
export { EnhancedEvaluationCaller, createEnhancedEvaluationCaller } from './enhanced-caller';

// Ralph Loop Agent 导出
export { RalphLoopAgent, createRalphLoopAgent } from './ralph-loop-agent-wrapper';
export type {
  RalphLoopAgentConfig,
  RalphLoopAgentCallbacks,
  RalphLoopAgentResult,
} from './ralph-loop-agent-wrapper';
export type { VerifyCompletionFunction, VerifyCompletionContext, VerifyCompletionResult } from './ralph-loop-agent-evaluator';

// Ralph Loop Agent 核心函数和类型导出
export {
  iterationCountIs,
  tokenCountIs,
  costIs,
  getModelPricing,
  getModelPricingOrDefault,
  calculateCost,
  addLanguageModelUsage,
  aggregateStepUsage,
  isRalphStopConditionMet,
} from './ralph-loop-agent';
export type {
  RalphStopCondition,
  RalphStopConditionContext,
  CostRates,
} from './ralph-loop-agent';

export type { EvaluationConfig, EvaluationCallbacks } from './caller';
export type { EnhancedEvaluationConfig, EnhancedEvaluationCallbacks, ToolResult } from './enhanced-caller';
export type { PromptContext } from './prompt';
export type { ConversationMessage } from './history';
