// src/app/api/admin/audit-logs/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/admin/audit-logs/[id] - 获取单条审计日志详情
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

    const log = await prisma.auditLog.findUnique({
      where: { id },
    });

    if (!log) {
      return NextResponse.json({ error: '审计日志不存在' }, { status: 404 });
    }

    // 获取用户信息
    let user = null;
    if (log.userId) {
      user = await prisma.user.findUnique({
        where: { id: log.userId },
        select: { id: true, username: true, email: true, name: true, avatar: true },
      });
    }

    // 解析details
    const details = log.details ? JSON.parse(log.details) : null;

    // 如果是敏感操作，检查权限
    const sensitiveActions = [
      'password_change',
      'user_delete',
      'config_update',
      'config_delete',
    ];

    if (sensitiveActions.includes(log.action)) {
      // 敏感操作需要更高权限
      if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
        return NextResponse.json({ error: '禁止访问敏感审计日志' }, { status: 403 });
      }
    }

    return NextResponse.json({
      log: {
        id: log.id,
        userId: log.userId,
        action: log.action,
        resource: log.resource,
        details,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        createdAt: log.createdAt,
        user,
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AUDIT, '获取审计日志详情错误:', { details: error });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
