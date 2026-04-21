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
import { getEvolutionConfig } from './evolution-scheduler';
import { analyzeBalance } from './balance-analyzer';
import { generateImprovement } from './improvement-generator';
import { getCompactCases } from './case-extractor';
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

  console.log(`[TaskManager] Task ${taskId} started processing`);
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

  console.log(`[TaskManager] Task ${taskId} completed with improvement ${improvementId}`);
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

  console.log(`[TaskManager] Task ${taskId} rejected: ${reason}`);
}

// ============================================================================
// 任务处理
// ============================================================================

/**
 * 处理单个进化任务
 * 
 * 流程：
 * 1. 获取任务和 Skill
 * 2. 获取精简案例（误报 + 正确发现）
 * 3. 运行平衡分析
 * 4. 生成改进内容
 * 5. 更新任务状态
 * 
 * @param taskId 任务 ID
 * @returns 处理结果
 */
export async function processEvolutionTask(taskId: string): Promise<TaskProcessResult> {
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
      return {
        success: false,
        error: `Task not found: ${taskId}`,
      };
    }

    if (task.status !== 'pending' && task.status !== 'analyzing') {
      return {
        success: false,
        error: `Task status is not pending or analyzing: ${task.status}`,
      };
    }

    // 2. 开始处理（状态 → analyzing）
    if (task.status === 'pending') {
      await startTaskProcessing(taskId);
    }

    // 3. 获取 Skill 内容
    const skill = task.Skill;
    if (!skill) {
      await rejectTask(taskId, 'Skill not found', `Skill ID: ${task.skillId}`);
      return {
        success: false,
        error: 'Skill not found',
      };
    }

    const skillContent = skill.content || '';

    if (!skillContent) {
      await rejectTask(taskId, 'Skill content is empty');
      return {
        success: false,
        error: 'Skill content is empty',
      };
    }

    // 4. 获取进化配置
    const config = await getEvolutionConfig();

    // 5. 获取精简案例
    console.log(`[TaskManager] Getting compact cases for skill ${skill.id}`);
    const casesResult = await getCompactCases(skill.id, {
      falsePositiveLimit: config.falsePositiveLimit,
      confirmedLimit: config.confirmedLimit,
      maxDescriptionLength: config.maxDescriptionLength,
      codeSnippetLines: config.codeSnippetLines,
    });

    const falsePositives = casesResult.falsePositives;
    const confirmedCases = casesResult.confirmedCases;

    // 检查是否有足够的案例
    if (falsePositives.length === 0) {
      await rejectTask(taskId, 'No false positive cases available');
      return {
        success: false,
        error: 'No false positive cases available for analysis',
      };
    }

    if (confirmedCases.length === 0) {
      await rejectTask(taskId, 'No confirmed cases available');
      return {
        success: false,
        error: 'No confirmed cases available for analysis',
      };
    }

    console.log(`[TaskManager] Found ${falsePositives.length} false positives, ${confirmedCases.length} confirmed cases`);

    // 6. 运行平衡分析
    console.log(`[TaskManager] Running balance analysis for task ${taskId}`);
    const analysisResult = await analyzeBalance(
      skillContent,
      falsePositives,
      confirmedCases
    );

    console.log(`[TaskManager] Analysis complete: ${analysisResult.recommendations.length} recommendations`);

    // 7. 生成改进内容
    console.log(`[TaskManager] Generating improvement for task ${taskId}`);
    const improvementResult = await generateImprovement(
      skill.id,
      skillContent,
      analysisResult,
      falsePositives,
      confirmedCases,
      { taskId }
    );

    console.log(`[TaskManager] Improvement generated: ${improvementResult.improvementId}`);

    // 8. 完成任务
    await completeTask(taskId, improvementResult.improvementId, analysisResult);

    return {
      success: true,
      improvementId: improvementResult.improvementId,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[TaskManager] Task processing failed: ${errorMessage}`);

    // 尝试拒绝任务
    try {
      await rejectTask(taskId, 'Processing failed', errorMessage);
    } catch {
      // 任务可能不存在，忽略
    }

    return {
      success: false,
      error: errorMessage,
    };
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
    console.warn(`[TaskManager] Failed to parse analysis result for task ${taskId}`);
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

  console.log(`[TaskManager] Task ${taskId} cancelled: ${reason}`);
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