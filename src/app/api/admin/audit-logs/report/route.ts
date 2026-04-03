// src/app/api/admin/audit-logs/report/route.ts

import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { generateSecurityReport } from '@/lib/audit/reporter';
import { auditLog } from '@/lib/audit/logger';

// GET /api/admin/audit-logs/report - 生成安全审计报告
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 报告需要更高权限
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

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
      return NextResponse.json({ error: '开始日期必须早于结束日期' }, { status: 400 });
    }

    // 限制日期范围（最多90天）
    const maxDays = 90;
    const daysDiff = (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000);
    if (daysDiff > maxDays) {
      return NextResponse.json({ error: '日期范围不能超过90天' }, { status: 400 });
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

    return NextResponse.json({ report });
  } catch (error) {
    console.error('Generate security report error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
