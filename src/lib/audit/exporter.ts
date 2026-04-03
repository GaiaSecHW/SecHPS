// src/lib/audit/exporter.ts

import { prisma } from '@/lib/prisma';
import type { AuditAction } from '@/types/audit';

export interface ExportOptions {
  format: 'json' | 'csv';
  startDate?: Date;
  endDate?: Date;
  userId?: string;
  actions?: AuditAction[];
  limit?: number;
}

/**
 * 导出审计日志为JSON格式
 */
export async function exportToJson(options: ExportOptions): Promise<string> {
  const logs = await fetchLogs(options);

  const exportData = logs.map((log) => ({
    id: log.id,
    userId: log.userId,
    action: log.action,
    resource: log.resource,
    details: log.details ? JSON.parse(log.details) : null,
    ipAddress: log.ipAddress,
    userAgent: log.userAgent,
    createdAt: log.createdAt.toISOString(),
  }));

  return JSON.stringify(exportData, null, 2);
}

/**
 * 导出审计日志为CSV格式
 */
export async function exportToCsv(options: ExportOptions): Promise<string> {
  const logs = await fetchLogs(options);

  // CSV 头部
  const headers = [
    'ID',
    'User ID',
    'Action',
    'Resource',
    'IP Address',
    'User Agent',
    'Details',
    'Created At',
  ];

  // CSV 行
  const rows = logs.map((log) => [
    log.id,
    log.userId || '',
    log.action,
    log.resource || '',
    log.ipAddress || '',
    `"${(log.userAgent || '').replace(/"/g, '""')}"`,
    `"${(log.details || '').replace(/"/g, '""')}"`,
    log.createdAt.toISOString(),
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

/**
 * 获取审计日志数据
 */
async function fetchLogs(options: ExportOptions) {
  const where: Record<string, unknown> = {};

  if (options.userId) {
    where.userId = options.userId;
  }

  if (options.actions && options.actions.length > 0) {
    where.action = { in: options.actions };
  }

  if (options.startDate || options.endDate) {
    where.createdAt = {};
    if (options.startDate) {
      (where.createdAt as Record<string, Date>).gte = options.startDate;
    }
    if (options.endDate) {
      (where.createdAt as Record<string, Date>).lte = options.endDate;
    }
  }

  const limit = options.limit || 10000;

  return prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * 生成导出文件名
 */
export function generateExportFilename(format: 'json' | 'csv'): string {
  const date = new Date().toISOString().split('T')[0];
  return `audit-logs-${date}.${format}`;
}
