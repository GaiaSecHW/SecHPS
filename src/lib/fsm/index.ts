/**
 * FSM 工作流模块
 * 
 * 导出所有 FSM 相关组件
 */

// 执行器
export { FSMNodeExecutor } from './fsm-node-executor';
export type { FSMExecutionContext, FSMGateState, PhaseOutputData } from './fsm-node-executor';
import { FSMNodeExecutor as _FSMNodeExecutor } from './fsm-node-executor';
export default _FSMNodeExecutor;

// Workflow Execution Service
export { FSMWorkflowExecutionService, createFSMWorkflowExecutionService } from './fsm-workflow-execution-service';
export type {
  FSMExecutionConfig,
  FSMExecutionCallbacks,
  FSMPhaseResult,
  FSMPhaseVerificationResult,
  AgentZoneResult,
  FSMWorkflowResult,
} from './fsm-workflow-execution-service';

// 验证器
export {
  validatePhaseOutput,
  validatePhase1,
  validatePhase2,
  validatePhase3,
  validatePhase4,
} from './validators/phase-validator';
export type { ValidationResult } from './validators/phase-validator';

// Schemas
export * from './schemas/phase-schemas';

// Skill 加载器
export { loadFSMSkill, readPhaseContent } from './fsm-skill-loader';
export type { LoadResult } from './fsm-skill-loader';

// Phase IO
export {
  readPhaseOutput,
  writePhaseOutput,
  updatePhaseOutputStatus,
  readUpstreamPhaseOutputs,
  aggregatePhaseOutputs,
} from './phase-io';
export type { PhaseData } from './phase-io';

// Prompt Builder
export { buildAgentZonePrompt, buildNodeExecutionPrompt } from './fsm-prompt-builder';