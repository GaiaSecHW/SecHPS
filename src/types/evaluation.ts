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
