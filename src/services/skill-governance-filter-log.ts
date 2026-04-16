// src/services/skill-governance-filter-log.ts
// Skills Governance - 治理过滤日志服务
// 记录过滤原因（合并入、deprecated等），关联到评估记录

import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 过滤原因类型
 */
export type FilterReason = 'deprecated' | 'merged' | 'pending-merge';

/**
 * 过滤的 Skill 信息
 */
export interface FilteredSkillInfo {
  skillId: string;
  skillName: string;
  reason: FilterReason;
  mergedInto?: string; // 目标 Skill 名称（仅 merged 时）
}

/**
 * 治理过滤日志参数
 */
export interface LogGovernanceFilterParams {
  evaluationId: string;
  projectId: string;
  filteredSkills: FilteredSkillInfo[];
  userId?: string;
  timestamp?: Date;
}

/**
 * 治理过滤日志结果
 */
export interface GovernanceFilterLogResult {
  success: boolean;
  logId?: string;
  error?: string;
}

/**
 * 治理过滤日志详情（存储在 AuditLog.details）
 */
export interface GovernanceFilterLogDetails {
  evaluationId: string;
  projectId: string;
  filteredSkills: FilteredSkillInfo[];
  timestamp: string;
}

/**
 * 查询到的过滤日志
 */
