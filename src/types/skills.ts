// src/types/skills.ts

// 漏洞分类
export interface Category {
  value: string;
  label: string;
}

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
  category: string;
  cwe?: string;
  systemPrompt: string;
  userPrompt: string;
  tools: string[];
  parameters?: Record<string, unknown>;
  userId?: string | null;  // null = 公共，有值 = 私有
}

// Skill 更新请求
export interface UpdateSkillRequest {
  displayName?: string;
  description?: string;
  category?: string;
  cwe?: string;
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
  userId: string | null;  // null = 公共，有值 = 私有
  name: string;
  displayName: string;
  description: string;
  category: string;
  cwe: string | null;
  systemPrompt: string;
  userPrompt: string;
  tools: string[];
  parameters: Record<string, unknown>;
  isActive: boolean;
  isBuiltin: boolean;
  version: number;
  parentId: string | null;
  isLatest: boolean;
  successRate: number | null;
  avgDuration: number | null;
  execCount: number;
  referenceCount: number;     // 引用次数
  vulnerabilityCount: number; // 发现漏洞次数
  createdAt: Date;
  updatedAt: Date;
}

// Skill 版本信息
export interface SkillVersionInfo {
  id: string;
  version: number;
  isLatest: boolean;
  createdAt: Date;
  changeDesc?: string;  // 从进化记录中获取
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

// 创建 Skill 新版本请求
export interface CreateSkillVersionRequest {
  changeType: EvolutionChangeType;
  changeDesc: string;
  reason: EvolutionReason;
  updates: UpdateSkillRequest;
}

// 回滚 Skill 版本请求
export interface RollbackSkillVersionRequest {
  targetVersionId: string;
  reason: string;
}
