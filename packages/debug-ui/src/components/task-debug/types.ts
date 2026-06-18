import type { ReactNode } from 'react';

export type TaskEngine = 'opencode' | 'claudecode' | 'script';
export type ValidationSeverity = 'error' | 'warning';

export interface WorkerOption {
  nodeId: string;
  address: string;
  status: string;
}

export interface TaskDebugForm {
  instruction: string;
  projectPath: string;
  workspacePath: string;
  platformTaskId: string;
  apiKey: string;
  timeoutSec: number;
  preferredWorkerNodeId: string;
  engine: TaskEngine;
  model: string;
  apiBaseUrl: string;
  maxTokens: number;
  contextWindow: number;
  commandJson: string;
  scriptCwd: string;
  toolId: string;
  toolPath: string;
  toolWorkDir: string;
  skills: string;
  mcps: string;
  env: string;
  targetProduct: string;
}

export interface SubmitTaskPayload {
  instruction: string;
  engine: TaskEngine;
  workspacePath?: string;
  projectPath?: string;
  apiKey?: string;
  timeoutSec?: number;
  preferredWorkerNodeId?: string;
  model?: string;
  apiBaseUrl?: string;
  maxTokens?: number;
  contextWindow?: number;
  command?: string[];
  scriptCwd?: string;
  toolId?: string;
  toolPath?: string;
  toolWorkDir?: string;
  skills?: string[];
  mcps?: unknown[];
  env?: Record<string, string>;
  targetProduct?: string;
}

export interface ValidationIssue {
  id: string;
  severity: ValidationSeverity;
  message: string;
}

export interface TaskTemplate {
  id: string;
  label: string;
  description: string;
  engine: TaskEngine;
  icon?: ReactNode;
  apply: (form: TaskDebugForm) => TaskDebugForm;
}

export function createDefaultTaskDebugForm(): TaskDebugForm {
  return {
    instruction: '',
    projectPath: '',
    workspacePath: '',
    platformTaskId: '',
    apiKey: '',
    timeoutSec: 300,
    preferredWorkerNodeId: '',
    engine: 'opencode',
    model: '',
    apiBaseUrl: '',
    maxTokens: 0,
    contextWindow: 0,
    commandJson: '["bash", "scripts/build.sh"]',
    scriptCwd: '',
    toolId: '',
    toolPath: '',
    toolWorkDir: '',
    skills: '',
    mcps: '[]',
    env: '',
    targetProduct: '',
  };
}
