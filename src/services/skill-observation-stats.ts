// src/services/skill-observation-stats.ts
// Skills Governance - 观测统计聚合服务

import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 统计摘要结构
 */
export interface ObservationStatsSummary {
  totalSkills: number;           // 有观测记录的 Skills 总数
  totalObservations: number;     // 总观测次数
  totalWarnings: number;         // 总预警次数
  totalMatches: number;          // 总匹配次数
  totalOverlaps: number;         // 总重叠检测次数
  avgMatchRate: number;          // 平均匹配率
  avgWarningRate: number;        // 平均预警率
  highRiskSkills: number;        // 高风险 Skills 数量（warningRate >= 0.5）
  recentObservations: number;    // 最近7天观测次数
}

/**
 * 重叠对统计
 */
export interface OverlapPairStats {
  skillId1: string;
  skillName1: string;
  skillId2: string;
  skillName2: string;
  overlapCount: number;          // 共同出现次数
  overlapScore: number;          // 平均重叠得分
  overlapType: string;           // 重叠类型
  firstObservedAt: Date;
  lastObservedAt: Date;
}

/**
 * 趋势数据点
 */
export interface TrendDataPoint {
  date: string;                  // 日期 YYYY-MM-DD
  value: number;                 // 数值
  change?: number;               // 相比前一天的百分比变化
}

/**
 * 趋势数据
 */
export interface TrendData {
  skillId: string;
  skillName: string;
  metric: string;                // 指标名称：observations | warnings | matches | overlaps
  period: number;                // 统计周期（天数）
  data: TrendDataPoint[];
  trendDirection: 'up' | 'down' | 'stable';  // 趋势方向
  trendPercentage: number;       // 趋势百分比变化
  summary: string;               // 趋势摘要描述
}

/**
 * 带详情的统计
 */
export interface SkillStatsWithDetails {
  id: string;
  skillId: string;
  skillName: string;
  skillDisplayName: string;
  skillCategory: string;
  totalObservations: number;
  warningCount: number;
  matchCount: number;
  overlapCount: number;
  matchRate: number | null;
  warningRate: number | null;
  avgResponseTime: number | null;
  avgMatchScore: number | null;
  firstObservedAt: Date | null;
  lastObservedAt: Date | null;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  trend: TrendData | null;
}

/**
 * 聚合结果
 */
export interface AggregationResult {
  success: boolean;
  statsId?: string;
  error?: string;
}

/**
 * 全局聚合结果
 */
export interface GlobalAggregationResult {
  success: boolean;
  processedCount: number;
  error?: string;
}

// ============================================================================
// 观测统计聚合服务类
// ============================================================================

/**
 * Skill 观测统计聚合服务
 * 
 * 提供观测数据的聚合分析功能
 * 错误处理不阻断主流程
 */
export class SkillObservationStatsService {
  // ============================================================================
  // 核心聚合函数
  // ============================================================================

