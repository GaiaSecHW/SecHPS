// src/services/skill-evolution/evolution-scheduler.ts
/**
 * Skill 进化任务调度器
 * 
 * 功能：
 * 1. 定时扫描所有 Skill 的精准率
 * 2. 对低精准率 Skill 创建进化任务
 * 3. 遵守每日最大任务数限制
 * 4. 使用 SkillEvolutionConfig 配置阈值
 */

import { prisma } from '@/lib/prisma';
import { generateId } from '@/lib/id-generator';
import { getLowPrecisionSkills, calculateSkillMetrics, SkillMetrics } from './metrics-calculator';
import type { SkillEvolutionConfig, SkillEvolutionTask, Skill } from '@prisma/client';

/**
 * 默认进化配置常量
 */
export const DEFAULT_EVOLUTION_CONFIG = {
  PRECISION_THRESHOLD: 0.7,
  MIN_FALSE_POSITIVES: 5,
  MIN_CONFIRMED: 3,
  MAX_DAILY_TASKS: 10,
  FALSE_POSITIVE_LIMIT: 10,
  CONFIRMED_LIMIT: 10,
  // 内容处理相关配置
  MAX_CONTENT_LENGTH: 2000,
  MAX_SKILL_CONTENT_LENGTH: 4000,
  LOG_PREVIEW_LENGTH: 500,
} as const;

/**
 * 触发原因类型
 */
export type TriggerReason = 'low_precision' | 'high_false_positive' | 'manual';

/**
 * 扫描结果
 */
export interface ScanResult {
  scannedCount: number;
  createdTasks: SkillEvolutionTask[];
  skippedReasons: Array<{ skillId: string; skillName: string; reason: string }>;
}

/**
 * 触发检查结果
 */
export interface TriggerCheckResult {
  shouldTrigger: boolean;
  reason: string;
  triggerReason?: TriggerReason;
}

/**
 * 获取进化配置（从数据库或使用默认值）
 * 
 * @returns 进化配置
 */
export async function getEvolutionConfig(): Promise<SkillEvolutionConfig> {
  const config = await prisma.skillEvolutionConfig.findUnique({
    where: { id: 'default' },
  });

  if (config && config.isActive) {
    return config;
  }

  // 返回默认配置（模拟 SkillEvolutionConfig 结构）
  return {
    id: 'default',
    precisionThreshold: DEFAULT_EVOLUTION_CONFIG.PRECISION_THRESHOLD,
    minFalsePositives: DEFAULT_EVOLUTION_CONFIG.MIN_FALSE_POSITIVES,
    minConfirmed: DEFAULT_EVOLUTION_CONFIG.MIN_CONFIRMED,
    falsePositiveLimit: DEFAULT_EVOLUTION_CONFIG.FALSE_POSITIVE_LIMIT,
    confirmedLimit: DEFAULT_EVOLUTION_CONFIG.CONFIRMED_LIMIT,
    scheduleCron: '0 3 * * *',
    maxDailyTasks: DEFAULT_EVOLUTION_CONFIG.MAX_DAILY_TASKS,
    maxDescriptionLength: 200,
    codeSnippetLines: 6,
    isActive: true,
    updatedAt: new Date(),
  };
}

/**
 * 检查是否应该触发进化
 * 
 * @param skillId Skill ID
 * @param config 进化配置
 * @returns 触发检查结果
 */
