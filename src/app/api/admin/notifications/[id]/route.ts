// src/app/api/admin/notifications/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/admin/notifications/[id] - 获取单个通知渠道
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

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;

    const channel = await prisma.notificationChannel.findUnique({
      where: { id },
    });

    if (!channel) {
      return NextResponse.json({ error: '通知渠道不存在' }, { status: 404 });
    }

    return NextResponse.json({ channel });
  } catch (error) {
    console.error('Get notification channel error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PUT /api/admin/notifications/[id] - 更新通知渠道
export async function PUT(
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

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { name, config, enabled } = body;

    const channel = await prisma.notificationChannel.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(config && { config: JSON.stringify(config) }),
        ...(enabled !== undefined && { enabled }),
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'notification_channel_update',
        resource: id,
        details: JSON.stringify({ name }),
      },
    });

    return NextResponse.json({
      message: '通知渠道已更新',
      channel,
    });
  } catch (error) {
    console.error('Update notification channel error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/admin/notifications/[id] - 删除通知渠道
export async function DELETE(
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

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_DELETE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;

    await prisma.notificationChannel.delete({
      where: { id },
    });

    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'notification_channel_delete',
        resource: id,
      },
    });

    return NextResponse.json({ message: '通知渠道已删除' });
  } catch (error) {
    console.error('Delete notification channel error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
