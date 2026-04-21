// src/services/skill-evolution/metrics-calculator.ts
/**
 * Skill 精准率/召回率计算服务
 * 
 * 功能：
 * 1. 计算单个 Skill 的精准率指标
 * 2. 筛选低精准率的 Skill
 * 3. 支持时间范围过滤
 */

import { prisma } from '@/lib/prisma';

/**
 * Skill 指标数据结构
 */
export interface SkillMetrics {
  skillId: string;
  skillName: string;
  displayName: string;
  totalExecutions: number;
  totalFindings: number;
  confirmedCount: number;
  falsePositiveCount: number;
  pendingCount: number;
  precision: number;        // 精准率 = confirmed / (confirmed + falsePositive)
  falsePositiveRate: number; // 误报率 = falsePositive / totalFindings
}

/**
 * 计算单个 Skill 的精准率指标
 * 
 * @param skillId Skill ID
 * @param timeRange 可选的时间范围过滤
 * @returns Skill 指标数据
 */
export async function calculateSkillMetrics(
  skillId: string,
  timeRange?: { start: Date; end: Date }
): Promise<SkillMetrics> {
  // 构建 where 条件
  const whereClause: {
    skillId: string;
    createdAt?: { gte: Date; lte: Date };
  } = { skillId };
  
  if (timeRange) {
    whereClause.createdAt = {
      gte: timeRange.start,
      lte: timeRange.end,
    };
  }

  // 获取 Skill 基本信息
  const skill = await prisma.skill.findUnique({
    where: { id: skillId },
    select: {
      id: true,
      name: true,
      displayName: true,
    },
  });

  if (!skill) {
    throw new Error(`Skill not found: ${skillId}`);
  }

  // 聚合执行数据
  const executions = await prisma.skillExecution.findMany({
    where: whereClause,
    select: {
      findingsCount: true,
      confirmedCount: true,
      falsePositiveCount: true,
      status: true,
    },
  });

  // 计算汇总数据
  let totalExecutions = 0;
  let totalFindings = 0;
  let confirmedCount = 0;
  let falsePositiveCount = 0;
  let pendingCount = 0;

  for (const exec of executions) {
    totalExecutions++;
    totalFindings += exec.findingsCount;
    confirmedCount += exec.confirmedCount;
    falsePositiveCount += exec.falsePositiveCount;
    
    // pending 状态的执行数
    if (exec.status === 'pending') {
      pendingCount++;
    }
  }

  // 计算精准率: confirmed / (confirmed + falsePositive)
  // 如果没有确认和误报数据，精准率为 0
  const precision = (confirmedCount + falsePositiveCount) > 0
    ? confirmedCount / (confirmedCount + falsePositiveCount)
    : 0;

  // 计算误报率: falsePositive / totalFindings
  const falsePositiveRate = totalFindings > 0
    ? falsePositiveCount / totalFindings
    : 0;

  return {
    skillId: skill.id,
    skillName: skill.name,
    displayName: skill.displayName,
    totalExecutions,
    totalFindings,
    confirmedCount,
    falsePositiveCount,
    pendingCount,
    precision,
    falsePositiveRate,
  };
}

/**
 * 筛选低精准率的 Skill
 * 
 * @param threshold 精准率阈值（低于此值的 Skill 被视为低精准率）
 * @param timeRange 可选的时间范围过滤
 * @returns 低精准率 Skill 列表
 */
export async function getLowPrecisionSkills(
  threshold: number,
  timeRange?: { start: Date; end: Date }
): Promise<SkillMetrics[]> {
  // 获取所有活跃的 Skill
  const skills = await prisma.skill.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      displayName: true,
    },
  });

  // 计算每个 Skill 的指标
  const metricsList: SkillMetrics[] = [];

  for (const skill of skills) {
    try {
      const metrics = await calculateSkillMetrics(skill.id, timeRange);
      
      // 只返回有执行记录且精准率低于阈值的 Skill
      if (metrics.totalExecutions > 0 && metrics.precision < threshold) {
        metricsList.push(metrics);
      }
    } catch (error) {
      console.error(`[MetricsCalculator] 计算 Skill ${skill.id} 指标失败:`, error);
    }
  }

  // 按精准率升序排序（最低的在前）
  metricsList.sort((a, b) => a.precision - b.precision);

  return metricsList;
}

/**
 * 批量计算多个 Skill 的指标
 * 
 * @param skillIds Skill ID 列表
 * @param timeRange 可选的时间范围过滤
 * @returns Skill 指标列表
 */
export async function calculateBatchSkillMetrics(
  skillIds: string[],
  timeRange?: { start: Date; end: Date }
): Promise<SkillMetrics[]> {
  const metricsList: SkillMetrics[] = [];

  for (const skillId of skillIds) {
    try {
      const metrics = await calculateSkillMetrics(skillId, timeRange);
      metricsList.push(metrics);
    } catch (error) {
      console.error(`[MetricsCalculator] 计算 Skill ${skillId} 指标失败:`, error);
    }
  }

  return metricsList;
}

/**
 * 获取所有 Skill 的指标汇总
 * 
 * @param timeRange 可选的时间范围过滤
 * @returns 所有 Skill 的指标列表
 */
export async function getAllSkillMetrics(
  timeRange?: { start: Date; end: Date }
): Promise<SkillMetrics[]> {
  // 获取所有活跃的 Skill
  const skills = await prisma.skill.findMany({
    where: { isActive: true },
    select: {
      id: true,
    },
  });

  return calculateBatchSkillMetrics(skills.map(s => s.id), timeRange);
}