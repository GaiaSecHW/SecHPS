import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

// 获取所有权限
export async function GET(request: Request) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的令牌' } }, { status: 401 });
    }

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.PERMISSION_READ)) {
      return NextResponse.json({ details: { error: '禁止访问' } }, { status: 403 });
    }

    // 获取所有权限
    const permissions = await prisma.permission.findMany({
      include: {
        Role: true,
      },
    });

    logger.access(LOG_MODULES.PERMISSION, payload, 'all');
    return NextResponse.json({ permissions });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PERMISSION, '获取权限列表失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}

// 创建权限
export async function POST(request: Request) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的令牌' } }, { status: 401 });
    }

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.PERMISSION_CREATE)) {
      return NextResponse.json({ details: { error: '禁止访问' } }, { status: 403 });
    }

    const body = await request.json();
    const { name, module, action, resource, description } = body;

    if (!name || !module || !action) {
      return NextResponse.json(
        { details: { error: '缺少必填字段' } },
        { status: 400 }
      );
    }

    // 检查权限是否已存在
    const existingPermission = await prisma.permission.findFirst({
      where: {
        module,
        action,
        resource: resource || null,
      },
    });

    if (existingPermission) {
      return NextResponse.json({ details: { error: '权限已存在' } }, { status: 400 });
    }

    // 创建权限
    const permission = await prisma.permission.create({
      data: {
        id: `perm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name,
        module,
        action,
        resource,
        description,
        updatedAt: new Date(),
      },
    });

    // 记录审计日志
    prisma.auditLog.create({
      data: {
        id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        userId: payload.userId,
        action: 'permission_create',
        resource: permission.id,
        details: JSON.stringify({ name: permission.name, module, action }),
      },
    }).catch(err => logger.errorWithUser(LOG_MODULES.PERMISSION, payload, '记录审计日志失败', permission.id, { details: { error: String(err) } }));

    logger.create(LOG_MODULES.PERMISSION, payload, permission.id, { name: permission.name, module, action });
    return NextResponse.json({ permission }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PERMISSION, '创建权限失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
