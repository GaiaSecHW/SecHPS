// src/app/api/admin/audit-logs/report/route.ts

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { generateSecurityReport } from '@/lib/audit/reporter';
import { auditLog } from '@/lib/audit/logger';

// GET /api/admin/audit-logs/report - 生成安全审计报告
export async function GET(request: Request) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_READ });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    const { searchParams } = new URL(request.url);
    const startDateStr = searchParams.get('startDate');
    const endDateStr = searchParams.get('endDate');

    // 默认最近7天
    const endDate = endDateStr ? new Date(endDateStr) : new Date();
    const startDate = startDateStr
      ? new Date(startDateStr)
      : new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    // 验证日期范围
    if (startDate >= endDate) {
      return NextResponse.json({ details: { error: '开始日期必须早于结束日期' } }, { status: 400 });
    }

    // 限制日期范围（最多90天）
    const maxDays = 90;
    const daysDiff = (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000);
    if (daysDiff > maxDays) {
      return NextResponse.json({ details: { error: '日期范围不能超过90天' } }, { status: 400 });
    }

    const report = await generateSecurityReport({ startDate, endDate });

    // 记录报告生成
    await auditLog({
      userId: payload.userId,
      action: 'report_generate',
      resource: 'security_audit_report',
      details: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        totalEvents: report.summary.totalEvents,
      },
    });

    logger.access(LOG_MODULES.AUDIT, payload, 'security_audit_report', { startDate, endDate, totalEvents: report.summary.totalEvents });
    return NextResponse.json({ report });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AUDIT, '生成安全审计报告失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
