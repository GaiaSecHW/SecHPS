// src/services/skill-observation-log.ts
// Skills Governance - 观测日志服务

import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';
import type { SimilarSkill } from '@/services/skill-similarity';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 观测日志上下文
 */
export interface ObservationContext {
  workflowId?: string;
  nodeId?: string;
  userId?: string;
  taskId?: string;
  taskName?: string;
  taskDescription?: string;
  groupName?: string;
  overlapType?: string;
  overlapScore?: number;
}

/**
 * 观测日志参数
 */
export interface LogObservationParams {
  matches: SimilarSkill[];
  warning: {
    hasWarning: boolean;
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    details?: Record<string, unknown>;
  };
  context: ObservationContext;
}

/**
 * 观测日志创建结果
 */
export interface ObservationLogResult {
  success: boolean;
  logIds: string[];
  error?: string;
}

/**
 * 观测统计更新参数
 */
export interface UpdateStatsParams {
  matchCount?: number;
  overlapCount?: number;
  warningCount?: number;
  responseTime?: number;
  matchScore?: number;
}

// ============================================================================
// 观测日志服务类
// ============================================================================

/**
 * Skill 观测日志服务
 * 
 * 提供观测日志写入和统计更新功能
 * 错误处理不阻断主流程
 */
export class SkillObservationLogService {
  /**
   * 记录观测日志
   * 
   * 为匹配的 Skills 创建观测日志记录
   * 错误不阻断主流程
   */
  static async logObservation(params: LogObservationParams): Promise<ObservationLogResult> {
    const { matches, warning, context } = params;
    const logIds: string[] = [];

    try {
      // 为每个匹配的 Skill 创建观测日志
      for (const match of matches) {
        const triggerType = this.determineTriggerType(warning, match);
        const severity = this.mapSeverityToLogLevel(warning.severity);

        const log = await prisma.skillObservationLog.create({
          data: {
            skillId: match.skillId,
            triggerType,
            triggerContext: JSON.stringify({
              workflowId: context.workflowId,
              nodeId: context.nodeId,
              userId: context.userId,
              taskId: context.taskId,
              taskName: context.taskName,
              taskDescription: context.taskDescription,
              groupName: context.groupName,
              overlapType: context.overlapType || match.overlapType,
              overlapScore: context.overlapScore || match.overlapScore,
            }),
            matches: JSON.stringify(matches.map(m => ({
              skillId: m.skillId,
              skillName: m.skillName,
              displayName: m.displayName,
              similarity: m.similarity,
              overlapType: m.overlapType,
            }))),
            issues: JSON.stringify({
              warningMessage: warning.message,
              warningSeverity: warning.severity,
              warningDetails: warning.details,
              matchReason: match.reason,
            }),
            severity,
            status: 'pending',
          },
        });

        logIds.push(log.id);

        // 更新该 Skill 的观测统计
        await this.updateObservationStats(match.skillId, {
          matchCount: 1,
          overlapCount: match.overlapType !== 'exact' ? 1 : 0,
          warningCount: warning.hasWarning ? 1 : 0,
          matchScore: match.similarity,
        });
      }

      logger.debug(LOG_MODULES.SKILL, '观测日志记录完成', {
        details: {
          matchCount: matches.length,
          logCount: logIds.length,
          severity: warning.severity,
        },
      });

      return {
        success: true,
        logIds,
      };
    } catch (error) {
      // 观测日志记录失败不影响主流程
      logger.errorNoUser(LOG_MODULES.SKILL, '观测日志记录失败', {
        details: {
          error: error instanceof Error ? error.message : String(error),
          matchCount: matches.length,
        },
      });

      return {
        success: false,
        logIds,
        error: error instanceof Error ? error.message : '未知错误',
      };
    }
  }

