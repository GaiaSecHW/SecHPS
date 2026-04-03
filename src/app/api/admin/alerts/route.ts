// src/app/api/admin/alerts/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import type { AlertCondition } from '@/types/monitoring';

// GET /api/admin/alerts - 获取告警规则列表
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

    const rules = await prisma.alertRule.findMany({
      include: {
        _count: {
          select: { alerts: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      rules: rules.map((rule) => ({
        ...rule,
        condition: JSON.parse(rule.condition),
        notificationChannels: JSON.parse(rule.notificationChannels),
        tags: rule.tags ? JSON.parse(rule.tags) : null,
        alertCount: rule._count.alerts,
      })),
    });
  } catch (error) {
    console.error('Get alert rules error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/admin/alerts - 创建告警规则
export async function POST(request: Request) {
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

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const body = await request.json();
    const { name, description, metricType, condition, severity, cooldownPeriod, notificationChannels, tags } = body;

    if (!name || !metricType || !condition || !notificationChannels) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    const rule = await prisma.alertRule.create({
      data: {
        name,
        description,
        metricType,
        condition: JSON.stringify(condition as AlertCondition),
        severity: severity || 'medium',
        cooldownPeriod: cooldownPeriod || 300,
        notificationChannels: JSON.stringify(notificationChannels),
        tags: tags ? JSON.stringify(tags) : null,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'alert_rule_create',
        resource: rule.id,
        details: JSON.stringify({ name, metricType }),
      },
    });

    return NextResponse.json({
      message: '告警规则已创建',
      rule,
    }, { status: 201 });
  } catch (error) {
    console.error('Create alert rule error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
