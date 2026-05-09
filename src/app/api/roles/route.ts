import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { PERMISSIONS, ROLES } from '@/types/permissions';
import { getOffsetPagination } from '@/lib/pagination';
import { logger, LOG_MODULES } from '@/lib/logger';
import { fetchPermissionsPaginated } from '@/lib/auth';
import { generateId } from '@/lib/id-generator';

// 获取所有角色
export async function GET(request: Request) {
  // 使用统一认证中间件
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.ROLE_READ });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    // 解析 URL 参数
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const search = searchParams.get('search') || undefined;

    // 获取分页参数
    const { skip, take, page: currentPage, limit: currentLimit } = getOffsetPagination({ page, limit });

    // 构建 where 条件
    const where = search ? {
      OR: [
        { name: { contains: search } },
        { description: { contains: search } },
      ],
    } : {};

    // 获取总数
    const total = await prisma.role.count({ where });

    // 获取角色列表
    const roles = await prisma.role.findMany({
      where,
      skip,
      take,
      include: {
        UserRole: {
          include: {
            User: {
              select: {
                id: true,
                email: true,
                username: true,
                name: true,
              },
            },
          },
        },
      },
    });

    // Fetch permissions per role via paginated raw SQL (MTU black hole fix)
    type PermRow = { id: string; name: string; description: string | null; module: string; action: string; resource: string | null; createdAt: Date; updatedAt: Date };
    const rolePermMap = new Map<string, PermRow[]>();
    for (const role of roles) {
      const perms = await fetchPermissionsPaginated<PermRow>([role.id], 'p.*', 10);
      rolePermMap.set(role.id, perms);
    }

    // Attach permissions to each role
    const rolesWithPerms = roles.map(role => ({
      ...role,
      Permission: rolePermMap.get(role.id) ?? [],
    }));

    // 计算总页数
    const totalPages = Math.ceil(total / currentLimit);

    return NextResponse.json({
      roles: rolesWithPerms,
      pagination: {
        total,
        page: currentPage,
        limit: currentLimit,
        totalPages,
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.ROLE, '获取角色列表失败', { details: String(error) });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}

// 创建角色
export async function POST(request: Request) {
  // 使用统一认证中间件
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.ROLE_CREATE });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    const body = await request.json();
    const { name, description } = body;

    if (!name) {
      return NextResponse.json({ details: { error: '角色名称是必需的' } }, { status: 400 });
    }

    // 检查角色名是否已存在
    const existingRole = await prisma.role.findUnique({
      where: { name },
    });

    if (existingRole) {
      return NextResponse.json({ details: { error: '角色已存在' } }, { status: 400 });
    }

    // 创建角色
    const role = await prisma.role.create({
      data: {
        id: generateId('role'),
        name,
        description,
        isSystem: false,
        updatedAt: new Date(),
      },
    });

    // 记录审计日志
    prisma.auditLog.create({
      data: {
        id: generateId('audit'),
        userId: payload.userId,
        action: 'role_create',
        resource: role.id,
        details: JSON.stringify({ name: role.name, description }),
      },
    }).catch(err => logger.errorWithUser(LOG_MODULES.ROLE, payload, '记录审计日志失败', role.id, { details: { error: String(err) } }));

    logger.create(LOG_MODULES.ROLE, payload, role.id, { name: role.name, description });
    return NextResponse.json({ role }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.ROLE, '创建角色失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
