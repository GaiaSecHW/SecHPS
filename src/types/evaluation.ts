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

// ============================================
// 技能评估数据架构（新增）
// ============================================

/**
 * 评估配置类型
 * - with_skill: 使用 Skill 的运行
 * - without_skill: 不使用 Skill 的运行（基线对比）
 */
export type SkillEvaluationConfiguration = 'with_skill' | 'without_skill';

/**
 * 断言类型
 */
export type AssertionType = 'detection' | 'remediation' | 'accuracy' | 'coverage' | 'performance';

/**
 * 期望结果（来自 grading.json 的 expectations）
 */
export interface Expectation {
  text: string;
  passed: boolean;
  evidence: string;
  type?: AssertionType;
  metadata?: Record<string, any>;
}

/**
 * 运行结果摘要
 */
export interface RunResultSummary {
  pass_rate: number;
  passed: number;
  failed: number;
  total: number;
  time_seconds: number;
  tokens: number;
}

/**
 * 执行时间信息
 */
export interface ExecutionTiming {
  executor_duration_seconds: number;
  total_duration_seconds: number;
}

/**
 * 输出文件内容
 */
export interface OutputFiles {
  vulnerability_report?: string;
  security_analysis?: string;
  [key: string]: string | undefined;
}

/**
 * 单次评估运行数据结构
 */
export interface SkillEvaluationRun {
  eval_id: number;
  eval_name: string;
  configuration: SkillEvaluationConfiguration;
  run_number: number;
  result: RunResultSummary;
  expectations: Expectation[];
  timing: ExecutionTiming;
  outputs: OutputFiles;
  timestamp?: string;
  dbSessionId?: string;
}

/**
 * 统计指标
 */
export interface StatisticsMetrics {
  mean: number;
  stddev: number;
  min: number;
  max: number;
}

/**
 * 配置级别的统计摘要
 */
export interface ConfigurationSummary {
  pass_rate: StatisticsMetrics;
  time_seconds: StatisticsMetrics;
  tokens: StatisticsMetrics;
}

/**
 * 差异对比
 */
export interface DeltaComparison {
  pass_rate: string;
  time_seconds: string;
  tokens: string;
}

/**
 * 运行级别汇总
 */
export interface SkillRunSummary {
  with_skill: ConfigurationSummary;
  without_skill: ConfigurationSummary;
  delta: DeltaComparison;
}

/**
 * 断言对比结果
 */
export interface ExpectationComparison {
  text: string;
  type?: AssertionType;
  with_skill_passed: boolean;
  with_skill_evidence: string;
  without_skill_passed: boolean;
  without_skill_evidence: string;
  status_change: 'both_pass' | 'both_fail' | 'improved' | 'regressed';
  evidence_comparison?: string;
}

/**
 * 评估对比接口
 */
export interface SkillEvaluationComparison {
  eval_id: number;
  eval_name: string;
  with_skill_run: SkillEvaluationRun;
  without_skill_run: SkillEvaluationRun;
  expectation_comparisons: ExpectationComparison[];
  pass_rate_delta: number;
  time_delta: number;
  token_delta: number;
  improved_count: number;
  regressed_count: number;
  both_pass_count: number;
  both_fail_count: number;
}

/**
 * 评估顶层元数据
 */
export interface SkillEvaluationMetadata {
  skill_name: string;
  skill_path: string;
  executor_model: string;
  timestamp: string;
  evals_run: number[];
  runs_per_configuration: number;
}

/**
 * 完整的评估结果
 */
export interface SkillEvaluationResult {
  metadata: SkillEvaluationMetadata;
  runs: SkillEvaluationRun[];
  run_summary: SkillRunSummary;
  comparisons: SkillEvaluationComparison[];
  notes: string[];
  projectId?: string;
  evaluationSessionId?: string;
  id?: string;
}
