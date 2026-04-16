import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

// 获取单个用户
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.USER_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 获取用户
    const { id } = await params;
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                permissions: true,
              },
            },
          },
        },
        opencodeConfig: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: '未找到用户' }, { status: 404 });
    }

    // 格式化返回数据
    const formattedUser = {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      avatar: user.avatar,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      roles: user.userRoles.map(ur => ({
        id: ur.role.id,
        name: ur.role.name,
        description: ur.role.description,
        permissions: ur.role.permissions.map(p => p.name),
      })),
      opencodeConfigs: user.opencodeConfig.map(config => ({
        id: config.id,
        name: config.name,
        baseURL: config.baseURL,
        description: config.description,
        isActive: config.isActive,
      })),
    };

    // 记录访问日志 - 区分自己与他人
    if (payload.userId === user.id) {
      logger.access(LOG_MODULES.USER, payload, id);
    } else {
      logger.accessOther(LOG_MODULES.USER, payload, user.id, id, user.email);
    }
    return NextResponse.json({ user: formattedUser });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.USER, '获取用户详情失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 更新用户
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 检查权限（可以更新自己，或者有用户管理权限）
    const canUpdateOthers = hasPermission(payload.permissions, PERMISSIONS.USER_UPDATE);
    const { id } = await params;
    const isSelf = payload.userId === id;

    if (!canUpdateOthers && !isSelf) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const body = await request.json();
    const { name, avatar, isActive } = body;

    // 更新用户
    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(avatar !== undefined && { avatar }),
        ...(isActive !== undefined && canUpdateOthers && { isActive }),
      },
    });

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'user_update',
        resource: id,
        details: JSON.stringify({ name, avatar, isActive }),
      },
    });

    // 记录更新日志 - 区分自己与他人
    if (isSelf) {
      logger.update(LOG_MODULES.USER, payload, id, { name, avatar, isActive });
    } else {
      logger.updateOther(LOG_MODULES.USER, payload, user.id, id, user.email, { name, avatar, isActive });
    }

    return NextResponse.json({
      message: '用户更新成功',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        avatar: user.avatar,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.USER, '更新用户失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 删除用户
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.USER_DELETE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 不允许删除自己
    const { id } = await params;
    if (payload.userId === id) {
      return NextResponse.json({ error: '无法删除自己' }, { status: 400 });
    }

    // 获取被删除用户信息（用于日志）
    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true },
    });

    // 删除用户
    await prisma.user.delete({
      where: { id },
    });

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'user_delete',
        resource: id,
      },
    });

    // 删除他人用户 - 使用跨用户日志
    logger.deleteOther(LOG_MODULES.USER, payload, id, id, targetUser?.email);

    return NextResponse.json({ message: '用户删除成功' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.USER, '删除用户失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
