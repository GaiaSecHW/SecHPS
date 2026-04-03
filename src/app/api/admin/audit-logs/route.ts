// src/app/api/admin/audit-logs/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';

// GET /api/admin/audit-logs - 查询审计日志
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

    if (!hasPermission(payload.permissions, PERMISSIONS.USER_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const userId = searchParams.get('userId') || undefined;
    const action = searchParams.get('action')?.split(',') || undefined;
    const resource = searchParams.get('resource') || undefined;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const ipAddress = searchParams.get('ipAddress') || undefined;
    const search = searchParams.get('search') || undefined;

    const { skip, take, page: pageNum, limit: pageLimit } = getOffsetPagination({ page, limit });

    // 构建查询条件
    const where: Record<string, unknown> = {};

    if (userId) {
      where.userId = userId;
    }

    if (action && action.length > 0) {
      where.action = { in: action };
    }

    if (resource) {
      where.resource = { contains: resource };
    }

    if (ipAddress) {
      where.ipAddress = { contains: ipAddress };
    }

    // 日期范围
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        (where.createdAt as Record<string, Date>).gte = new Date(startDate);
      }
      if (endDate) {
        (where.createdAt as Record<string, Date>).lte = new Date(endDate);
      }
    }

    // 搜索条件（搜索details JSON）
    if (search) {
      where.OR = [
        { action: { contains: search } },
        { resource: { contains: search } },
        { details: { contains: search } },
      ];
    }

    // 查询总数和数据
    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // 获取相关用户信息
    const userIds = [...new Set(logs.map((log) => log.userId).filter(Boolean))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds as string[] } },
      select: { id: true, username: true, email: true, name: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    // 组装响应数据
    const logsWithUsers = logs.map((log) => ({
      id: log.id,
      userId: log.userId,
      action: log.action,
      resource: log.resource,
      details: log.details ? JSON.parse(log.details) : null,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      createdAt: log.createdAt,
      user: log.userId ? userMap.get(log.userId) : null,
    }));

    return NextResponse.json(createPaginatedResponse(logsWithUsers, total, pageNum, pageLimit));
  } catch (error) {
    console.error('Get audit logs error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
