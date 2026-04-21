// src/app/api/admin/alerts/history/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';

// GET /api/admin/alerts/history - 获取告警历史
export async function GET(request: Request) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_READ });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status') || undefined;
    const severity = searchParams.get('severity') || undefined;
    const ruleId = searchParams.get('ruleId') || undefined;

    const { skip, take, page: pageNum, limit: pageLimit } = getOffsetPagination({ page, limit });

    const where = {
      ...(status && { status }),
      ...(severity && { severity }),
      ...(ruleId && { ruleId }),
    };

    const [total, alerts] = await Promise.all([
      prisma.alertInstance.count({ where }),
      prisma.alertInstance.findMany({
        where,
        skip,
        take,
        orderBy: { triggeredAt: 'desc' },
      }),
    ]);

    logger.access(LOG_MODULES.AUDIT, payload, 'alert_history', { page, limit, status, severity, ruleId });
    return NextResponse.json(createPaginatedResponse(alerts, total, pageNum, pageLimit));
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AUDIT, '获取告警历史失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
