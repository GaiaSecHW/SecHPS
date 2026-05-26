// src/services/skill-evolution/effect-comparator.ts
/**
 * Skill 进化效果对比服务
 * 
 * 功能：
 * 1. 对比新旧版本 Skill 的指标变化
 * 2. 计算精准率和召回率变化
 * 3. 判断进化是否成功
 * 4. 更新 SkillEvolutionTask 的后置指标
 */

import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';
import { calculateSkillMetrics, SkillMetrics } from './metrics-calculator';

/**
 * 进化效果对比结果
 */
export interface EvolutionComparisonResult {
  oldVersion: number;
  newVersion: number;
  precisionBefore: number;
  precisionAfter: number;
  precisionChange: number;      // positive = improved
  recallBefore: number;
  recallAfter: number;
  recallChange: number;
  falsePositiveRateBefore: number;
  falsePositiveRateAfter: number;
  falsePositiveRateChange: number;
  isSuccess: boolean;           // precision improved AND recall not decreased significantly
  successReason: string;
}

/**
 * 计算召回率（确认率）
 * 
 * 在漏洞检测场景中，recall 定义为：
 * recall = confirmedCount / totalFindings
 * 
 * 这表示报告的发现中有多少被确认为真实漏洞
 * 
 * @param metrics Skill 指标数据
 * @returns 召回率
 */
function calculateRecall(metrics: SkillMetrics): number {
  // 如果没有发现，召回率为 0
  if (metrics.totalFindings === 0) {
    return 0;
  }
  
  // recall = confirmed / total findings
  return metrics.confirmedCount / metrics.totalFindings;
}

/**
 * 对比新旧版本 Skill 的进化效果
 * 
 * @param oldSkillId 旧版本 Skill ID
 * @param newSkillId 新版本 Skill ID
 * @param timeRange 可选的时间范围过滤
 * @returns 进化效果对比结果
 */
export async function compareEvolutionEffect(
  oldSkillId: string,
  newSkillId: string,
  timeRange?: { start: Date; end: Date }
): Promise<EvolutionComparisonResult> {
  // 获取新旧版本的 Skill 信息
  const oldSkill = await prisma.skill.findUnique({
    where: { id: oldSkillId },
    select: { id: true, version: true },
  });
  
  const newSkill = await prisma.skill.findUnique({
    where: { id: newSkillId },
    select: { id: true, version: true },
  });
  
  if (!oldSkill) {
    throw new Error(`Old skill not found: ${oldSkillId}`);
  }
  
  if (!newSkill) {
    throw new Error(`New skill not found: ${newSkillId}`);
  }
  
  // 计算新旧版本的指标
  const oldMetrics = await calculateSkillMetrics(oldSkillId, timeRange);
  const newMetrics = await calculateSkillMetrics(newSkillId, timeRange);
  
  // 计算召回率
  const recallBefore = calculateRecall(oldMetrics);
  const recallAfter = calculateRecall(newMetrics);
  
  // 计算变化值
  const precisionChange = newMetrics.precision - oldMetrics.precision;
  const recallChange = recallAfter - recallBefore;
  const falsePositiveRateChange = newMetrics.falsePositiveRate - oldMetrics.falsePositiveRate;
  
  // 判断进化是否成功
  // 成功条件：精准率提升 AND 召回率下降不超过 5%
  const isSuccess = precisionChange > 0 && recallChange >= -0.05;
  
  // 生成成功原因说明
  let successReason: string;
  
  if (isSuccess) {
    const precisionImprovement = (precisionChange * 100).toFixed(1);
    successReason = `Precision improved by ${precisionImprovement}% while recall maintained`;
  } else if (precisionChange <= 0) {
    successReason = 'Precision did not improve';
  } else if (recallChange < -0.05) {
    const recallDecrease = (recallChange * 100).toFixed(1);
    successReason = `Recall decreased significantly (${recallDecrease}%)`;
  } else {
    successReason = 'Unknown reason';
  }
  
  return {
    oldVersion: oldSkill.version,
    newVersion: newSkill.version,
    precisionBefore: oldMetrics.precision,
    precisionAfter: newMetrics.precision,
    precisionChange,
    recallBefore,
    recallAfter,
    recallChange,
    falsePositiveRateBefore: oldMetrics.falsePositiveRate,
    falsePositiveRateAfter: newMetrics.falsePositiveRate,
    falsePositiveRateChange,
    isSuccess,
    successReason,
  };
}

