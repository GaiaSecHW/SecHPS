import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS, ROLES } from '@/types/permissions';
import { getOffsetPagination } from '@/lib/pagination';
import { logger, LOG_MODULES } from '@/lib/logger';

// 获取所有角色
export async function GET(request: Request) {
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
    if (!hasPermission(payload.permissions, PERMISSIONS.ROLE_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

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
        permissions: true,
        userRoles: {
          include: {
            user: {
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

    // 计算总页数
    const totalPages = Math.ceil(total / currentLimit);

    return NextResponse.json({
      roles,
      pagination: {
        total,
        page: currentPage,
        limit: currentLimit,
        totalPages,
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.ROLE, '获取角色列表失败', { details: String(error) });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 创建角色
export async function POST(request: Request) {
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
    if (!hasPermission(payload.permissions, PERMISSIONS.ROLE_CREATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const body = await request.json();
    const { name, description } = body;

    if (!name) {
      return NextResponse.json({ error: '角色名称是必需的' }, { status: 400 });
    }

    // 检查角色名是否已存在
    const existingRole = await prisma.role.findUnique({
      where: { name },
    });

    if (existingRole) {
      return NextResponse.json({ error: '角色已存在' }, { status: 400 });
    }

    // 创建角色
    const role = await prisma.role.create({
      data: {
        name,
        description,
        isSystem: false,
      },
    });

    // 记录审计日志
    prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'role_create',
        resource: role.id,
        details: JSON.stringify({ name: role.name, description }),
      },
    }).catch(err => logger.errorWithUser(LOG_MODULES.ROLE, payload, '记录审计日志失败', role.id, { error: String(err) }));

    logger.create(LOG_MODULES.ROLE, payload, role.id, { name: role.name, description });
    return NextResponse.json({ role }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.ROLE, '创建角色失败', { error: String(error) });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
