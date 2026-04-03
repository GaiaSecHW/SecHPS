// src/app/api/admin/alerts/history/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';

// GET /api/admin/alerts/history - 获取告警历史
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

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

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

    return NextResponse.json(createPaginatedResponse(alerts, total, pageNum, pageLimit));
  } catch (error) {
    console.error('Get alert history error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
