/**
 * Skill 进化任务管理服务
 * 
 * 功能：
 * 1. 获取待处理任务
 * 2. 更新任务状态
 * 3. 处理单个任务（分析 + 生成改进）
 * 4. 获取任务详情
 * 5. 取消/拒绝任务
 */

import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';
import { getEvolutionConfig } from './evolution-scheduler';
import { analyzeInBatches } from './balance-analyzer';
import { generateImprovement } from './improvement-generator';
import { getCompactCases } from './case-extractor';
import { runBacktest, getBacktestDetailRows } from './backtest-validator';
import { createEvolutionAttempt } from './evolution-attempt-manager';
import type { SkillEvolutionTask, Skill, SkillImprovement } from '@prisma/client';
import type { BalanceAnalysisResult } from './balance-analyzer';
import type { CompactCase } from './case-extractor';

// ============================================================================
// Types
// ============================================================================

/**
 * 任务处理结果
 */
export interface TaskProcessResult {
  success: boolean;
  improvementId?: string;
  error?: string;
}

/**
 * 任务详情
 */
export interface TaskDetail {
  task: SkillEvolutionTask;
  skill: {
    id: string;
    name: string;
    displayName: string;
    content: string;
    version: number;
    execCount: number;
    vulnerabilityCount: number;
    successExecCount: number;
    successRate: number | null;
  };
  improvement?: SkillImprovement | null;
}

/**
 * 任务状态值
 */
export type TaskStatus = 'pending' | 'analyzing' | 'completed' | 'rejected';

/**
 * 触发原因类型
 */
export type TriggerReason = 'low_precision' | 'high_false_positive' | 'manual';

// ============================================================================
// 获取任务
// ============================================================================

/**
 * 获取下一个待处理任务（按创建时间排序）
 * 
 * @returns 待处理任务或 null
 */
