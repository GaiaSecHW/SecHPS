// src/app/api/admin/broadcast/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { generateId } from '@/lib/id-generator';
import { logger, LOG_MODULES } from '@/lib/logger';

const BROADCAST_KEY = 'broadcast_content';

interface BroadcastConfig {
  content: string;
  enabled: boolean;
  color: string;
}

const DEFAULT_CONFIG: BroadcastConfig = {
  content: '欢迎使用 SecHPS 测试平台',
  enabled: true,
  color: 'blue',
};

const VALID_COLORS = ['blue', 'yellow', 'red', 'green'];

// GET /api/admin/broadcast - 获取广播配置
export async function GET(request: Request) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_READ });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key: BROADCAST_KEY },
    });

    if (!config) {
      return NextResponse.json({ config: DEFAULT_CONFIG });
    }

    const broadcastConfig: BroadcastConfig = JSON.parse(config.value);
    return NextResponse.json({ config: broadcastConfig });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '获取广播配置失败:', { details: error });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PUT /api/admin/broadcast - 更新广播配置
export async function PUT(request: Request) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_UPDATE });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  try {
    const body = await request.json();
    const { content, enabled, color } = body;

    // 验证颜色值
    if (color && !VALID_COLORS.includes(color)) {
      return NextResponse.json({ error: '无效的颜色值' }, { status: 400 });
    }

    const broadcastConfig: BroadcastConfig = {
      content: content || DEFAULT_CONFIG.content,
      enabled: enabled ?? DEFAULT_CONFIG.enabled,
      color: color || DEFAULT_CONFIG.color,
    };

    const existingConfig = await prisma.systemConfig.findUnique({
      where: { key: BROADCAST_KEY },
    });

    if (existingConfig) {
      await prisma.systemConfig.update({
        where: { key: BROADCAST_KEY },
        data: {
          value: JSON.stringify(broadcastConfig),
          updatedAt: new Date(),
        },
      });
    } else {
      await prisma.systemConfig.create({
        data: {
          id: generateId('config'),
          key: BROADCAST_KEY,
          value: JSON.stringify(broadcastConfig),
          description: '广播通知配置',
          updatedAt: new Date(),
        },
      });
    }

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        id: generateId('audit'),
        userId: payload.userId,
        action: 'broadcast_config_update',
        resource: BROADCAST_KEY,
        details: JSON.stringify(broadcastConfig),
      },
    });

    return NextResponse.json({
      message: '广播配置已更新',
      config: broadcastConfig,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '更新广播配置失败:', { details: error });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}