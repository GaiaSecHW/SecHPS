import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { invalidateUserCaches } from '@/lib/cache';

// 为用户分配角色
export async function POST(
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
    if (!hasPermission(payload.permissions, PERMISSIONS.USER_ASSIGN_ROLE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const body = await request.json();
    const { roleIds } = body;

    if (!roleIds || !Array.isArray(roleIds)) {
      return NextResponse.json(
        { error: 'roleIds 必须是数组' },
        { status: 400 }
      );
    }

    // 验证所有角色存在
    const roles = await prisma.role.findMany({
      where: {
        id: { in: roleIds },
      },
    });

    if (roles.length !== roleIds.length) {
      return NextResponse.json(
        { error: '一个或多个角色未找到' },
        { status: 404 }
      );
    }

    // 使用事务保证角色分配原子性
    const { id } = await params;
    await prisma.$transaction(async (tx) => {
      // 删除现有角色分配
      await tx.userRole.deleteMany({
        where: { userId: id },
      });

      // 分配新角色
      if (roleIds.length > 0) {
        await tx.userRole.createMany({
          data: roleIds.map((roleId) => ({
            userId: id,
            roleId,
          })),
        });
      }
    });

    // 清除用户缓存，确保权限实时更新
    invalidateUserCaches(id);

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'user_assign_role',
        resource: id,
        details: JSON.stringify({ roleIds }),
      },
    });

    return NextResponse.json({
      message: '角色分配成功',
      roleIds,
    });
  } catch (error) {
    console.error('Assign roles error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