export async function getNextPendingTask(): Promise<SkillEvolutionTask | null> {
  const task = await prisma.skillEvolutionTask.findFirst({
    where: {
      status: 'pending',
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  return task;
}

/**
 * 获取所有待处理任务
 * 
 * @param limit 最大返回数量（默认 50）
 * @returns 待处理任务列表
 */
export async function getPendingTasks(limit?: number): Promise<SkillEvolutionTask[]> {
  const tasks = await prisma.skillEvolutionTask.findMany({
    where: {
      status: 'pending',
    },
    orderBy: {
      createdAt: 'asc',
    },
    take: limit ?? 50,
  });

  return tasks;
}

/**
 * 获取指定状态的任务列表
 * 
 * @param status 任务状态
 * @param limit 最大返回数量
 * @returns 任务列表
 */
export async function getTasksByStatus(
  status: TaskStatus,
  limit?: number
): Promise<SkillEvolutionTask[]> {
  const tasks = await prisma.skillEvolutionTask.findMany({
    where: {
      status,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: limit ?? 50,
  });

  return tasks;
}

/**
 * 获取所有任务（分页）
 * 
 * @param options 分页和过滤选项
 * @returns 任务列表
 */
export async function getAllTasks(options?: {
  status?: TaskStatus;
  skillId?: string;
  limit?: number;
  offset?: number;
}): Promise<SkillEvolutionTask[]> {
  const tasks = await prisma.skillEvolutionTask.findMany({
    where: {
      ...(options?.status ? { status: options.status } : {}),
      ...(options?.skillId ? { skillId: options.skillId } : {}),
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: options?.limit ?? 50,
    skip: options?.offset ?? 0,
  });

  return tasks;
}

// ============================================================================
// 状态更新
// ============================================================================

/**
 * 开始处理任务（状态 → analyzing）
 * 
 * @param taskId 任务 ID
 * @throws 如果任务不存在或状态不是 pending
 */
export async function startTaskProcessing(taskId: string): Promise<void> {
  const task = await prisma.skillEvolutionTask.findUnique({
    where: { id: taskId },
  });

  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  if (task.status !== 'pending') {
    throw new Error(`Task status is not pending: ${task.status}`);
  }

  await prisma.skillEvolutionTask.update({
    where: { id: taskId },
    data: {
      status: 'analyzing',
    },
  });

  logger.info(LOG_MODULES.SKILL_EVOLUTION, `Task ${taskId} started processing`);
}

/**
 * 完成任务（状态 → completed）
 * 
 * @param taskId 任务 ID
 * @param improvementId 生成的改进记录 ID
 * @param analysisResult 分析结果（可选）
 */
export async function completeTask(
  taskId: string,
  improvementId: string,
  analysisResult?: BalanceAnalysisResult
): Promise<void> {
  await prisma.skillEvolutionTask.update({
    where: { id: taskId },
    data: {
      status: 'completed',
      improvementId,
      analysisResult: analysisResult ? JSON.stringify(analysisResult) : undefined,
      completedAt: new Date(),
    },
  });

  logger.info(LOG_MODULES.SKILL_EVOLUTION, `Task ${taskId} completed with improvement ${improvementId}`);
}

/**
 * 拒绝任务（状态 → rejected）
 * 
 * @param taskId 任务 ID
 * @param reason 拒绝原因
 * @param error 错误信息（可选）
 */
export async function rejectTask(
  taskId: string,
  reason: string,
  error?: string
): Promise<void> {
  const updateData: {
    status: string;
    analysisResult?: string;
    completedAt: Date;
  } = {
    status: 'rejected',
    completedAt: new Date(),
  };

  // 如果有错误信息，记录到 analysisResult
  if (error) {
    updateData.analysisResult = JSON.stringify({
      error,
      reason,
      rejectedAt: new Date().toISOString(),
    });
  }

  await prisma.skillEvolutionTask.update({
    where: { id: taskId },
    data: updateData,
  });

  logger.info(LOG_MODULES.SKILL_EVOLUTION, `Task ${taskId} rejected: ${reason}`);
}

// ============================================================================
// 任务处理
// ============================================================================

/**
 * 处理单个进化任务（带反馈驱动重试）
 * 
 * 流程：
 * 1. 获取任务和 Skill
 * 2. 状态更新: pending → analyzing
 * 3. 获取精简案例（混合策略：失败案例必须包含）
 * 4. 运行平衡分析（传递上次失败信息）
 * 5. 生成改进内容（传递上次失败信息）
 * 6. 自动回测验证
 * 7. 判断回测结果 → 不达标记录失败信息跳回步骤 3，达标完成任务
 * 8. 最多重试 10 次
 * 
 * @param taskId 任务 ID
 * @returns 处理结果
 */
export async function processEvolutionTask(taskId: string): Promise<TaskProcessResult> {
  const MAX_RETRY_COUNT = 10;
  
  let lastFailureReason: string | null = null;
  let lastMissedCases: CompactCase[] = [];
  let lastRemainingFalsePositives: CompactCase[] = [];
  let attemptNumber = 0;
  let successfulAttemptId: string | null = null;
  
  try {
    // 1. 获取任务
    const task = await prisma.skillEvolutionTask.findUnique({
      where: { id: taskId },
      include: {
        Skill: {
          select: {
            id: true,
            name: true,
            displayName: true,
            content: true,
          },
        },
      },
    });

    if (!task) {
      return { success: false, error: `Task not found: ${taskId}` };
    }

    if (task.status !== 'pending' && task.status !== 'analyzing') {
      return { success: false, error: `Task status is not pending or analyzing: ${task.status}` };
    }

    // 2. 开始处理（状态 → analyzing）
    if (task.status === 'pending') {
      await startTaskProcessing(taskId);
    }

    // 3. 获取 Skill 内容
    const skill = task.Skill;
    if (!skill) {
      await rejectTask(taskId, 'Skill not found', `Skill ID: ${task.skillId}`);
      return { success: false, error: 'Skill not found' };
    }

    const skillContent = skill.content || '';
    if (!skillContent) {
      await rejectTask(taskId, 'Skill content is empty');
      return { success: false, error: 'Skill content is empty' };
    }

    // 4. 获取进化配置
    const config = await getEvolutionConfig();

    // ========== 重试循环：最多 10 次 ==========
    while (attemptNumber < MAX_RETRY_COUNT) {
      attemptNumber++;
      logger.info(LOG_MODULES.SKILL_EVOLUTION, `Attempt ${attemptNumber}/${MAX_RETRY_COUNT} for task ${taskId}`);

      // 3. 获取精简案例（混合策略）
      // 第1次：全量获取
      // 第N次：必须包含上次失败案例 + 可更新其他案例
      let falsePositives: CompactCase[];
      let confirmedCases: CompactCase[];

      if (attemptNumber === 1) {
        // 第1次：全量获取
        const casesResult = await getCompactCases(skill.id, {
          falsePositiveLimit: config.falsePositiveLimit,
          confirmedLimit: config.confirmedLimit,
          maxDescriptionLength: config.maxDescriptionLength,
        });
        falsePositives = casesResult.falsePositives;
        confirmedCases = casesResult.confirmedCases;
      } else {
        // 第N次：混合策略 - 失败案例必须包含
        const casesResult = await getCompactCases(skill.id, {
          falsePositiveLimit: config.falsePositiveLimit,
          confirmedLimit: config.confirmedLimit,
          maxDescriptionLength: config.maxDescriptionLength,
        });
        
        // 合并：上次失败案例 + 新获取的案例（去重）
        const fpIds = new Set(lastRemainingFalsePositives.map(c => c.vulnerabilityId));
        const ccIds = new Set(lastMissedCases.map(c => c.vulnerabilityId));
        
        // 失败案例必须包含
        falsePositives = [
          ...lastRemainingFalsePositives,
          ...casesResult.falsePositives.filter(c => !fpIds.has(c.vulnerabilityId))
        ];
        confirmedCases = [
          ...lastMissedCases,
          ...casesResult.confirmedCases.filter(c => !ccIds.has(c.vulnerabilityId))
        ];
      }

      // 检查是否有足够的案例
      if (falsePositives.length === 0) {
        lastFailureReason = 'No false positive cases available for analysis';
        logger.info(LOG_MODULES.SKILL_EVOLUTION, `${lastFailureReason}, attempt ${attemptNumber}`);
        continue;
      }

      if (confirmedCases.length === 0) {
        lastFailureReason = 'No confirmed cases available for analysis';
        logger.info(LOG_MODULES.SKILL_EVOLUTION, `${lastFailureReason}, attempt ${attemptNumber}`);
        continue;
      }

      logger.info(LOG_MODULES.SKILL_EVOLUTION, `Using ${falsePositives.length} FP cases, ${confirmedCases.length} CC cases`);

      // 4. 运行分批平衡分析（每批 2误报 + 2正确发现）
      logger.info(LOG_MODULES.SKILL_EVOLUTION, `Running balance analysis for task ${taskId}`);
      const analysisResult = await analyzeInBatches(
        skillContent,
        falsePositives,
        confirmedCases,
        {
          batchSize: 2,
          previousFailure: lastFailureReason ?? undefined,
          missedCases: lastMissedCases,
          remainingFalsePositives: lastRemainingFalsePositives,
        }
      );

      logger.info(LOG_MODULES.SKILL_EVOLUTION, `Analysis complete: ${analysisResult.recommendations.length} recommendations`);

      // 5. 生成改进内容（传递失败信息）
      logger.info(LOG_MODULES.SKILL_EVOLUTION, `Generating improvement for task ${taskId}`);
      let improvementResult;
      try {
        improvementResult = await generateImprovement(
          skill.id,
          skillContent,
          analysisResult,
          falsePositives,
          confirmedCases,
          {
            taskId,
            previousFailure: lastFailureReason ?? undefined,
            missedCases: lastMissedCases,
            remainingFalsePositives: lastRemainingFalsePositives,
          }
        );
      } catch (genError) {
        lastFailureReason = genError instanceof Error ? genError.message : 'Failed to generate improvement';
        logger.info(LOG_MODULES.SKILL_EVOLUTION, `Improvement generation failed: ${lastFailureReason}`);
        continue;
      }

      if (!improvementResult.improvementId || !improvementResult.improvedContent) {
        lastFailureReason = 'Improvement generation returned empty result';
        logger.info(LOG_MODULES.SKILL_EVOLUTION, `${lastFailureReason}`);
        continue;
      }

      logger.info(LOG_MODULES.SKILL_EVOLUTION, `Improvement generated: ${improvementResult.improvementId}`);

      // 6. 自动回测验证
      logger.info(LOG_MODULES.SKILL_EVOLUTION, `Running backtest validation for task ${taskId}`);
      
      const backtestResult = await runBacktest(
        improvementResult.improvedContent,
        falsePositives,
        confirmedCases,
        { maxCases: Math.max(falsePositives.length, confirmedCases.length) }
      );

      const backtestDetailRows = getBacktestDetailRows(backtestResult);

      logger.info(LOG_MODULES.SKILL_EVOLUTION, `Backtest result: passed=${backtestResult.isSuccessful}, exclusionRate=${(backtestResult.summary.falsePositiveExclusionRate * 100).toFixed(1)}%, missed=${backtestResult.summary.confirmedMissed}`);

      // 提取失败案例信息（用于下次重试）
      lastMissedCases = backtestResult.confirmedResults
        .filter(r => !r.passed)
        .map(r => r.case);
      lastRemainingFalsePositives = backtestResult.falsePositiveResults
        .filter(r => !r.passed)
        .map(r => r.case);

      // 创建 EvolutionAttempt 记录
      const attemptId = await createEvolutionAttempt({
        taskId,
        attemptNumber,
        falsePositiveCasesUsed: falsePositives,
        confirmedCasesUsed: confirmedCases,
        falsePositivePatterns: analysisResult.falsePositivePatterns,
        confirmedPatterns: analysisResult.confirmedPatterns,
        recommendations: analysisResult.recommendations,
        improvedContent: improvementResult.improvedContent,
        changeSummary: improvementResult.changeSummary,
        backtestResult,
        backtestDetailRows,
        isPassed: backtestResult.isSuccessful,
        failureReason: backtestResult.isSuccessful ? undefined : backtestResult.recommendation,
        missedCasesInfo: lastMissedCases.length > 0 ? lastMissedCases : undefined,
        remainingFalsePositive: lastRemainingFalsePositives.length > 0 ? lastRemainingFalsePositives : undefined,
      });

      // 7. 判断回测结果
      if (!backtestResult.isSuccessful) {
        lastFailureReason = backtestResult.recommendation;
        logger.info(LOG_MODULES.SKILL_EVOLUTION, `Backtest failed: ${lastFailureReason}`);
        logger.info(LOG_MODULES.SKILL_EVOLUTION, `Missed ${lastMissedCases.length} cases, ${lastRemainingFalsePositives.length} FP remaining`);
        continue;
      }

      // 回测达标，完成任务
      logger.info(LOG_MODULES.SKILL_EVOLUTION, `Backtest passed! Completing task ${taskId}`);
      successfulAttemptId = attemptId;

      // 8. 完成任务
      await completeTask(taskId, improvementResult.improvementId, analysisResult);

      return {
        success: true,
        improvementId: improvementResult.improvementId,
      };
    }

    // 10次都失败
    const finalError = `Max retry count (${MAX_RETRY_COUNT}) reached. Last failure: ${lastFailureReason}`;
    logger.error(LOG_MODULES.SKILL_EVOLUTION, `Task processing failed after ${MAX_RETRY_COUNT} attempts: ${finalError}`);
    
    await rejectTask(taskId, 'Max retry count reached', finalError);

    return { success: false, error: finalError };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(LOG_MODULES.SKILL_EVOLUTION, `Task processing failed: ${errorMessage}`);

    try {
      await rejectTask(taskId, 'Processing failed', errorMessage);
    } catch {
      // 任务可能不存在，忽略
    }

    return { success: false, error: errorMessage };
  }
}

/**
 * 批量处理待处理任务
 * 
 * @param limit 最大处理数量
 * @returns 处理结果列表
 */
export async function processPendingTasks(limit?: number): Promise<TaskProcessResult[]> {
  const tasks = await getPendingTasks(limit);
  const results: TaskProcessResult[] = [];

  for (const task of tasks) {
    const result = await processEvolutionTask(task.id);
    results.push(result);
  }

  return results;
}

// ============================================================================
// 任务详情
// ============================================================================

/**
 * 获取任务详情（包含 Skill 和 Improvement）
 * 
 * @param taskId 任务 ID
 * @returns 任务详情或 null
 */
export async function getTaskDetail(taskId: string): Promise<TaskDetail | null> {
  const task = await prisma.skillEvolutionTask.findUnique({
    where: { id: taskId },
    include: {
      Skill: {
        select: {
          id: true,
          name: true,
          displayName: true,
          content: true,
          version: true,
          execCount: true,
          vulnerabilityCount: true,
          successExecCount: true,
          successRate: true,
        },
      },
      SkillImprovement: true,
    },
  });

  if (!task) {
    return null;
  }

  return {
    task,
    skill: {
      id: task.Skill?.id ?? '',
      name: task.Skill?.name ?? '',
      displayName: task.Skill?.displayName ?? '',
      content: task.Skill?.content ?? '',
      version: task.Skill?.version ?? 1,
      execCount: task.Skill?.execCount ?? 0,
      vulnerabilityCount: task.Skill?.vulnerabilityCount ?? 0,
      successExecCount: task.Skill?.successExecCount ?? 0,
      successRate: task.Skill?.successRate ?? null,
    },
    improvement: task.SkillImprovement,
  };
}

/**
 * 获取任务的完整分析结果
 * 
 * @param taskId 任务 ID
 * @returns 分析结果或 null
 */
export async function getTaskAnalysisResult(
  taskId: string
): Promise<BalanceAnalysisResult | null> {
  const task = await prisma.skillEvolutionTask.findUnique({
    where: { id: taskId },
    select: {
      analysisResult: true,
    },
  });

  if (!task || !task.analysisResult) {
    return null;
  }

  try {
    return JSON.parse(task.analysisResult) as BalanceAnalysisResult;
  } catch {
    logger.warn(LOG_MODULES.SKILL_EVOLUTION, `Failed to parse analysis result for task ${taskId}`);
    return null;
  }
}

// ============================================================================
// 任务取消
// ============================================================================

/**
 * 取消/拒绝任务
 * 
 * @param taskId 任务 ID
 * @param reason 取消原因
 */
export async function cancelTask(taskId: string, reason: string): Promise<void> {
  const task = await prisma.skillEvolutionTask.findUnique({
    where: { id: taskId },
  });

  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  // 只能取消 pending 或 analyzing 状态的任务
  if (task.status !== 'pending' && task.status !== 'analyzing') {
    throw new Error(`Cannot cancel task with status: ${task.status}`);
  }

  await rejectTask(taskId, reason);

  logger.info(LOG_MODULES.SKILL_EVOLUTION, `Task ${taskId} cancelled: ${reason}`);
}

// ============================================================================
// 统计
// ============================================================================

/**
 * 获取任务统计信息
 * 
 * @returns 各状态的任务数量
 */
export async function getTaskStats(): Promise<{
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

/**
 * 获取 Skill 的任务历史
 * 
 * @param skillId Skill ID
 * @returns 任务列表
 */
export async function getSkillTaskHistory(skillId: string): Promise<SkillEvolutionTask[]> {
  const tasks = await prisma.skillEvolutionTask.findMany({
    where: {
      skillId,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 20,
  });

  return tasks;
}

// ============================================================================
// 导出
// ============================================================================

export default {
  getNextPendingTask,
  getPendingTasks,
  getTasksByStatus,
  getAllTasks,
  startTaskProcessing,
  completeTask,
  rejectTask,
  processEvolutionTask,
  processPendingTasks,
  getTaskDetail,
  getTaskAnalysisResult,
  cancelTask,
  getTaskStats,
  getSkillTaskHistory,
};