// src/app/api/admin/notifications/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { generateId } from '@/lib/id-generator';

// GET /api/admin/notifications/[id] - 获取单个通知渠道
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_READ });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  try {
    const { id } = await params;

    const channel = await prisma.notificationChannel.findUnique({
      where: { id },
    });

    if (!channel) {
      return NextResponse.json({ error: '通知渠道不存在' }, { status: 404 });
    }

    logger.access(LOG_MODULES.AUDIT, payload, `notification_channel:${id}`, {});
    return NextResponse.json({ channel });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AUDIT, '获取通知渠道详情失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PUT /api/admin/notifications/[id] - 更新通知渠道
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_UPDATE });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  try {
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
        id: generateId('audit'),
        userId: payload.userId,
        action: 'notification_channel_update',
        resource: id,
        details: JSON.stringify({ name }),
      },
    });

    logger.update(LOG_MODULES.AUDIT, payload, id, { name });
    return NextResponse.json({
      message: '通知渠道已更新',
      channel,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AUDIT, '更新通知渠道失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/admin/notifications/[id] - 删除通知渠道
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_DELETE });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  try {
    const { id } = await params;

    await prisma.notificationChannel.delete({
      where: { id },
    });

    await prisma.auditLog.create({
      data: {
        id: generateId('audit'),
        userId: payload.userId,
        action: 'notification_channel_delete',
        resource: id,
      },
    });

    logger.delete(LOG_MODULES.AUDIT, payload, id, {});
    return NextResponse.json({ message: '通知渠道已删除' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AUDIT, '删除通知渠道失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
