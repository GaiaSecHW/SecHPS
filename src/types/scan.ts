// src/types/scan.ts

export type ScanTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

// 创建扫描任务请求
export interface CreateScanTaskRequest {
  projectId: string;
  name: string;
  description?: string;
  skillIds: string[];
  schedule?: string; // cron 表达式
}

// 更新扫描任务请求
export interface UpdateScanTaskRequest {
  name?: string;
  description?: string;
  skillIds?: string[];
  schedule?: string;
}

// 扫描进度
export interface ScanProgress {
  taskId: string;
  status: ScanTaskStatus;
  progress: number;
  currentSkill: string | null;
  totalSkills: number;
  completedSkills: number;
  findingsCount: number;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
}

// 扫描报告摘要
export interface ScanReportSummary {
  totalFindings: number;
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
  bySkill: Record<string, number>;
  duration: number;
}

// 扫描任务响应
export interface ScanTaskResponse {
  id: string;
  projectId: string;
  userId: string;
  name: string;
  description: string | null;
  skillIds: string[];
  schedule: string | null;
  nextRunAt: Date | null;
  status: ScanTaskStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  progress: number;
  currentSkill: string | null;
  totalSkills: number;
  completedSkills: number;
  findingsCount: number;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// 扫描报告响应
export interface ScanReportResponse {
  id: string;
  scanTaskId: string;
  projectId: string;
  summary: ScanReportSummary;
  details: Record<string, unknown>;
  format: string;
  createdAt: Date;
}

// 扫描任务查询参数
export interface ScanTaskQueryParams {
  projectId?: string;
  status?: ScanTaskStatus;
  page?: number;
  pageSize?: number;
}
