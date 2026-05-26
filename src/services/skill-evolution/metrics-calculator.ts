// src/services/skill-evolution/metrics-calculator.ts
/**
 * Skill 精准率/召回率计算服务
 * 
 * 功能：
 * 1. 计算单个 Skill 的精准率指标（从 Vulnerability 表直接统计）
 * 2. 筛选低精准率的 Skill
 * 3. 支持时间范围过滤
 */

import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * Skill 指标数据结构
 */
export interface SkillMetrics {
  skillId: string;
  skillName: string;
  displayName: string;
  totalExecutions: number;
  successExecCount: number;
  successRate: number;        // 成功率 = successExecCount / totalExecutions
  totalFindings: number;
  confirmedCount: number;
  falsePositiveCount: number;
  pendingCount: number;
  precision: number;        // 精准率 = confirmed / (confirmed + falsePositive)
  falsePositiveRate: number; // 误报率 = falsePositive / totalFindings
}

/**
 * 计算单个 Skill 的精准率指标
 * 直接从 Vulnerability 表统计 status，更准确
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
  const executionWhereClause: {
    skillId: string;
    createdAt?: { gte: Date; lte: Date };
  } = { skillId };
  
  if (timeRange) {
    executionWhereClause.createdAt = {
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

  // 获取该 Skill 的所有执行记录 ID
  const executions = await prisma.skillExecution.findMany({
    where: executionWhereClause,
    select: { id: true, status: true },
  });

  const executionIds = executions.map(e => e.id);
  const totalExecutions = executions.length;
  const pendingCount = executions.filter(e => e.status === 'pending').length;
  const successExecCount = executions.filter(e => e.status === 'completed').length;

  // 计算成功率
  const successRate = totalExecutions > 0
    ? successExecCount / totalExecutions
    : 0;

  // 从 Vulnerability 表统计 findings（通过 skillExecutionId）
  const vulnWhereClause: {
    skillExecutionId: { in: string[] };
    createdAt?: { gte: Date; lte: Date };
  } = { skillExecutionId: { in: executionIds } };
  
  if (timeRange) {
    vulnWhereClause.createdAt = {
      gte: timeRange.start,
      lte: timeRange.end,
    };
  }

  // 统计 Vulnerability status
  const vulnStats = await prisma.vulnerability.groupBy({
    by: ['status'],
    where: vulnWhereClause,
    _count: { id: true },
  });

  const totalFindings = vulnStats.reduce((sum, s) => sum + s._count.id, 0);
  const confirmedCount = vulnStats.find(s => s.status === 'confirmed')?._count.id || 0;
  const falsePositiveCount = vulnStats.find(s => s.status === 'false-positive')?._count.id || 0;

  // 计算精准率: confirmed / (confirmed + falsePositive)
  // 只有在用户标记过的漏洞（confirmed 或 false-positive）才计入
  const reviewedCount = confirmedCount + falsePositiveCount;
  const precision = reviewedCount > 0
    ? confirmedCount / reviewedCount
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
    successExecCount,
    successRate,
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
  // 获取所有活跃的 Skill（排除内置基础设施 skill）
  const skills = await prisma.skill.findMany({
    where: { isActive: true, isBuiltin: false },
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
      logger.error(LOG_MODULES.SKILL_EVOLUTION, `计算 Skill ${skill.id} 指标失败`, { details: { error: error instanceof Error ? error.message : String(error) } });
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
      logger.error(LOG_MODULES.SKILL_EVOLUTION, `计算 Skill ${skillId} 指标失败`, { details: { error: error instanceof Error ? error.message : String(error) } });
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
  // 获取所有活跃的 Skill（排除内置基础设施 skill）
  const skills = await prisma.skill.findMany({
    where: { isActive: true, isBuiltin: false },
    select: {
      id: true,
    },
  });

  return calculateBatchSkillMetrics(skills.map(s => s.id), timeRange);
}