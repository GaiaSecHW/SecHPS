// src/app/api/admin/notifications/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import type { NotificationChannelType } from '@/types/monitoring';

// GET /api/admin/notifications - 获取通知渠道列表
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

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
      return NextResponse.json({ details: { error: '禁止访问' } }, { status: 403 });
    }

    const channels = await prisma.notificationChannel.findMany({
      orderBy: { createdAt: 'desc' },
    });

    // 隐藏敏感配置
    const sanitizedChannels = channels.map((channel) => ({
      ...channel,
      config: maskSensitiveConfig(channel.type, channel.config),
    }));

    logger.access(LOG_MODULES.AUDIT, payload, 'notification_channels', {});
    return NextResponse.json({ channels: sanitizedChannels });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AUDIT, '获取通知渠道失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}

// POST /api/admin/notifications - 创建通知渠道
export async function POST(request: Request) {
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

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ details: { error: '禁止访问' } }, { status: 403 });
    }

    const body = await request.json();
    const { name, type, config, enabled } = body;

    if (!name || !type || !config) {
      return NextResponse.json({ details: { error: '缺少必填字段' } }, { status: 400 });
    }

    // 验证渠道类型
    const validTypes: NotificationChannelType[] = ['email', 'webhook', 'slack', 'dingtalk', 'wechat'];
    if (!validTypes.includes(type)) {
      return NextResponse.json({ details: { error: '无效的渠道类型' } }, { status: 400 });
    }

    const channel = await prisma.notificationChannel.create({
      data: {
        id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name,
        type,
        config: JSON.stringify(config),
        enabled: enabled ?? true,
        updatedAt: new Date(),
      },
    });

    await prisma.auditLog.create({
      data: {
        id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId: payload.userId,
        action: 'notification_channel_create',
        resource: channel.id,
        details: JSON.stringify({ name, type }),
      },
    });

    logger.create(LOG_MODULES.AUDIT, payload, channel.id, { name, type });
    return NextResponse.json({
      message: '通知渠道已创建',
      channel: {
        ...channel,
        config: maskSensitiveConfig(channel.type, channel.config),
      },
    }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AUDIT, '创建通知渠道失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}

/**
 * 隐藏敏感配置信息
 */
function maskSensitiveConfig(type: string, configStr: string): Record<string, unknown> {
  const config = JSON.parse(configStr);

  switch (type) {
    case 'webhook':
    case 'slack':
    case 'dingtalk':
    case 'wechat':
      if (config.webhookUrl) {
        config.webhookUrl = maskUrl(config.webhookUrl);
      }
      break;
    case 'email':
      if (config.smtpPassword) {
        config.smtpPassword = '******';
      }
      break;
  }

  return config;
}

/**
 * 遮蔽URL中的敏感部分
 */
function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // 保留协议和域名，遮蔽路径
    return `${parsed.protocol}//${parsed.host}/***`;
  } catch {
    return '***';
  }
}
