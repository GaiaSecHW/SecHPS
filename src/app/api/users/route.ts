import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequestAsync, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { generateId, ID_PREFIXES } from '@/lib/id-generator';
import { PERMISSIONS } from '@/types/permissions';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';
import { logger, LOG_MODULES } from '@/lib/logger';
import { fetchPermissionsPaginated } from '@/lib/auth';

// 密码复杂度验证函数
function validatePassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 8) {
    return { valid: false, error: '密码至少需要8个字符' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: '密码需要包含小写字母' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: '密码需要包含大写字母' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: '密码需要包含数字' };
  }
  return { valid: true };
}

// 获取所有用户
export async function GET(request: Request) {
  try {
    // 验证 Token 和权限
    const auth = await authenticateRequestAsync(request, { requiredPermission: PERMISSIONS.USER_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const { payload, tenant } = auth as AuthSuccessResult;

    // 解析分页参数
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || searchParams.get('pageSize') || '20');
    const search = searchParams.get('search') || '';

    const { skip, take, page: pageNum, limit: pageLimit } = getOffsetPagination({ page, limit });

    // 构建租户过滤条件
    let where: any = {};
    if (!tenant.isPlatformAdmin && !tenant.isIcsTenant) {
      if (tenant.tenantId) {
        // 租户用户：看到同租户用户 + 无租户用户
        where.OR = [
          { tenantId: tenant.tenantId },
          { tenantId: null },
        ];
      } else {
        // 无租户用户：只看到无租户用户
        where.tenantId = null;
      }
    }

    // 搜索过滤
    if (search) {
      const searchFilter = {
        OR: [
          { username: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      };
      if (where.OR) {
        // 已有租户 OR 条件，需要组合
        where = { AND: [where, searchFilter] };
      } else {
        Object.assign(where, searchFilter);
      }
    }

    // 获取用户总数和分页数据
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: {
          UserRole: {
            include: {
              Role: true,
            },
          },
          OpencodeConfig: true,
          Tenant: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take,
      }),
      prisma.user.count({ where }),
    ]);

    // Fetch permissions for all roles via paginated raw SQL (MTU black hole fix)
    const allRoleIds = [...new Set(users.flatMap(u => u.UserRole.map(ur => ur.roleId)))];
    const rolePermMap = new Map<string, string[]>();
    for (const roleId of allRoleIds) {
      const rows = await fetchPermissionsPaginated<{ name: string }>([roleId], 'p.name');
      rolePermMap.set(roleId, rows.map(r => r.name));
    }

    // 格式化返回数据
    const formattedUsers = users.map(user => ({
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      avatar: user.avatar,
      isActive: user.isActive,
      tenantId: user.tenantId,
      tenantName: user.Tenant?.name ?? null,
      createdAt: user.createdAt,
      roles: user.UserRole.map(ur => ({
        id: ur.Role.id,
        name: ur.Role.name,
        description: ur.Role.description,
        permissions: rolePermMap.get(ur.roleId) ?? [],
      })),
      opencodeConfigs: user.OpencodeConfig.map(config => ({
        id: config.id,
        name: config.name,
        baseURL: config.baseURL,
        description: config.description,
        isActive: config.isActive,
      })),
    }));

    // 记录访问日志 - 管理员访问用户列表
    logger.access(LOG_MODULES.USER, payload, 'user_list', { total, page: pageNum, limit: pageLimit });

    return NextResponse.json({
      users: formattedUsers,
      pagination: {
        page: pageNum,
        limit: pageLimit,
        total,
        totalPages: Math.ceil(total / pageLimit),
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.USER, '获取用户列表失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}

// 创建用户（管理员专用）
export async function POST(request: Request) {
  try {
    // 验证 Token 和权限
    const auth = await authenticateRequestAsync(request, { requiredPermission: PERMISSIONS.USER_CREATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const { payload, tenant } = auth as AuthSuccessResult;

    const body = await request.json();
    const { username, name, roles: roleIds, tenantId: targetTenantId } = body;
    const email = body.email || `${username}@sechps.local`;

    // 权限保护规则：
    // - 平台管理员(admin+无租户)的admin角色不可被任何人分配（新建用户不能成为平台管理员）
    // - 租户admin可以给同租户用户分配admin角色
    // - 非平台管理员只能在自己租户内创建用户
    if (!tenant.isPlatformAdmin) {
      if (tenant.tenantId !== (targetTenantId || tenant.tenantId)) {
        return NextResponse.json(
          { details: { error: '只能在本租户内创建用户' } },
          { status: 403 }
        );
      }
    }

    const adminRole = await prisma.role.findUnique({ where: { name: 'admin' } });
    // 禁止创建无租户的admin用户（平台管理员）
    if (adminRole && (roleIds || []).includes(adminRole.id) && !targetTenantId) {
      return NextResponse.json(
        { details: { error: '禁止创建平台管理员用户' } },
        { status: 403 }
      );
    }
    // 租户admin只能给同租户用户分配admin角色
    if (adminRole && (roleIds || []).includes(adminRole.id) && targetTenantId && targetTenantId !== tenant.tenantId && !tenant.isPlatformAdmin) {
      return NextResponse.json(
        { details: { error: '只能给同租户用户分配管理员角色' } },
        { status: 403 }
      );
    }
    const safeRoleIds = roleIds || [];

    // 验证输入
    if (!username) {
      return NextResponse.json(
        { details: { error: '缺少必填字段' } },
        { status: 400 }
      );
    }

    // 自动生成初始密码
    const crypto = await import('crypto');
    const password = crypto.randomBytes(6).toString('base64url').slice(0, 12) + 'Aa1';

    // 检查邮箱是否已存在
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { details: { error: '邮箱已存在' } },
        { status: 400 }
      );
    }

    // 检查用户名是否已存在
    const existingUsername = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUsername) {
      return NextResponse.json(
        { details: { error: '用户名已存在' } },
        { status: 400 }
      );
    }

    // 哈希密码
    const { hashPassword } = await import('@/lib/auth');
    const passwordHash = await hashPassword(password);

    // 使用事务创建用户、分配角色、创建配置（保证原子性）
    const user = await prisma.$transaction(async (tx) => {
      // 创建用户
      const newUser = await tx.user.create({
        data: {
          id: generateId(ID_PREFIXES.USER),
          email,
          username,
          passwordHash,
          name: name || username,
          tenantId: targetTenantId || null,
          mustChangePassword: true,
          updatedAt: new Date(),
        },
      });

      // 分配角色
      if (safeRoleIds.length > 0) {
        const roleRecords = await tx.role.findMany({
          where: { id: { in: safeRoleIds } },
        });

        if (roleRecords.length > 0) {
          await tx.userRole.createMany({
            data: roleRecords.map((role, index) => ({
              id: `${generateId(ID_PREFIXES.USER_ROLE)}-${index}`,
              userId: newUser.id,
              roleId: role.id,
            })),
          });
        }
      } else {
        // 分配默认 user 角色
        const defaultRole = await tx.role.findUnique({
          where: { name: 'user' },
        });

        if (defaultRole) {
          await tx.userRole.create({
            data: {
              id: generateId(ID_PREFIXES.USER_ROLE),
              userId: newUser.id,
              roleId: defaultRole.id,
            },
          });
        }
      }

      return newUser;
    });

    // 记录审计日志（放在事务外，避免事务失败也记录审计）
    await prisma.auditLog.create({
          data: {
            id: generateId(ID_PREFIXES.AUDIT),
            userId: payload.userId,
            action: 'user_create',
            resource: user.id,
                details: JSON.stringify({ email, username, roleIds: safeRoleIds }),
          },
        });

    // 记录创建日志 - 管理员创建新用户（跨用户操作）
    logger.create(LOG_MODULES.USER, payload, user.id, { targetEmail: email, targetUsername: username, roleIds: safeRoleIds });

    return NextResponse.json(
      {
        message: '用户创建成功',
        initialPassword: password,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
          tenantId: user.tenantId,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.USER, '创建用户失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { details: { error: '服务器内部错误' } },
      { status: 500 }
    );
  }
}
