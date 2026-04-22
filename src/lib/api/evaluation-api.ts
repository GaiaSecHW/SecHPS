/**
 * Evaluation API Helper Functions
 * 
 * Frontend helper functions for evaluation API calls.
 * Type-safe wrappers for POST /api/evaluations/start and execute endpoints.
 */

import { apiPost } from '@/lib/api-client';

// ============================================
// Type Definitions
// ============================================

/** Start evaluation request body */
export interface StartEvaluationRequest {
  projectId: string;
  workflowId?: string;
  modelId?: string;
  roleModels?: Array<{ roleId: string; modelId: string }>;
}

/** Start evaluation response */
export interface StartEvaluationResponse {
  evaluationId: string;
  workflowType: 'ralph' | 'fsm' | 'dag';
  nodeCount: number;
  status: 'preparing' | 'ready' | 'failed';
  config: {
    modelId: string;
    modelName: string;
    workflowId?: string;
    roleModels?: Array<{ roleId: string; modelId: string }>;
  };
}

/** Execute evaluation request body */
export interface ExecuteEvaluationRequest {
  maxIterations?: number;
  maxTokens?: number;
  maxCost?: number;
  verifyCompletionConfig?: {
    type: 'tool-call' | 'keyword' | 'custom';
    toolName?: string;
    keywords?: string[];
  };
  fsmTemplateId?: string;
  maxIterationsPerPhase?: number;
  maxCostPerPhase?: number;
}

/** Execute evaluation response */
export interface ExecuteEvaluationResponse {
  success: boolean;
  message: string;
  evaluationId: string;
  config: {
    maxIterations?: number;
    maxTokens?: number;
    maxCost?: number;
    hasVerifyCompletion?: boolean;
    model?: string;
    fsmTemplateId?: string;
    fsmTemplateName?: string;
    maxIterationsPerPhase?: number;
    maxCostPerPhase?: number;
    workspacePath?: string;
  };
}

// ============================================
// API Functions
// ============================================

/**
 * Start a new evaluation session
 * 
 * POST /api/evaluations/start
 * Creates an evaluation session with status='preparing', then 'ready'
 * 
 * @param request - Evaluation start parameters
 * @returns Promise with evaluation session data or error
 */
export async function startEvaluation(
  request: StartEvaluationRequest
): Promise<{ data: StartEvaluationResponse | null; error: string | null }> {
  return apiPost<StartEvaluationResponse>('/api/evaluations/start', request);
}

/**
 * Execute an evaluation session
 * 
 * POST /api/evaluations/[id]/execute
 * Starts the evaluation execution based on workflowType (ralph/fsm/dag)
 * 
 * @param evaluationId - The evaluation session ID
 * @param request - Execution configuration options
 * @returns Promise with execution status or error
 */
export async function executeEvaluation(
  evaluationId: string,
  request: ExecuteEvaluationRequest = {}
): Promise<{ data: ExecuteEvaluationResponse | null; error: string | null }> {
  return apiPost<ExecuteEvaluationResponse>(
    `/api/evaluations/${evaluationId}/execute`,
    request
  );
}