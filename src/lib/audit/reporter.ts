// src/lib/audit/reporter.ts

import { prisma } from '@/lib/prisma';
import type { SecurityAuditReport } from '@/types/audit';
import { getBeijingHourMinutes } from '@/lib/beijing-time';

export interface ReportOptions {
  startDate: Date;
  endDate: Date;
}

/**
 * 生成安全审计报告
 */
export async function generateSecurityReport(options: ReportOptions): Promise<SecurityAuditReport> {
  const { startDate, endDate } = options;

  // 获取时间范围内的所有审计日志
  const logs = await prisma.auditLog.findMany({
    where: {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  // 获取用户信息
  const userIds = [...new Set(logs.map((log) => log.userId).filter(Boolean))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds as string[] } },
    select: { id: true, username: true, email: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  // 计算摘要统计
  const summary = calculateSummary(logs);

  // 计算活跃用户
  const topUsers = calculateTopUsers(logs, userMap);

  // 计算热门操作
  const topActions = calculateTopActions(logs);

  // 检测失败登录尝试
  const failedLoginAttempts = detectFailedLogins(logs);

  // 检测可疑模式
  const suspiciousPatterns = detectSuspiciousPatterns(logs);

  // 生成建议
  const recommendations = generateRecommendations(summary, suspiciousPatterns);

  return {
    reportDate: new Date(),
    period: {
      start: startDate,
      end: endDate,
    },
    summary,
    topUsers,
    topActions,
    failedLoginAttempts,
    suspiciousPatterns,
    recommendations,
  };
}

/**
 * 计算摘要统计
 */
function calculateSummary(logs: { userId: string | null; action: string }[]) {
  const uniqueUsers = new Set(logs.map((log) => log.userId).filter(Boolean));

  const failedLogins = logs.filter((log) => log.action === 'login_failed').length;
  const successfulLogins = logs.filter((log) => log.action === 'login').length;
  const suspiciousActivities = logs.filter((log) => log.action === 'suspicious_activity').length;
  const permissionDenied = logs.filter((log) => log.action === 'permission_denied').length;

  const sensitiveActions = [
    'password_change',
    'user_delete',
    'role_assign_permission',
    'config_delete',
    'cache_clear',
  ];
  const sensitiveOperations = logs.filter((log) => sensitiveActions.includes(log.action)).length;

  return {
    totalEvents: logs.length,
    uniqueUsers: uniqueUsers.size,
    failedLogins,
    successfulLogins,
    suspiciousActivities,
    permissionDenied,
    sensitiveOperations,
  };
}

/**
 * 计算活跃用户Top 10
 */
function calculateTopUsers(
  logs: { userId: string | null }[],
  userMap: Map<string, { id: string; username: string; email: string }>
) {
  const userCounts = new Map<string, number>();

  for (const log of logs) {
    if (log.userId) {
      userCounts.set(log.userId, (userCounts.get(log.userId) || 0) + 1);
    }
  }

  return Array.from(userCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([userId, count]) => {
      const user = userMap.get(userId);
      return {
        userId,
        username: user?.username || 'Unknown',
        eventCount: count,
      };
    });
}

/**
 * 计算热门操作Top 10
 */
function calculateTopActions(logs: { action: string }[]) {
  const actionCounts = new Map<string, number>();

  for (const log of logs) {
    actionCounts.set(log.action, (actionCounts.get(log.action) || 0) + 1);
  }

  return Array.from(actionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([action, count]) => ({ action, count }));
}

/**
 * 检测失败登录尝试
 */
function detectFailedLogins(logs: { action: string; ipAddress: string | null; createdAt: Date }[]) {
  const failedLogins = logs.filter((log) => log.action === 'login_failed' && log.ipAddress);

  const ipCounts = new Map<string, { count: number; lastAttempt: Date }>();

  for (const log of failedLogins) {
    if (!log.ipAddress) continue;

    const existing = ipCounts.get(log.ipAddress);
    if (existing) {
      existing.count++;
      if (log.createdAt > existing.lastAttempt) {
        existing.lastAttempt = log.createdAt;
      }
    } else {
      ipCounts.set(log.ipAddress, { count: 1, lastAttempt: log.createdAt });
    }
  }

  return Array.from(ipCounts.entries())
    .filter(([, data]) => data.count >= 3) // 至少3次失败
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([ipAddress, data]) => ({
      ipAddress,
      count: data.count,
      lastAttempt: data.lastAttempt,
    }));
}

/**
 * 检测可疑模式
 */
function detectSuspiciousPatterns(logs: { action: string; userId: string | null; ipAddress: string | null; createdAt: Date; details: string | null }[]): SecurityAuditReport['suspiciousPatterns'] {
  const patterns: SecurityAuditReport['suspiciousPatterns'] = [];

  // 1. 检测短时间内大量权限拒绝
  const permissionDenied = logs.filter((log) => log.action === 'permission_denied');
  if (permissionDenied.length >= 5) {
    patterns.push({
      type: 'multiple_permission_denied',
      description: '检测到多次权限拒绝事件',
      severity: 'high',
      count: permissionDenied.length,
      details: { events: permissionDenied.slice(0, 5) },
    });
  }

  // 2. 检测来自同一IP的大量失败登录
  const failedByIp = new Map<string, number>();
  for (const log of logs) {
    if (log.action === 'login_failed' && log.ipAddress) {
      failedByIp.set(log.ipAddress, (failedByIp.get(log.ipAddress) || 0) + 1);
    }
  }

  for (const [ip, count] of failedByIp) {
    if (count >= 5) {
      patterns.push({
        type: 'brute_force_attempt',
        description: `IP ${ip} 有 ${count} 次失败登录尝试，可能存在暴力破解`,
        severity: 'high',
        count,
        details: { ipAddress: ip },
      });
    }
  }

  // 3. 检测非工作时间敏感操作
  const sensitiveActions = ['user_delete', 'config_delete', 'role_assign_permission'];
  const sensitiveOps = logs.filter((log) => sensitiveActions.includes(log.action));
  const offHoursOps = sensitiveOps.filter((log) => {
    const hourMinutes = getBeijingHourMinutes(log.createdAt);
    const hour = Math.floor(hourMinutes / 60);
    return hour < 6 || hour > 22;
  });

  if (offHoursOps.length > 0) {
    patterns.push({
      type: 'off_hours_sensitive_operations',
      description: '检测到非工作时间敏感操作',
      severity: 'medium',
      count: offHoursOps.length,
      details: { events: offHoursOps.slice(0, 5) },
    });
  }

  // 4. 检测同一用户多IP登录
  const userIps = new Map<string, Set<string>>();
  for (const log of logs) {
    if (log.action === 'login' && log.userId && log.ipAddress) {
      if (!userIps.has(log.userId)) {
        userIps.set(log.userId, new Set());
      }
      userIps.get(log.userId)!.add(log.ipAddress);
    }
  }

  for (const [userId, ips] of userIps) {
    if (ips.size >= 3) {
      patterns.push({
        type: 'multiple_ip_login',
        description: `用户 ${userId} 从 ${ips.size} 个不同IP登录`,
        severity: 'low',
        count: ips.size,
        details: { userId, ipAddresses: Array.from(ips) },
      });
    }
  }

  return patterns;
}

/**
 * 生成安全建议
 */
function generateRecommendations(
  summary: SecurityAuditReport['summary'],
  patterns: SecurityAuditReport['suspiciousPatterns']
): string[] {
  const recommendations: string[] = [];

  // 基于失败登录率
  const loginRate = summary.successfulLogins + summary.failedLogins > 0
    ? summary.failedLogins / (summary.successfulLogins + summary.failedLogins)
    : 0;

  if (loginRate > 0.3) {
    recommendations.push('失败登录率较高，建议加强密码策略或启用多因素认证');
  }

  // 基于可疑模式
  const highSeverityPatterns = patterns.filter((p) => p.severity === 'high');
  if (highSeverityPatterns.length > 0) {
    recommendations.push('发现高危安全事件，建议立即调查并采取相应措施');
  }

  const bruteForcePatterns = patterns.filter((p) => p.type === 'brute_force_attempt');
  if (bruteForcePatterns.length > 0) {
    recommendations.push('检测到暴力破解尝试，建议启用IP锁定或验证码保护');
  }

  // 基于权限拒绝
  if (summary.permissionDenied > 10) {
    recommendations.push('权限拒绝事件较多，建议审查用户角色分配');
  }

  // 基于敏感操作
  if (summary.sensitiveOperations > 0) {
    recommendations.push(`期间发生了 ${summary.sensitiveOperations} 次敏感操作，建议审核操作记录`);
  }

  // 默认建议
  if (recommendations.length === 0) {
    recommendations.push('系统运行正常，建议定期检查审计日志');
  }

  return recommendations;
}
