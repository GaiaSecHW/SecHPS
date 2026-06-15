import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { invalidateUserCaches } from '@/lib/cache';
import { generateIndexedId, generateId } from '@/lib/id-generator';
import { logger, LOG_MODULES } from '@/lib/logger';
import { getTenantContext } from '@/lib/tenant';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.USER_ASSIGN_ROLE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;
    const tenant = getTenantContext(payload);
    const { id } = await params;

    const body = await request.json();
    const { roleIds } = body;

    if (!roleIds || !Array.isArray(roleIds)) {
      return NextResponse.json(
        { error: 'roleIds 必须是数组' },
        { status: 400 }
      );
    }

    // 获取目标用户信息
    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true, tenantId: true, UserRole: { include: { Role: true } } },
    });

    if (!targetUser) {
      return NextResponse.json(
        { error: '用户未找到' },
        { status: 404 }
      );
    }

    // 检查目标用户是否是平台管理员（admin角色 + 无租户）
    const isTargetPlatformAdmin = targetUser.UserRole.some(ur => ur.Role.name === 'admin') && !targetUser.tenantId;

    // 规则1：平台管理员的权限不允许任何人更改
    if (isTargetPlatformAdmin) {
      return NextResponse.json(
        { error: '禁止修改平台管理员的角色' },
        { status: 403 }
      );
    }

    // 规则2：拥有admin权限的用户，仅允许修改与该用户相同租户的用户的权限
    // ICSL租户admin和平台admin可以修改任意租户用户的角色
    // 动态从数据库查 Tenant 表，确保 isIcsTenant 准确（JWT 中该字段可能过期）
    const dbTenant = tenant.tenantId ? await prisma.tenant.findUnique({ where: { id: tenant.tenantId }, select: { isIcsTenant: true } }) : null;
    const isIcsTenantAdmin = (dbTenant?.isIcsTenant ?? false) && (payload.roles ?? []).includes('admin');
    if (!tenant.isPlatformAdmin && !isIcsTenantAdmin) {
      // 非平台管理员 + 非ICSL租户admin，必须与目标用户同租户
      if (tenant.tenantId !== targetUser.tenantId) {
        return NextResponse.json(
          { error: '只能修改同租户用户的角色' },
          { status: 403 }
        );
      }
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
    await prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({
        where: { userId: id },
      });

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

    invalidateUserCaches(id);

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