export async function shouldTriggerEvolution(
  skillId: string,
  config: SkillEvolutionConfig
): Promise<TriggerCheckResult> {
  // 获取 Skill 指标
  const metrics = await calculateSkillMetrics(skillId);

  // 检查是否有足够的执行数据
  if (metrics.totalExecutions === 0) {
    return {
      shouldTrigger: false,
      reason: 'No execution data available',
    };
  }

  // 检查是否有足够的确认和误报数据
  if (metrics.confirmedCount < config.minConfirmed) {
    return {
      shouldTrigger: false,
      reason: `Insufficient confirmed cases (${metrics.confirmedCount} < ${config.minConfirmed})`,
    };
  }

  if (metrics.falsePositiveCount < config.minFalsePositives) {
    return {
      shouldTrigger: false,
      reason: `Insufficient false positive cases (${metrics.falsePositiveCount} < ${config.minFalsePositives})`,
    };
  }

  // 检查精准率是否低于阈值
  if (metrics.precision < config.precisionThreshold) {
    return {
      shouldTrigger: true,
      reason: `Precision below threshold (${metrics.precision.toFixed(2)} < ${config.precisionThreshold})`,
      triggerReason: 'low_precision',
    };
  }

  // 检查误报数是否过高（即使精准率达标）
  if (metrics.falsePositiveCount >= config.falsePositiveLimit) {
    return {
      shouldTrigger: true,
      reason: `High false positive count (${metrics.falsePositiveCount} >= ${config.falsePositiveLimit})`,
      triggerReason: 'high_false_positive',
    };
  }

  return {
    shouldTrigger: false,
    reason: 'Precision meets threshold and false positives within limit',
  };
}

/**
 * 检查今日已创建的任务数
 * 
 * @returns 今日已创建的任务数
 */
export async function getTodayTaskCount(): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const count = await prisma.skillEvolutionTask.count({
    where: {
      createdAt: {
        gte: today,
      },
    },
  });

  return count;
}

/**
 * 检查 Skill 是否已有待处理的进化任务
 * 
 * @param skillId Skill ID
 * @returns 是否有待处理任务
 */
export async function hasPendingTask(skillId: string): Promise<boolean> {
  const count = await prisma.skillEvolutionTask.count({
    where: {
      skillId,
      status: 'pending',
    },
  });

  return count > 0;
}

/**
 * 创建进化任务
 * 
 * @param skillId Skill ID
 * @param triggerReason 触发原因
 * @param metrics Skill 指标
 * @returns 创建的进化任务
 */
export async function createEvolutionTask(
  skillId: string,
  triggerReason: TriggerReason,
  metrics: SkillMetrics
): Promise<SkillEvolutionTask> {
  const task = await prisma.skillEvolutionTask.create({
    data: {
      id: generateId('evotask'),
      skillId,
      triggerReason,
      falsePositiveCount: metrics.falsePositiveCount,
      confirmedCount: metrics.confirmedCount,
      precisionBefore: metrics.precision,
      status: 'pending',
    },
  });

  return task;
}

/**
 * 扫描所有 Skill 并创建进化任务
 * 
 * @param config 可选的部分配置（覆盖默认配置）
 * @returns 扫描结果
 */