  /**
   * 单个 Skill 统计聚合
   * 
   * 从观测日志重新计算统计数据
   */
  static async aggregateObservationStats(skillId: string): Promise<AggregationResult> {
    try {
      // 获取该 Skill 的所有观测日志
      const logs = await prisma.skillObservationLog.findMany({
        where: { skillId },
        orderBy: { createdAt: 'asc' },
      });

      if (logs.length === 0) {
        // 无观测日志，创建空统计或返回
        const existingStats = await prisma.skillObservationStats.findUnique({
          where: { skillId },
        });

        if (!existingStats) {
          // 创建空统计记录
          const stats = await prisma.skillObservationStats.create({
            data: {
              skillId,
              totalObservations: 0,
              warningCount: 0,
              matchCount: 0,
              overlapCount: 0,
              matchRate: null,
              warningRate: null,
              firstObservedAt: null,
              lastObservedAt: null,
            },
          });

          return { success: true, statsId: stats.id };
        }

        return { success: true, statsId: existingStats.id };
      }

      // 计算统计数据
      const totalObservations = logs.length;
      const warningCount = logs.filter(l => l.severity === 'critical' || l.severity === 'high' || l.severity === 'medium').length;
      
      // 从 matches JSON 字段解析匹配数
      let matchCount = 0;
      let overlapCount = 0;
      let avgMatchScore = 0;
      let matchScores: number[] = [];

      for (const log of logs) {
        if (log.matches) {
          try {
            const matchesData = JSON.parse(log.matches) as Array<{ similarity?: number; overlapType?: string }>;
            matchCount += matchesData.length;
            
            // 计算重叠数（非 exact 匹配）
            overlapCount += matchesData.filter(m => m.overlapType !== 'exact').length;
            
            // 收集匹配分数
            for (const m of matchesData) {
              if (m.similarity) {
                matchScores.push(m.similarity);
              }
            }
          } catch {
            // JSON 解析失败，跳过
          }
        }
      }

      // 计算平均匹配分数
      if (matchScores.length > 0) {
        avgMatchScore = matchScores.reduce((a, b) => a + b, 0) / matchScores.length;
      }

      // 计算比率
      const matchRate = totalObservations > 0 ? matchCount / totalObservations : null;
      const warningRate = totalObservations > 0 ? warningCount / totalObservations : null;

      // 时间信息
      const firstObservedAt = logs[0]?.createdAt;
      const lastObservedAt = logs[logs.length - 1]?.createdAt;

      // Upsert 统计记录
      const stats = await prisma.skillObservationStats.upsert({
        where: { skillId },
        create: {
          skillId,
          totalObservations,
          warningCount,
          matchCount,
          overlapCount,
          matchRate,
          warningRate,
          avgMatchScore: matchScores.length > 0 ? avgMatchScore : null,
          firstObservedAt,
          lastObservedAt,
        },
        update: {
          totalObservations,
          warningCount,
          matchCount,
          overlapCount,
          matchRate,
          warningRate,
          avgMatchScore: matchScores.length > 0 ? avgMatchScore : null,
          firstObservedAt,
          lastObservedAt,
        },
      });

      logger.debug(LOG_MODULES.SKILL, '观测统计聚合完成', {
        details: {
          skillId,
          totalObservations,
          warningCount,
          matchCount,
          overlapCount,
        },
      });

      return { success: true, statsId: stats.id };
    } catch (error) {
      logger.errorNoUser(LOG_MODULES.SKILL, '观测统计聚合失败', {
        details: {
          skillId,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      };
    }
  }

  /**
   * 全局统计聚合
   * 
   * 对所有有观测日志的 Skills 执行聚合
   */
  static async aggregateAllStats(): Promise<GlobalAggregationResult> {
    try {
      // 获取所有有观测日志的 skillId
      const distinctSkillIds = await prisma.skillObservationLog.findMany({
        select: { skillId: true },
        distinct: ['skillId'],
      });

      const skillIds = distinctSkillIds.map(s => s.skillId);
      let processedCount = 0;

      // 批量聚合（每次处理10个，避免数据库压力）
      for (let i = 0; i < skillIds.length; i += 10) {
        const batch = skillIds.slice(i, i + 10);
        
        for (const skillId of batch) {
          const result = await this.aggregateObservationStats(skillId);
          if (result.success) {
            processedCount++;
          }
        }
      }

      logger.debug(LOG_MODULES.SKILL, '全局观测统计聚合完成', {
        details: {
          totalSkills: skillIds.length,
          processedCount,
        },
      });

      return { success: true, processedCount };
    } catch (error) {
      logger.errorNoUser(LOG_MODULES.SKILL, '全局观测统计聚合失败', {
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      });

      return {
        success: false,
        processedCount: 0,
        error: error instanceof Error ? error.message : '未知错误',
      };
    }
  }

  // ============================================================================
  // 高频重叠统计
  // ============================================================================

  /**
   * 高频重叠对统计
   * 
   * 分析哪些 Skills 经常一起出现在观测日志中
   */
  static async getFrequentOverlapPairs(limit: number = 20): Promise<OverlapPairStats[]> {
    try {
      // 获取所有观测日志的 matches 数据
      const logs = await prisma.skillObservationLog.findMany({
        where: {
          matches: { not: null },
        },
        select: {
          matches: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 1000, // 限制最近1000条日志
      });

      // 解析并统计重叠对
      const pairCounts: Map<string, {
        count: number;
        scores: number[];
        types: Set<string>;
        firstObserved: Date;
        lastObserved: Date;
        skillIds: [string, string];
      }> = new Map();

      for (const log of logs) {
        if (!log.matches) continue;

        try {
          const matchesData = JSON.parse(log.matches) as Array<{
            skillId: string;
            skillName: string;
            similarity?: number;
            overlapType?: string;
          }>;

          // 找出所有重叠对
          for (let i = 0; i < matchesData.length; i++) {
            for (let j = i + 1; j < matchesData.length; j++) {
              const skill1 = matchesData[i];
              const skill2 = matchesData[j];

              // 创建唯一键（按 skillId 排序）
              const key = [skill1.skillId, skill2.skillId].sort().join('|');

              const existing = pairCounts.get(key);
              if (existing) {
                existing.count++;
                if (skill1.similarity) existing.scores.push(skill1.similarity);
                if (skill2.similarity) existing.scores.push(skill2.similarity);
                if (skill1.overlapType) existing.types.add(skill1.overlapType);
                if (skill2.overlapType) existing.types.add(skill2.overlapType);
                existing.lastObserved = log.createdAt;
              } else {
                pairCounts.set(key, {
                  count: 1,
                  scores: [skill1.similarity || 0, skill2.similarity || 0],
                  types: new Set([skill1.overlapType || 'unknown', skill2.overlapType || 'unknown']),
                  firstObserved: log.createdAt,
                  lastObserved: log.createdAt,
                  skillIds: [skill1.skillId, skill2.skillId],
                });
              }
            }
          }
        } catch {
          // JSON 解析失败，跳过
        }
      }

      // 获取 Skill 名称映射
      const allSkillIds = new Set<string>();
      for (const [, data] of pairCounts) {
        allSkillIds.add(data.skillIds[0]);
        allSkillIds.add(data.skillIds[1]);
      }

      const skills = await prisma.skill.findMany({
        where: { id: { in: Array.from(allSkillIds) } },
        select: { id: true, name: true },
      });

      const skillNameMap = new Map(skills.map(s => [s.id, s.name]));

      // 转换为结果数组并排序
      const results: OverlapPairStats[] = [];
      for (const [key, data] of pairCounts) {
        const avgScore = data.scores.length > 0
          ? data.scores.reduce((a, b) => a + b, 0) / data.scores.length
          : 0;

        results.push({
          skillId1: data.skillIds[0],
          skillName1: skillNameMap.get(data.skillIds[0]) || 'Unknown',
          skillId2: data.skillIds[1],
          skillName2: skillNameMap.get(data.skillIds[1]) || 'Unknown',
          overlapCount: data.count,
          overlapScore: avgScore,
          overlapType: Array.from(data.types).join(','),
          firstObservedAt: data.firstObserved,
          lastObservedAt: data.lastObserved,
        });
      }

      // 按重叠次数排序
      results.sort((a, b) => b.overlapCount - a.overlapCount);

      return results.slice(0, limit);
    } catch (error) {
      logger.errorNoUser(LOG_MODULES.SKILL, '获取高频重叠对失败', {
        details: {
          limit,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return [];
    }
  }

  /**
   * 高频重叠 Skills 排行
   * 
   * 返回 overlapCount 最高的 Skills
   */
  static async getTopOverlapSkills(limit: number = 20): Promise<SkillStatsWithDetails[]> {
    try {
      const stats = await prisma.skillObservationStats.findMany({
        where: {
          overlapCount: { gt: 0 },
        },
        orderBy: [
          { overlapCount: 'desc' },
          { warningCount: 'desc' },
        ],
        take: limit,
        include: {
          skill: {
            select: {
              id: true,
              name: true,
              displayName: true,
              category: true,
            },
          },
        },
      });

      return stats.map(s => ({
        id: s.id,
        skillId: s.skillId,
        skillName: s.skill?.name || 'Unknown',
        skillDisplayName: s.skill?.displayName || 'Unknown',
        skillCategory: s.skill?.category || 'Unknown',
        totalObservations: s.totalObservations,
        warningCount: s.warningCount,
        matchCount: s.matchCount,
        overlapCount: s.overlapCount,
        matchRate: s.matchRate,
        warningRate: s.warningRate,
        avgResponseTime: s.avgResponseTime,
        avgMatchScore: s.avgMatchScore,
        firstObservedAt: s.firstObservedAt,
        lastObservedAt: s.lastObservedAt,
        riskLevel: this.calculateRiskLevel(s.warningRate, s.overlapCount),
        trend: null, // 趋势需要单独计算
      }));
    } catch (error) {
      logger.errorNoUser(LOG_MODULES.SKILL, '获取高频重叠 Skills 失败', {
        details: {
          limit,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return [];
    }
  }

  // ============================================================================
  // 趋势计算
  // ============================================================================

  /**
   * 趋势计算
   * 
   * 计算指定 Skill 在指定天数内的趋势
   */
  static async calculateTrend(
    skillId: string,
    days: number = 7,
    metric: 'observations' | 'warnings' | 'matches' | 'overlaps' = 'observations'
  ): Promise<TrendData | null> {
    try {
      const skill = await prisma.skill.findUnique({
        where: { id: skillId },
        select: { id: true, name: true },
      });

      if (!skill) {
        return null;
      }

      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // 获取时间范围内的观测日志
      const logs = await prisma.skillObservationLog.findMany({
        where: {
          skillId,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (logs.length === 0) {
        return null;
      }

      // 按日期分组统计
      const dailyStats: Map<string, number> = new Map();

      for (const log of logs) {
        const dateKey = log.createdAt.toISOString().split('T')[0];
        const existing = dailyStats.get(dateKey) || 0;

        switch (metric) {
          case 'observations':
            dailyStats.set(dateKey, existing + 1);
            break;
          case 'warnings':
            if (log.severity === 'critical' || log.severity === 'high' || log.severity === 'medium') {
              dailyStats.set(dateKey, existing + 1);
            }
            break;
          case 'matches':
            if (log.matches) {
              try {
                const matchesData = JSON.parse(log.matches) as unknown[];
                dailyStats.set(dateKey, existing + matchesData.length);
              } catch {
                // JSON 解析失败
              }
            }
            break;
          case 'overlaps':
            if (log.matches) {
              try {
                const matchesData = JSON.parse(log.matches) as Array<{ overlapType?: string }>;
                const overlapCount = matchesData.filter(m => m.overlapType !== 'exact').length;
                dailyStats.set(dateKey, existing + overlapCount);
              } catch {
                // JSON 解析失败
              }
            }
            break;
        }
      }

      // 构建趋势数据点
      const data: TrendDataPoint[] = [];
      const sortedDates = Array.from(dailyStats.keys()).sort();

      for (let i = 0; i < sortedDates.length; i++) {
        const date = sortedDates[i];
        const value = dailyStats.get(date) || 0;
        const prevValue = i > 0 ? (dailyStats.get(sortedDates[i - 1]) || 0) : 0;

        const change = prevValue > 0 ? ((value - prevValue) / prevValue) * 100 : 0;

        data.push({
          date,
          value,
          change: i > 0 ? change : undefined,
        });
      }

      // 计算整体趋势
      const firstValue = data.length > 0 ? data[0].value : 0;
      const lastValue = data.length > 0 ? data[data.length - 1].value : 0;
      const trendPercentage = firstValue > 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0;

      let trendDirection: 'up' | 'down' | 'stable';
      if (trendPercentage > 10) {
        trendDirection = 'up';
      } else if (trendPercentage < -10) {
        trendDirection = 'down';
      } else {
        trendDirection = 'stable';
      }

      // 生成趋势摘要
      const summary = this.generateTrendSummary(metric, trendDirection, trendPercentage, days);

      return {
        skillId,
        skillName: skill.name,
        metric,
        period: days,
        data,
        trendDirection,
        trendPercentage,
        summary,
      };
    } catch (error) {
      logger.errorNoUser(LOG_MODULES.SKILL, '趋势计算失败', {
        details: {
          skillId,
          days,
          metric,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return null;
    }
  }

  // ============================================================================
  // 统计摘要
  // ============================================================================

  /**
   * 统计摘要
   * 
   * 获取全局观测统计摘要
   */
  static async getStatsSummary(): Promise<ObservationStatsSummary> {
    try {
      // 获取所有统计记录
      const allStats = await prisma.skillObservationStats.findMany();

      // 计算汇总数据
      const totalSkills = allStats.length;
      const totalObservations = allStats.reduce((sum, s) => sum + s.totalObservations, 0);
      const totalWarnings = allStats.reduce((sum, s) => sum + s.warningCount, 0);
      const totalMatches = allStats.reduce((sum, s) => sum + s.matchCount, 0);
      const totalOverlaps = allStats.reduce((sum, s) => sum + s.overlapCount, 0);

      // 计算平均比率
      const statsWithRates = allStats.filter(s => s.matchRate !== null && s.warningRate !== null);
      const avgMatchRate = statsWithRates.length > 0
        ? statsWithRates.reduce((sum, s) => sum + (s.matchRate || 0), 0) / statsWithRates.length
        : 0;
      const avgWarningRate = statsWithRates.length > 0
        ? statsWithRates.reduce((sum, s) => sum + (s.warningRate || 0), 0) / statsWithRates.length
        : 0;

      // 高风险 Skills（warningRate >= 0.5）
      const highRiskSkills = allStats.filter(s => s.warningRate !== null && s.warningRate >= 0.5).length;

      // 最近7天观测次数
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const recentLogs = await prisma.skillObservationLog.count({
        where: {
          createdAt: { gte: sevenDaysAgo },
        },
      });

      return {
        totalSkills,
        totalObservations,
        totalWarnings,
        totalMatches,
        totalOverlaps,
        avgMatchRate,
        avgWarningRate,
        highRiskSkills,
        recentObservations: recentLogs,
      };
    } catch (error) {
      logger.errorNoUser(LOG_MODULES.SKILL, '获取统计摘要失败', {
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      });

      // 返回空摘要
      return {
        totalSkills: 0,
        totalObservations: 0,
        totalWarnings: 0,
        totalMatches: 0,
        totalOverlaps: 0,
        avgMatchRate: 0,
        avgWarningRate: 0,
        highRiskSkills: 0,
        recentObservations: 0,
      };
    }
  }

  // ============================================================================
  // 辅助函数
  // ============================================================================

  /**
   * 计算风险等级
   */
  private static calculateRiskLevel(
    warningRate: number | null,
    overlapCount: number
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (warningRate !== null && warningRate >= 0.7) {
      return 'critical';
    }
    if (warningRate !== null && warningRate >= 0.5) {
      return 'high';
    }
    if (overlapCount >= 10 || (warningRate !== null && warningRate >= 0.3)) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * 生成趋势摘要
   */
  private static generateTrendSummary(
    metric: string,
    direction: 'up' | 'down' | 'stable',
    percentage: number,
    days: number
  ): string {
    const metricNames: Record<string, string> = {
      observations: '观测次数',
      warnings: '预警次数',
      matches: '匹配次数',
      overlaps: '重叠次数',
    };

    const metricName = metricNames[metric] || metric;
    const periodText = days === 7 ? '近7天' : days === 30 ? '近30天' : `近${days}天`;

    if (direction === 'stable') {
      return `${periodText}${metricName}保持稳定`;
    }

    const changeText = percentage > 0 ? `上升${percentage.toFixed(1)}%` : `下降${Math.abs(percentage).toFixed(1)}%`;
    return `${periodText}${metricName}${changeText}`;
  }

  /**
   * 获取带趋势的 Skill 统计详情
   */
  static async getSkillStatsWithTrend(
    skillId: string,
    trendDays: number = 7
  ): Promise<SkillStatsWithDetails | null> {
    try {
      const stats = await prisma.skillObservationStats.findUnique({
        where: { skillId },
        include: {
          skill: {
            select: {
              id: true,
              name: true,
              displayName: true,
              category: true,
            },
          },
        },
      });

      if (!stats) {
        return null;
      }

      // 计算趋势
      const trend = await this.calculateTrend(skillId, trendDays);

      return {
        id: stats.id,
        skillId: stats.skillId,
        skillName: stats.skill?.name || 'Unknown',
        skillDisplayName: stats.skill?.displayName || 'Unknown',
        skillCategory: stats.skill?.category || 'Unknown',
        totalObservations: stats.totalObservations,
        warningCount: stats.warningCount,
        matchCount: stats.matchCount,
        overlapCount: stats.overlapCount,
        matchRate: stats.matchRate,
        warningRate: stats.warningRate,
        avgResponseTime: stats.avgResponseTime,
        avgMatchScore: stats.avgMatchScore,
        firstObservedAt: stats.firstObservedAt,
        lastObservedAt: stats.lastObservedAt,
        riskLevel: this.calculateRiskLevel(stats.warningRate, stats.overlapCount),
        trend,
      };
    } catch (error) {
      logger.errorNoUser(LOG_MODULES.SKILL, '获取 Skill 统计详情失败', {
        details: {
          skillId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return null;
    }
  }

  /**
   * 批量获取带趋势的 Skill 统计
   */
  static async getBatchStatsWithTrend(
    skillIds: string[],
    trendDays: number = 7
  ): Promise<SkillStatsWithDetails[]> {
    const results: SkillStatsWithDetails[] = [];

    for (const skillId of skillIds) {
      const stats = await this.getSkillStatsWithTrend(skillId, trendDays);
      if (stats) {
        results.push(stats);
      }
    }

    return results;
  }

  /**
   * 获取预警 Skills 列表
   */
  static async getWarningSkills(limit: number = 20): Promise<SkillStatsWithDetails[]> {
    try {
      const stats = await prisma.skillObservationStats.findMany({
        where: {
          warningCount: { gt: 0 },
        },
        orderBy: [
          { warningRate: 'desc' },
          { warningCount: 'desc' },
        ],
        take: limit,
        include: {
          skill: {
            select: {
              id: true,
              name: true,
              displayName: true,
              category: true,
            },
          },
        },
      });

      return stats.map(s => ({
        id: s.id,
        skillId: s.skillId,
        skillName: s.skill?.name || 'Unknown',
        skillDisplayName: s.skill?.displayName || 'Unknown',
        skillCategory: s.skill?.category || 'Unknown',
        totalObservations: s.totalObservations,
        warningCount: s.warningCount,
        matchCount: s.matchCount,
        overlapCount: s.overlapCount,
        matchRate: s.matchRate,
        warningRate: s.warningRate,
        avgResponseTime: s.avgResponseTime,
        avgMatchScore: s.avgMatchScore,
        firstObservedAt: s.firstObservedAt,
        lastObservedAt: s.lastObservedAt,
        riskLevel: this.calculateRiskLevel(s.warningRate, s.overlapCount),
        trend: null,
      }));
    } catch (error) {
      logger.errorNoUser(LOG_MODULES.SKILL, '获取预警 Skills 失败', {
        details: {
          limit,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return [];
    }
  }

  /**
   * 清理过期统计数据
   * 
   * 删除超过指定天数无更新的统计记录
   */
  static async cleanupStaleStats(days: number = 90): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const result = await prisma.skillObservationStats.deleteMany({
        where: {
          lastObservedAt: { lt: cutoffDate },
          totalObservations: 0, // 只删除无观测的记录
        },
      });

      logger.debug(LOG_MODULES.SKILL, '清理过期统计完成', {
        details: {
          deletedCount: result.count,
          cutoffDays: days,
        },
      });

      return result.count;
    } catch (error) {
      logger.errorNoUser(LOG_MODULES.SKILL, '清理过期统计失败', {
        details: {
          days,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return 0;
    }
  }
}

// ============================================================================
// 导出便捷函数
// ============================================================================

export const aggregateObservationStats = SkillObservationStatsService.aggregateObservationStats;
export const aggregateAllStats = SkillObservationStatsService.aggregateAllStats;
export const getFrequentOverlapPairs = SkillObservationStatsService.getFrequentOverlapPairs;
export const calculateTrend = SkillObservationStatsService.calculateTrend;
export const getTopOverlapSkills = SkillObservationStatsService.getTopOverlapSkills;
export const getStatsSummary = SkillObservationStatsService.getStatsSummary;
export const getSkillStatsWithTrend = SkillObservationStatsService.getSkillStatsWithTrend;
export const getBatchStatsWithTrend = SkillObservationStatsService.getBatchStatsWithTrend;
export const getWarningSkills = SkillObservationStatsService.getWarningSkills;
export const cleanupStaleStats = SkillObservationStatsService.cleanupStaleStats;