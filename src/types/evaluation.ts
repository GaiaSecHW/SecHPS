// src/types/evaluation.ts

export type EvaluationStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export type ProgressStatus = 'idle' | 'connecting' | 'streaming' | 'completed' | 'error';

export interface EvaluationProgress {
  evaluationId: string;
  status: ProgressStatus;
  progress: number; // 0-100
  message?: string;
  errorMessage?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface EvaluationSession {
  id: string;
  projectId: string;
  status: EvaluationStatus;
  startedAt: Date;
  completedAt?: Date;
  errorMessage?: string;
  messageCount: number;
  skillsUsed?: string[]; // 使用的 Skills 列表
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

export interface ProjectInfo {
  id: string;
  name: string;
  description?: string;
  environmentUrl?: string;
  files: Array<{
    id: string;
    name: string;
    type: string;
    size: number;
  }>;
}

/**
 * 评估结果摘要
 */
export interface EvaluationResultSummary {
  evaluationId: string;
  totalVulns: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  skillsUsed: string[];
  createdAt: Date;
}

/**
 * Skill 使用统计
 */
export interface SkillUsageStats {
  skillName: string;
  count: number;
  successRate: number;
  avgDuration: number;
}