/**
 * 更新 SkillEvolutionTask 的后置指标
 * 
 * @param taskId SkillEvolutionTask ID
 * @param comparisonResult 进化效果对比结果
 */
export async function updateEvolutionTaskMetrics(
  taskId: string,
  comparisonResult: EvolutionComparisonResult
): Promise<void> {
  // 更新 SkillEvolutionTask
  await prisma.skillEvolutionTask.update({
    where: { id: taskId },
    data: {
      precisionAfter: comparisonResult.precisionAfter,
      recallAfter: comparisonResult.recallAfter,
      status: comparisonResult.isSuccess ? 'completed' : 'rejected',
      completedAt: new Date(),
      analysisResult: JSON.stringify({
        precisionChange: comparisonResult.precisionChange,
        recallChange: comparisonResult.recallChange,
        falsePositiveRateChange: comparisonResult.falsePositiveRateChange,
        successReason: comparisonResult.successReason,
      }),
    },
  });
}

/**
 * 批量对比多个进化任务的效果
 * 
 * @param tasks 进化任务列表（包含 oldSkillId, newSkillId, taskId）
 * @param timeRange 可选的时间范围过滤
 * @returns 对比结果列表
 */
export async function batchCompareEvolutionEffect(
  tasks: Array<{ oldSkillId: string; newSkillId: string; taskId: string }>,
  timeRange?: { start: Date; end: Date }
): Promise<Array<{ taskId: string; result: EvolutionComparisonResult }>> {
  const results: Array<{ taskId: string; result: EvolutionComparisonResult }> = [];
  
  for (const task of tasks) {
    try {
      const result = await compareEvolutionEffect(
        task.oldSkillId,
        task.newSkillId,
        timeRange
      );
      results.push({ taskId: task.taskId, result });
      
      // 自动更新任务指标
      await updateEvolutionTaskMetrics(task.taskId, result);
    } catch (error) {
      logger.error(LOG_MODULES.SKILL_EVOLUTION, `对比任务 ${task.taskId} 失败`, { details: { error: error instanceof Error ? error.message : String(error) } });
      // 继续处理其他任务
    }
  }
  
  return results;
}

/**
 * 获取进化效果统计汇总
 * 
 * @param timeRange 可选的时间范围过滤
 * @returns 统计汇总
 */
export async function getEvolutionEffectSummary(
  timeRange?: { start: Date; end: Date }
): Promise<{
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  avgPrecisionImprovement: number;
  avgRecallChange: number;
}> {
  // 构建查询条件
  const whereClause: {
    status: { in: string[] };
    completedAt?: { gte: Date; lte: Date };
  } = {
    status: { in: ['completed', 'rejected'] },
  };
  
  if (timeRange) {
    whereClause.completedAt = {
      gte: timeRange.start,
      lte: timeRange.end,
    };
  }
  
  // 获取已完成的进化任务
  const tasks = await prisma.skillEvolutionTask.findMany({
    where: whereClause,
    select: {
      id: true,
      status: true,
      precisionBefore: true,
      precisionAfter: true,
      recallAfter: true,
    },
  });
  
  const totalTasks = tasks.length;
  const successfulTasks = tasks.filter(t => t.status === 'completed').length;
  const failedTasks = tasks.filter(t => t.status === 'rejected').length;
  
  // 计算平均改进值
  let totalPrecisionImprovement = 0;
  let totalRecallChange = 0;
  let validTasksForMetrics = 0;
  
  for (const task of tasks) {
    if (task.precisionBefore !== null && task.precisionAfter !== null) {
      totalPrecisionImprovement += task.precisionAfter - task.precisionBefore;
      validTasksForMetrics++;
    }
    
    // recallAfter 存储的是变化后的召回率
    // 我们需要计算变化值，但这里没有 recallBefore
    // 所以只统计 recallAfter 的平均值
    if (task.recallAfter !== null) {
      totalRecallChange += task.recallAfter;
    }
  }
  
  const avgPrecisionImprovement = validTasksForMetrics > 0
    ? totalPrecisionImprovement / validTasksForMetrics
    : 0;
  
  const avgRecallChange = totalTasks > 0
    ? totalRecallChange / totalTasks
    : 0;
  
  return {
    totalTasks,
    successfulTasks,
    failedTasks,
    avgPrecisionImprovement,
    avgRecallChange,
  };
}