  /**
   * 更新观测统计
   * 
   * 使用 upsert 更新或创建统计记录
   */
  static async updateObservationStats(
    skillId: string,
    params: UpdateStatsParams
  ): Promise<void> {
    try {
      // 获取现有统计
      const existingStats = await prisma.skillObservationStats.findUnique({
        where: { skillId },
      });

      // 计算新值
      const newTotalObservations = (existingStats?.totalObservations || 0) + 1;
      const newMatchCount = (existingStats?.matchCount || 0) + (params.matchCount || 0);
      const newOverlapCount = (existingStats?.overlapCount || 0) + (params.overlapCount || 0);
      const newWarningCount = (existingStats?.warningCount || 0) + (params.warningCount || 0);

      // 计算比率
      const newMatchRate = newTotalObservations > 0 
        ? newMatchCount / newTotalObservations 
        : null;
      const newWarningRate = newTotalObservations > 0 
        ? newWarningCount / newTotalObservations 
        : null;

      // 计算平均响应时间和匹配分数
      let newAvgResponseTime = existingStats?.avgResponseTime;
      if (params.responseTime) {
        const prevAvg = existingStats?.avgResponseTime || 0;
        const prevCount = existingStats?.totalObservations || 0;
        newAvgResponseTime = Math.round((prevAvg * prevCount + params.responseTime) / newTotalObservations);
      }

      let newAvgMatchScore = existingStats?.avgMatchScore;
      if (params.matchScore) {
        const prevAvg = existingStats?.avgMatchScore || 0;
        const prevCount = existingStats?.totalObservations || 0;
        newAvgMatchScore = (prevAvg * prevCount + params.matchScore) / newTotalObservations;
      }

      // Upsert 统计记录
      await prisma.skillObservationStats.upsert({
        where: { skillId },
        create: {
          skillId,
          totalObservations: 1,
          warningCount: params.warningCount || 0,
          matchCount: params.matchCount || 0,
          overlapCount: params.overlapCount || 0,
          matchRate: newMatchRate,
          warningRate: newWarningRate,
          avgResponseTime: params.responseTime,
          avgMatchScore: params.matchScore,
          firstObservedAt: new Date(),
          lastObservedAt: new Date(),
        },
        update: {
          totalObservations: newTotalObservations,
          warningCount: newWarningCount,
          matchCount: newMatchCount,
          overlapCount: newOverlapCount,
          matchRate: newMatchRate,
          warningRate: newWarningRate,
          avgResponseTime: newAvgResponseTime,
          avgMatchScore: newAvgMatchScore,
          lastObservedAt: new Date(),
        },
      });
    } catch (error) {
      // 统计更新失败不影响主流程
      logger.errorNoUser(LOG_MODULES.SKILL, '观测统计更新失败', {
        details: {
          skillId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /**
   * 获取观测统计
   */
  static async getObservationStats(skillId: string): Promise<{
    id: string;
    skillId: string;
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
    createdAt: Date;
    updatedAt: Date;
  } | null> {
    try {
      const stats = await prisma.skillObservationStats.findUnique({
        where: { skillId },
      });

      return stats;
    } catch (error) {
      logger.errorNoUser(LOG_MODULES.SKILL, '获取观测统计失败', {
        details: {
          skillId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return null;
    }
  }

  /**
   * 获取高频重叠 Skills
   * 
   * 返回 overlapCount 高的 Skills 统计列表
   */
  static async getHighFrequencySkills(limit: number = 10): Promise<Array<{
    id: string;
    skillId: string;
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
    createdAt: Date;
    updatedAt: Date;
    skill?: {
      id: string;
      name: string;
      displayName: string;
      category: string;
    };
  }>> {
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

      return stats;
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

  /**
   * 获取观测日志列表
   */
  static async getObservationLogs(params: {
    skillId?: string;
    triggerType?: string;
    severity?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<Array<{
    id: string;
    skillId: string;
    triggerType: string;
    triggerContext: string | null;
    matches: string | null;
    issues: string | null;
    severity: string;
    status: string;
    resolvedAt: Date | null;
    resolvedBy: string | null;
    resolution: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>> {
    try {
      const where: Record<string, unknown> = {};
      
      if (params.skillId) {
        where.skillId = params.skillId;
      }
      if (params.triggerType) {
        where.triggerType = params.triggerType;
      }
      if (params.severity) {
        where.severity = params.severity;
      }
      if (params.status) {
        where.status = params.status;
      }

      const logs = await prisma.skillObservationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: params.limit || 20,
        skip: params.offset || 0,
      });

      return logs;
    } catch (error) {
      logger.errorNoUser(LOG_MODULES.SKILL, '获取观测日志列表失败', {
        details: {
          params,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return [];
    }
  }

  /**
   * 更新观测日志状态
   */
  static async updateLogStatus(
    logId: string,
    status: 'acknowledged' | 'resolved' | 'dismissed',
    resolvedBy?: string,
    resolution?: string
  ): Promise<boolean> {
    try {
      await prisma.skillObservationLog.update({
        where: { id: logId },
        data: {
          status,
          resolvedAt: new Date(),
          resolvedBy,
          resolution,
        },
      });

      return true;
    } catch (error) {
      logger.errorNoUser(LOG_MODULES.SKILL, '更新观测日志状态失败', {
        details: {
          logId,
          status,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return false;
    }
  }

  // ============================================================================
  // 私有辅助方法
  // ============================================================================

  /**
   * 确定触发类型
   */
  private static determineTriggerType(
    warning: { hasWarning: boolean; severity: string },
    match: SimilarSkill
  ): string {
    // 完全匹配
    if (match.overlapType === 'exact') {
      return 'similarity_warning';
    }

    // 高严重度预警
    if (warning.severity === 'critical' || warning.severity === 'high') {
      return 'overlap_detected';
    }

    // 技术栈重叠
    if (match.overlapType === 'techStack-overlap') {
      return 'overlap_detected';
    }

    // 语义重叠
    if (match.overlapType === 'semantic-overlap') {
      return 'overlap_detected';
    }

    // 默认
    return 'overlap_detected';
  }

  /**
   * 将治理严重程度映射到日志级别
   */
  private static mapSeverityToLogLevel(severity: 'low' | 'medium' | 'high' | 'critical'): string {
    switch (severity) {
      case 'critical':
        return 'critical';
      case 'high':
        return 'high';
      case 'medium':
        return 'medium';
      case 'low':
        return 'low';
      default:
        return 'info';
    }
  }
}

// ============================================================================
// 导出便捷函数
// ============================================================================

export const logObservation = SkillObservationLogService.logObservation;
export const updateObservationStats = SkillObservationLogService.updateObservationStats;
export const getObservationStats = SkillObservationLogService.getObservationStats;
export const getHighFrequencySkills = SkillObservationLogService.getHighFrequencySkills;
export const getObservationLogs = SkillObservationLogService.getObservationLogs;
export const updateLogStatus = SkillObservationLogService.updateLogStatus;