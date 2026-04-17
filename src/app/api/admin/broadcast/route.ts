// src/app/api/admin/broadcast/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

const BROADCAST_KEY = 'broadcast_content';

interface BroadcastConfig {
  content: string;
  enabled: boolean;
  color: string;
}

const DEFAULT_CONFIG: BroadcastConfig = {
  content: '欢迎使用 AI4WEB 测试平台',
  enabled: true,
  color: 'blue',
};

const VALID_COLORS = ['blue', 'yellow', 'red', 'green'];

// GET /api/admin/broadcast - 获取广播配置
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

    const config = await prisma.systemConfig.findUnique({
      where: { key: BROADCAST_KEY },
    });

    if (!config) {
      return NextResponse.json({ config: DEFAULT_CONFIG });
    }

    const broadcastConfig: BroadcastConfig = JSON.parse(config.value);
    return NextResponse.json({ config: broadcastConfig });
  } catch (error) {
    console.error('获取广播配置失败:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PUT /api/admin/broadcast - 更新广播配置
export async function PUT(request: Request) {
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
          id: `config-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
        id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
    console.error('更新广播配置失败:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}