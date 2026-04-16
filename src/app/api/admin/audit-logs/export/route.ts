// src/app/api/admin/audit-logs/export/route.ts

import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { exportToJson, exportToCsv, generateExportFilename } from '@/lib/audit/exporter';
import { auditLogDataExport } from '@/lib/audit/logger';
import type { AuditAction } from '@/types/audit';

// GET /api/admin/audit-logs/export - 导出审计日志
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的令牌' } }, { status: 401 });
    }

    // 导出需要更高权限
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
      return NextResponse.json({ details: { error: '禁止访问' } }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const format = (searchParams.get('format') || 'json') as 'json' | 'csv';
    const startDate = searchParams.get('startDate') ? new Date(searchParams.get('startDate')!) : undefined;
    const endDate = searchParams.get('endDate') ? new Date(searchParams.get('endDate')!) : undefined;
    const userId = searchParams.get('userId') || undefined;
    const actions = searchParams.get('actions')?.split(',') as AuditAction[] | undefined;
    const limit = parseInt(searchParams.get('limit') || '10000');

    // 验证格式
    if (format !== 'json' && format !== 'csv') {
      return NextResponse.json({ details: { error: '无效的导出格式' } }, { status: 400 });
    }

    // 导出数据
    const data = format === 'json'
      ? await exportToJson({ format, startDate, endDate, userId, actions, limit })
      : await exportToCsv({ format, startDate, endDate, userId, actions, limit });

    // 记录导出操作
    await auditLogDataExport(payload.userId, 'audit_logs', request, {
      format,
      recordCount: format === 'json'
        ? JSON.parse(data).length
        : data.split('\n').length - 1, // 减去头部
    });

    // 设置响应头
    const filename = generateExportFilename(format);
    const contentType = format === 'json'
      ? 'application/json'
      : 'text/csv';

    logger.access(LOG_MODULES.AUDIT, payload, 'audit_logs_export', { format, recordCount: format === 'json' ? JSON.parse(data).length : data.split('\n').length - 1 });
    return new NextResponse(data, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AUDIT, '导出审计日志失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
