import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { invalidateUserCaches } from '@/lib/cache';
import { generateIndexedId, generateId } from '@/lib/id-generator';
import { logger, LOG_MODULES } from '@/lib/logger';

// 为用户分配角色
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token 和权限
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.USER_ASSIGN_ROLE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

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
          data: roleIds.map((roleId, index) => ({
            id: generateIndexedId('userrole', index),
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
            id: generateId('audit'),
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
    logger.errorNoUser(LOG_MODULES.USER, '分配角色错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
