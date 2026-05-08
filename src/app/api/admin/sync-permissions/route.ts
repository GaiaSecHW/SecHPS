import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS, ROLES, DEFAULT_ROLE_PERMISSIONS } from '@/types/permissions';
import { generateId } from '@/lib/id-generator';
import { logger, LOG_MODULES } from '@/lib/logger';
import { fetchPermissionsPaginated } from '@/lib/auth';

export async function POST(request: Request) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.ROLE_ASSIGN_PERMISSION });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  logger.info(LOG_MODULES.PERMISSION, '开始同步权限和角色', { userId: payload.userId });

  try {
    const results = {
      permissionsCreated: 0,
      permissionsUpdated: 0,
      rolesCreated: 0,
      rolesUpdated: 0,
      permissionAssignments: 0,
    };

    // 1. 同步所有权限
    for (const [key, value] of Object.entries(PERMISSIONS)) {
      const [module, action] = value.split(':');
      const existing = await prisma.permission.findUnique({ where: { name: value } });
      
      if (existing) {
        results.permissionsUpdated++;
      } else {
        await prisma.permission.create({
          data: {
            id: generateId('perm'),
            name: value,
            module,
            action,
            updatedAt: new Date(),
          },
        });
        results.permissionsCreated++;
      }
    }

    // 2. 同步所有角色
    const createdRoles: Record<string, { id: string; name: string }> = {};
    for (const [key, value] of Object.entries(ROLES)) {
      const role = await prisma.role.upsert({
        where: { name: value },
        update: { updatedAt: new Date() },
        create: {
          id: generateId('role'),
          name: value,
          description: `${value} role`,
          isSystem: true,
          updatedAt: new Date(),
        },
      });
      createdRoles[value] = role;
      results.rolesCreated++;
    }

    // 3. 同步角色权限
    for (const [roleName, permissionNames] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      const role = createdRoles[roleName];
      if (!role) {
        logger.warn(LOG_MODULES.PERMISSION, `角色不存在: ${roleName}`);
        continue;
      }

      // 获取当前角色的权限 (paginated raw SQL to avoid MTU black hole)
      const currentPermRows = await fetchPermissionsPaginated<{ id: string; name: string }>([role.id], 'p.id, p.name');

      const currentPermIds = new Set(currentPermRows.map(p => p.id));

      // 添加新权限
      for (const permissionName of permissionNames) {
        const permission = await prisma.permission.findUnique({
          where: { name: permissionName },
        });

        if (permission && !currentPermIds.has(permission.id)) {
          await prisma.role.update({
            where: { id: role.id },
            data: {
              Permission: { connect: { id: permission.id } },
            },
          });
          results.permissionAssignments++;
        }
      }

      // 删除不再需要的权限
      const newPermNames = new Set<string>(permissionNames);
      for (const perm of currentPermRows) {
        if (!newPermNames.has(perm.name)) {
          await prisma.role.update({
            where: { id: role.id },
            data: {
              Permission: { disconnect: { id: perm.id } },
            },
          });
        }
      }
    }

    // 4. 统计每个角色的权限数量
    const roleStats: Record<string, number> = {};
    for (const roleName of Object.keys(DEFAULT_ROLE_PERMISSIONS)) {
      const role = createdRoles[roleName];
      if (role) {
        const perms = await fetchPermissionsPaginated<{ name: string }>([role.id], 'p.name');
        roleStats[roleName] = perms.length;
      }
    }

    logger.info(LOG_MODULES.PERMISSION, '权限同步完成', results);

    return NextResponse.json({
      success: true,
      message: '权限和角色同步完成',
      results,
      roleStats,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PERMISSION, '权限同步失败', { details: { error: String(error) } });
    return NextResponse.json({
      success: false,
      error: '权限同步失败',
      details: String(error),
    }, { status: 500 });
  }
}