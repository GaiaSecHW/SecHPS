// src/services/evaluation/index.ts

export { ConversationHistory } from './history';
export { PromptBuilder } from './prompt';
export { EvaluationCaller, createEvaluationCaller } from './caller';
export { EnhancedEvaluationCaller, createEnhancedEvaluationCaller } from './enhanced-caller';

// 结果解析器导出
export { parseAndSaveResults, parseResultsOnly, extractUsedSkills } from './result-parser';

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

// 完成验证器导出
export {
  securityAuditVerifier,
  createKeywordVerifier,
  createJsonReportVerifier,
  createCombinedVerifier,
  createMaxIterationsVerifier,
  createWorkflowNodeVerifier,
  createCustomVerifier,
  defaultVerifier,
} from './verifiers';

export type { EvaluationConfig, EvaluationCallbacks } from './caller';
export type { EnhancedEvaluationConfig, EnhancedEvaluationCallbacks, ToolResult } from './enhanced-caller';
export type { PromptContext } from './prompt';
export type { ConversationMessage } from './history';