export async function scanAndCreateEvolutionTasks(
  config?: Partial<SkillEvolutionConfig>
): Promise<ScanResult> {
  // 获取配置
  const evolutionConfig = await getEvolutionConfig();
  
  // 应用可选的覆盖配置
  const finalConfig = {
    ...evolutionConfig,
    ...config,
  };

  // 检查今日任务数限制
  const todayTaskCount = await getTodayTaskCount();
  const remainingSlots = finalConfig.maxDailyTasks - todayTaskCount;

  if (remainingSlots <= 0) {
    return {
      scannedCount: 0,
      createdTasks: [],
      skippedReasons: [{
        skillId: '',
        skillName: '',
        reason: `Daily task limit reached (${todayTaskCount}/${finalConfig.maxDailyTasks})`,
      }],
    };
  }

  // 获取低精准率 Skill 列表
  const lowPrecisionSkills = await getLowPrecisionSkills(finalConfig.precisionThreshold);

  // 获取所有活跃 Skill（用于完整扫描，排除内置基础设施 skill）
  const allActiveSkills = await prisma.skill.findMany({
    where: { isActive: true, isBuiltin: false },
    select: {
      id: true,
      name: true,
      displayName: true,
    },
  });

  const scannedCount = allActiveSkills.length;
  const createdTasks: SkillEvolutionTask[] = [];
  const skippedReasons: Array<{ skillId: string; skillName: string; reason: string }> = [];

  // 处理低精准率 Skill
  for (const metrics of lowPrecisionSkills) {
    // 检查是否还有剩余名额
    if (createdTasks.length >= remainingSlots) {
      skippedReasons.push({
        skillId: metrics.skillId,
        skillName: metrics.skillName,
        reason: 'Daily task limit reached during processing',
      });
      break;
    }

    // 检查是否已有待处理任务
    if (await hasPendingTask(metrics.skillId)) {
      skippedReasons.push({
        skillId: metrics.skillId,
        skillName: metrics.skillName,
        reason: 'Already has pending evolution task',
      });
      continue;
    }

    // 检查是否满足触发条件
    const triggerCheck = await shouldTriggerEvolution(metrics.skillId, finalConfig);
    
    if (triggerCheck.shouldTrigger && triggerCheck.triggerReason) {
      const task = await createEvolutionTask(
        metrics.skillId,
        triggerCheck.triggerReason,
        metrics
      );
      createdTasks.push(task);
    } else {
      skippedReasons.push({
        skillId: metrics.skillId,
        skillName: metrics.skillName,
        reason: triggerCheck.reason,
      });
    }
  }

  // 检查高误报但精准率达标的 Skill
  // 这些 Skill 可能不在 lowPrecisionSkills 中，但仍需要关注
  for (const skill of allActiveSkills) {
    // 跳过已处理的 Skill
    if (lowPrecisionSkills.some(s => s.skillId === skill.id)) {
      continue;
    }

    // 检查是否还有剩余名额
    if (createdTasks.length >= remainingSlots) {
      break;
    }

    // 检查是否已有待处理任务
    if (await hasPendingTask(skill.id)) {
      continue;
    }

    // 计算指标
    const metrics = await calculateSkillMetrics(skill.id);
    
    // 检查高误报情况
    if (metrics.falsePositiveCount >= finalConfig.falsePositiveLimit) {
      const task = await createEvolutionTask(
        skill.id,
        'high_false_positive',
        metrics
      );
      createdTasks.push(task);
    }
  }

  return {
    scannedCount,
    createdTasks,
    skippedReasons,
  };
}

/**
 * 手动触发 Skill 进化任务
 * 
 * @param skillId Skill ID
 * @returns 创建的进化任务或错误信息
 */
export async function manualTriggerEvolution(
  skillId: string
): Promise<{ task?: SkillEvolutionTask; error?: string }> {
  // 检查 Skill 是否存在
  const skill = await prisma.skill.findUnique({
    where: { id: skillId },
  });

  if (!skill) {
    return { error: `Skill not found: ${skillId}` };
  }

  // 检查是否已有待处理任务
  if (await hasPendingTask(skillId)) {
    return { error: 'Skill already has pending evolution task' };
  }

  // 获取指标
  const metrics = await calculateSkillMetrics(skillId);

  // 创建手动触发任务
  const task = await createEvolutionTask(skillId, 'manual', metrics);

  return { task };
}

/**
 * 获取进化任务统计
 * 
 * @returns 任务统计信息
 */
export async function getEvolutionTaskStats(): Promise<{
  pending: number;
  analyzing: number;
  completed: number;
  rejected: number;
  total: number;
}> {
  const stats = await prisma.skillEvolutionTask.groupBy({
    by: ['status'],
    _count: true,
  });

  const result = {
    pending: 0,
    analyzing: 0,
    completed: 0,
    rejected: 0,
    total: 0,
  };

  for (const stat of stats) {
    result.total += stat._count;
    switch (stat.status) {
      case 'pending':
        result.pending = stat._count;
        break;
      case 'analyzing':
        result.analyzing = stat._count;
        break;
      case 'completed':
        result.completed = stat._count;
        break;
      case 'rejected':
        result.rejected = stat._count;
        break;
    }
  }

  return result;
}