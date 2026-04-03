// src/types/skills.ts

export type SkillCategory =
  | 'code-audit'
  | 'auth'
  | 'sensitive'
  | 'api'
  | 'config'
  | 'crypto'
  | 'web'
  | 'business'
  | 'client'
  | 'cloud';

export type SkillSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type SkillExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type EvolutionChangeType =
  | 'prompt-update'
  | 'parameter-tune'
  | 'tool-add'
  | 'tool-remove';

export type EvolutionReason =
  | '手动调整'
  | '自动优化'
  | '误报反馈'
  | '漏报反馈';

// Skill 创建请求
export interface CreateSkillRequest {
  name: string;
  displayName: string;
  description: string;
  category: SkillCategory;
  cwe?: string;
  severity: SkillSeverity;
  systemPrompt: string;
  userPrompt: string;
  tools: string[];
  parameters?: Record<string, unknown>;
}

// Skill 更新请求
export interface UpdateSkillRequest {
  displayName?: string;
  description?: string;
  category?: SkillCategory;
  cwe?: string;
  severity?: SkillSeverity;
  systemPrompt?: string;
  userPrompt?: string;
  tools?: string[];
  parameters?: Record<string, unknown>;
  isActive?: boolean;
}

// Skill 执行请求
export interface ExecuteSkillRequest {
  projectId: string;
  parameters?: Record<string, unknown>;
}

// Skill 执行反馈
export interface SkillFeedbackRequest {
  confirmed?: boolean;
  falsePositive?: boolean;
  comments?: string;
}

// Skill 进化请求
export interface EvolveSkillRequest {
  changeType: EvolutionChangeType;
  changeDesc: string;
  reason: EvolutionReason;
  beforeData: Record<string, unknown>;
  afterData: Record<string, unknown>;
}

// Skill 响应
export interface SkillResponse {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: SkillCategory;
  cwe: string | null;
  severity: SkillSeverity;
  systemPrompt: string;
  userPrompt: string;
  tools: string[];
  parameters: Record<string, unknown>;
  isActive: boolean;
  isBuiltin: boolean;
  version: number;
  successRate: number | null;
  avgDuration: number | null;
  execCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// Skill 执行响应
export interface SkillExecutionResponse {
  id: string;
  skillId: string;
  projectId: string;
  scanTaskId: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: SkillExecutionStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  duration: number | null;
  error: string | null;
  findingsCount: number;
  confirmedCount: number;
  falsePositiveCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: Date;
}
