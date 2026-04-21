// src/app/api/admin/alerts/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { generateId } from '@/lib/id-generator';
import type { AlertCondition } from '@/types/monitoring';

// GET /api/admin/alerts - 获取告警规则列表
export async function GET(request: Request) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_READ });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {

    const rules = await prisma.alertRule.findMany({
      include: {
        _count: {
          select: { AlertInstance: true },
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
        alertCount: rule._count.AlertInstance,
      })),
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AUDIT, '获取告警规则失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}

// POST /api/admin/alerts - 创建告警规则
export async function POST(request: Request) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_UPDATE });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    const body = await request.json();
    const { name, description, metricType, condition, severity, cooldownPeriod, notificationChannels, tags } = body;

    if (!name || !metricType || !condition || !notificationChannels) {
      return NextResponse.json({ details: { error: '缺少必填字段' } }, { status: 400 });
    }

    const rule = await prisma.alertRule.create({
      data: {
        id: generateId('alert-rule'),
        name,
        description,
        metricType,
        condition: JSON.stringify(condition as AlertCondition),
        severity: severity || 'medium',
        cooldownPeriod: cooldownPeriod || 300,
        notificationChannels: JSON.stringify(notificationChannels),
        tags: tags ? JSON.stringify(tags) : null,
        updatedAt: new Date(),
      },
    });

    await prisma.auditLog.create({
      data: {
        id: generateId('audit'),
        userId: payload.userId,
        action: 'alert_rule_create',
        resource: rule.id,
        details: JSON.stringify({ name, metricType }),
      },
    });

    logger.create(LOG_MODULES.AUDIT, payload, rule.id, { name, metricType });
    return NextResponse.json({
      message: '告警规则已创建',
      rule,
    }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AUDIT, '创建告警规则失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