export interface RetrievedGovernanceFilterLog {
  id: string;
  userId: string | null;
  action: string;
  resource: string | null;
  details: GovernanceFilterLogDetails;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

// ============================================================================
// 治理过滤日志服务类
// ============================================================================

/**
 * Skill 治理过滤日志服务
 *
 * 记录 Skills 在评估过程中被过滤的原因
 * 使用 AuditLog 表存储，错误处理不阻断主流程
 */
export class SkillGovernanceFilterLogService {
  /**
   * 记录治理过滤日志
   *
   * @param params 过滤日志参数
   * @returns 日志创建结果
   */
  static async logGovernanceFilter(
    params: LogGovernanceFilterParams
  ): Promise<GovernanceFilterLogResult> {
    const { evaluationId, projectId, filteredSkills, userId, timestamp } = params;

    // 无过滤 Skills 时不记录
    if (!filteredSkills || filteredSkills.length === 0) {
      return { success: true };
    }

    try {
      const logDetails: GovernanceFilterLogDetails = {
        evaluationId,
        projectId,
        filteredSkills,
        timestamp: (timestamp || new Date()).toISOString(),
      };

      const auditLog = await prisma.auditLog.create({
        data: {
          userId: userId || null,
          action: 'governance_filter',
          resource: `evaluation:${evaluationId}`,
          details: JSON.stringify(logDetails),
          ipAddress: null,
          userAgent: null,
        },
      });

      logger.debug(LOG_MODULES.SKILL, '治理过滤日志记录完成', {
        details: {
          evaluationId,
          projectId,
          filteredCount: filteredSkills.length,
          logId: auditLog.id,
        },
      });

      return {
        success: true,
        logId: auditLog.id,
      };
    } catch (error) {
      // 日志记录失败不影响主流程
      logger.errorNoUser(LOG_MODULES.SKILL, '治理过滤日志记录失败', {
        details: {
          evaluationId,
          projectId,
          filteredCount: filteredSkills.length,
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
   * 获取评估的治理过滤日志
   *
   * @param evaluationId 评估 ID
   * @returns 过滤日志列表
   */
  static async getGovernanceFilterLogs(
    evaluationId: string
  ): Promise<RetrievedGovernanceFilterLog[]> {
    try {
      const logs = await prisma.auditLog.findMany({
        where: {
          action: 'governance_filter',
          resource: `evaluation:${evaluationId}`,
        },
        orderBy: { createdAt: 'desc' },
      });

      // 解析 details JSON
      const parsedLogs = logs.map((log) => ({
        id: log.id,
        userId: log.userId,
        action: log.action,
        resource: log.resource ?? '',
        details: JSON.parse(log.details || '{}') as GovernanceFilterLogDetails,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        createdAt: log.createdAt,
      }));

      return parsedLogs as RetrievedGovernanceFilterLog[];
    } catch (error) {
      logger.errorNoUser(LOG_MODULES.SKILL, '获取治理过滤日志失败', {
        details: {
          evaluationId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return [];
    }
  }

  /**
   * 获取项目的所有治理过滤日志
   *
   * @param projectId 项目 ID
   * @param limit 返回数量限制（默认50）
   * @returns 过滤日志列表
   */
  static async getProjectFilterHistory(
    projectId: string,
    limit: number = 50
  ): Promise<RetrievedGovernanceFilterLog[]> {
    try {
      // 查询所有包含该 projectId 的治理过滤日志
      const logs = await prisma.auditLog.findMany({
        where: {
          action: 'governance_filter',
        },
        orderBy: { createdAt: 'desc' },
        take: limit * 2, // 取更多记录，后续过滤
      });

      // 过滤出包含指定 projectId 的日志
      const filteredLogs: RetrievedGovernanceFilterLog[] = [];
      for (const log of logs) {
        try {
          const details = JSON.parse(log.details || '{}') as GovernanceFilterLogDetails;
          if (details.projectId === projectId) {
            filteredLogs.push({
              id: log.id,
              userId: log.userId,
              action: log.action,
              resource: log.resource,
              details,
              ipAddress: log.ipAddress,
              userAgent: log.userAgent,
              createdAt: log.createdAt,
            });
          }
        } catch {
          // JSON 解析失败，跳过该记录
          continue;
        }
      }

      // 返回限制数量
      return filteredLogs.slice(0, limit);
    } catch (error) {
      logger.errorNoUser(LOG_MODULES.SKILL, '获取项目过滤历史失败', {
        details: {
          projectId,
          limit,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return [];
    }
  }

  /**
   * 获取 Skill 的过滤历史
   *
   * @param skillId Skill ID
   * @param limit 返回数量限制（默认20）
   * @returns 该 Skill 被过滤的记录列表
   */
  static async getSkillFilterHistory(
    skillId: string,
    limit: number = 20
  ): Promise<Array<{
    evaluationId: string;
    projectId: string;
    reason: FilterReason;
    mergedInto?: string;
    timestamp: string;
    logCreatedAt: Date;
  }>> {
    try {
      const logs = await prisma.auditLog.findMany({
        where: {
          action: 'governance_filter',
        },
        orderBy: { createdAt: 'desc' },
        take: limit * 5, // 取更多记录，后续过滤
      });

      const skillFilterRecords: Array<{
        evaluationId: string;
        projectId: string;
        reason: FilterReason;
        mergedInto?: string;
        timestamp: string;
        logCreatedAt: Date;
      }> = [];

      for (const log of logs) {
        try {
          const details = JSON.parse(log.details || '{}') as GovernanceFilterLogDetails;
          // 查找包含该 skillId 的过滤记录
          const filteredSkill = details.filteredSkills.find(
            (fs) => fs.skillId === skillId
          );
          if (filteredSkill) {
            skillFilterRecords.push({
              evaluationId: details.evaluationId,
              projectId: details.projectId,
              reason: filteredSkill.reason,
              mergedInto: filteredSkill.mergedInto,
              timestamp: details.timestamp,
              logCreatedAt: log.createdAt,
            });
          }
        } catch {
          // JSON 解析失败，跳过
          continue;
        }
      }

      return skillFilterRecords.slice(0, limit);
    } catch (error) {
      logger.errorNoUser(LOG_MODULES.SKILL, '获取 Skill 过滤历史失败', {
        details: {
          skillId,
          limit,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return [];
    }
  }

  /**
   * 统计过滤原因分布
   *
   * @param projectId 项目 ID（可选，不传则统计全局）
   * @returns 过滤原因统计
   */
  static async getFilterReasonStats(
    projectId?: string
  ): Promise<{
    deprecated: number;
    merged: number;
    pendingMerge: number;
    total: number;
  }> {
    try {
      const whereClause: { action: string } = { action: 'governance_filter' };

      const logs = await prisma.auditLog.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        take: 1000, // 限制查询数量
      });

      const stats = {
        deprecated: 0,
        merged: 0,
        pendingMerge: 0,
        total: 0,
      };

      for (const log of logs) {
        try {
          const details = JSON.parse(log.details || '{}') as GovernanceFilterLogDetails;
          // 如果指定了 projectId，只统计该项目的
          if (projectId && details.projectId !== projectId) {
            continue;
          }
          for (const fs of details.filteredSkills) {
            stats.total++;
            switch (fs.reason) {
              case 'deprecated':
                stats.deprecated++;
                break;
              case 'merged':
                stats.merged++;
                break;
              case 'pending-merge':
                stats.pendingMerge++;
                break;
            }
          }
        } catch {
          // JSON 解析失败，跳过
          continue;
        }
      }

      return stats;
    } catch (error) {
      logger.errorNoUser(LOG_MODULES.SKILL, '获取过滤原因统计失败', {
        details: {
          projectId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return { deprecated: 0, merged: 0, pendingMerge: 0, total: 0 };
    }
  }

  /**
   * 批量记录过滤日志
   *
   * @param paramsList 多个过滤日志参数
   * @returns 批量创建结果
   */
  static async batchLogGovernanceFilter(
    paramsList: LogGovernanceFilterParams[]
  ): Promise<{
    successCount: number;
    failedCount: number;
    logIds: string[];
    errors: string[];
  }> {
    const results = {
      successCount: 0,
      failedCount: 0,
      logIds: [] as string[],
      errors: [] as string[],
    };

    for (const params of paramsList) {
      const result = await this.logGovernanceFilter(params);
      if (result.success) {
        results.successCount++;
        if (result.logId) {
          results.logIds.push(result.logId);
        }
      } else {
        results.failedCount++;
        if (result.error) {
          results.errors.push(result.error);
        }
      }
    }

    return results;
  }
}

// ============================================================================
// 导出便捷函数
// ============================================================================

export const logGovernanceFilter = SkillGovernanceFilterLogService.logGovernanceFilter;
export const getGovernanceFilterLogs = SkillGovernanceFilterLogService.getGovernanceFilterLogs;
export const getProjectFilterHistory = SkillGovernanceFilterLogService.getProjectFilterHistory;
export const getSkillFilterHistory = SkillGovernanceFilterLogService.getSkillFilterHistory;
export const getFilterReasonStats = SkillGovernanceFilterLogService.getFilterReasonStats;
export const batchLogGovernanceFilter = SkillGovernanceFilterLogService.batchLogGovernanceFilter;