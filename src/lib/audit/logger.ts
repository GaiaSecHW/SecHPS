// src/lib/audit/logger.ts

import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';
import type { AuditAction, AuditCategory } from '@/types/audit';
import { ACTION_CATEGORIES, SENSITIVE_ACTIONS } from '@/types/audit';

interface CreateAuditLogParams {
  userId?: string | null;
  action: AuditAction;
  resource?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  success?: boolean;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

interface RequestInfo {
  ip?: string;
  userAgent?: string;
}

/**
 * 审计日志服务
 * 提供统一的审计日志记录接口
 */
export class AuditLogger {
  /**
   * 记录审计日志
   */
  static async log(params: CreateAuditLogParams): Promise<void> {
    try {
      const category = ACTION_CATEGORIES[params.action];

      const details: Record<string, unknown> = {
        action: params.action,
        category,
        success: params.success ?? true,
        ...(params.details || {}),
      };

      if (params.errorMessage) {
        details.errorMessage = params.errorMessage;
        details.success = false;
      }

      if (params.metadata) {
        details.metadata = params.metadata;
      }

      await prisma.auditLog.create({
        data: {
          id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          userId: params.userId || null,
          action: params.action,
          resource: params.resource || null,
          details: JSON.stringify(details),
          ipAddress: params.ipAddress || null,
          userAgent: params.userAgent || null,
        },
      });
    } catch (error) {
      // 审计日志记录失败不应该影响主流程
      logger.error(LOG_MODULES.AUDIT, 'Failed to create audit log', { details: { error: error instanceof Error ? error.message : String(error) } });
    }
  }

  /**
   * 从请求中提取信息并记录审计日志
   */
  static async logFromRequest(
    request: Request,
    params: Omit<CreateAuditLogParams, 'ipAddress' | 'userAgent'>
  ): Promise<void> {
    const requestInfo = extractRequestInfo(request);

    await AuditLogger.log({
      ...params,
      ipAddress: requestInfo.ip,
      userAgent: requestInfo.userAgent,
    });
  }

  /**
   * 记录认证事件
   */
  static async logAuth(
    action: 'login' | 'logout' | 'login_failed' | 'password_change' | 'password_reset',
    userId: string | undefined,
    request: Request,
    options?: { success?: boolean; errorMessage?: string; metadata?: Record<string, unknown> }
  ): Promise<void> {
    await AuditLogger.logFromRequest(request, {
      userId,
      action,
      success: options?.success,
      errorMessage: options?.errorMessage,
      metadata: options?.metadata,
    });
  }

  /**
   * 记录用户管理事件
   */
  static async logUserManagement(
    action: 'user_create' | 'user_update' | 'user_delete' | 'user_assign_role' | 'user_activate' | 'user_deactivate',
    operatorId: string,
    targetUserId: string,
    request: Request,
    options?: { before?: Record<string, unknown>; after?: Record<string, unknown> }
  ): Promise<void> {
    await AuditLogger.logFromRequest(request, {
      userId: operatorId,
      action,
      resource: targetUserId,
      details: {
        targetUserId,
        before: options?.before,
        after: options?.after,
      },
    });
  }

  /**
   * 记录配置变更
   */
  static async logConfig(
    action: 'config_create' | 'config_update' | 'config_delete' | 'cache_clear',
    userId: string,
    resource: string,
    request: Request,
    options?: { before?: Record<string, unknown>; after?: Record<string, unknown> }
  ): Promise<void> {
    await AuditLogger.logFromRequest(request, {
      userId,
      action,
      resource,
      details: {
        before: options?.before,
        after: options?.after,
      },
    });
  }

  /**
   * 记录权限拒绝事件
   */
  static async logPermissionDenied(
    userId: string | undefined,
    requiredPermission: string,
    request: Request
  ): Promise<void> {
    await AuditLogger.logFromRequest(request, {
      userId,
      action: 'permission_denied',
      details: {
        requiredPermission,
        success: false,
      },
    });
  }

  /**
   * 记录数据导出事件
   */
  static async logDataExport(
    userId: string,
    exportType: string,
    request: Request,
    options?: { format?: string; recordCount?: number }
  ): Promise<void> {
    await AuditLogger.logFromRequest(request, {
      userId,
      action: 'data_export',
      details: {
        exportType,
        format: options?.format,
        recordCount: options?.recordCount,
      },
    });
  }

  /**
   * 检查是否为敏感操作
   */
  static isSensitiveAction(action: AuditAction): boolean {
    return SENSITIVE_ACTIONS.includes(action);
  }

  /**
   * 获取操作的类别
   */
  static getActionCategory(action: AuditAction): AuditCategory {
    return ACTION_CATEGORIES[action];
  }
}

/**
 * 从请求中提取IP和User-Agent
 */
export function extractRequestInfo(request: Request): RequestInfo {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded
    ? forwarded.split(',')[0].trim()
    : request.headers.get('x-real-ip') || undefined;

  return {
    ip,
    userAgent: request.headers.get('user-agent') || undefined,
  };
}

// 导出便捷函数
export const auditLog = AuditLogger.log;
export const auditLogFromRequest = AuditLogger.logFromRequest;
export const auditLogAuth = AuditLogger.logAuth;
export const auditLogUserManagement = AuditLogger.logUserManagement;
export const auditLogConfig = AuditLogger.logConfig;
export const auditLogPermissionDenied = AuditLogger.logPermissionDenied;
export const auditLogDataExport = AuditLogger.logDataExport;
