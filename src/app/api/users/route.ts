import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';
import { logger, LOG_MODULES } from '@/lib/logger';

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
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.USER_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    // 解析分页参数
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || searchParams.get('pageSize') || '20');

    const { skip, take, page: pageNum, limit: pageLimit } = getOffsetPagination({ page, limit });

    // 获取用户总数和分页数据
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        include: {
          UserRole: {
            include: {
              Role: {
                include: {
                  Permission: true,
                },
              },
            },
          },
          OpencodeConfig: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take,
      }),
      prisma.user.count(),
    ]);

    // 格式化返回数据
    const formattedUsers = users.map(user => ({
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      avatar: user.avatar,
      isActive: user.isActive,
      createdAt: user.createdAt,
      roles: user.UserRole.map(ur => ({
        id: ur.Role.id,
        name: ur.Role.name,
        description: ur.Role.description,
        permissions: ur.Role.Permission.map(p => p.name),
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
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.USER_CREATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const body = await request.json();
    const { email, username, password, name, roles } = body;

    // 验证输入
    if (!email || !username || !password) {
      return NextResponse.json(
        { details: { error: '缺少必填字段' } },
        { status: 400 }
      );
    }

    // 验证密码复杂度
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return NextResponse.json({ details: { error: passwordValidation.error } }, { status: 400 });
    }

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
          id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          email,
          username,
          passwordHash,
          name: name || username,
          updatedAt: new Date(),
        },
      });

      // 分配角色
      if (roles && roles.length > 0) {
        // 获取所有角色
        const roleRecords = await tx.role.findMany({
          where: { name: { in: roles } },
        });

        if (roleRecords.length > 0) {
          await tx.userRole.createMany({
            data: roleRecords.map((role, index) => ({
              id: `userrole-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
              userId: newUser.id,
              roleId: role.id,
            })),
          });
        }
      } else {
        // 分配默认角色
        const defaultRole = await tx.role.findUnique({
          where: { name: 'user' },
        });

        if (defaultRole) {
          await tx.userRole.create({
            data: {
              id: `userrole-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
              userId: newUser.id,
              roleId: defaultRole.id,
            },
          });
        }
      }

      // 创建默认 AI4WEB 配置
      await tx.opencodeConfig.create({
        data: {
          id: `config-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          userId: newUser.id,
          name: 'Default',
          baseURL: 'http://localhost:54321',
          updatedAt: new Date(),
        },
      });

      return newUser;
    });

    // 记录审计日志（放在事务外，避免事务失败也记录审计）
    await prisma.auditLog.create({
          data: {
            id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            userId: payload.userId,
            action: 'user_create',
            resource: user.id,
            details: JSON.stringify({ email, username, roles }),
          },
        });

    // 记录创建日志 - 管理员创建新用户（跨用户操作）
    logger.create(LOG_MODULES.USER, payload, user.id, { targetEmail: email, targetUsername: username, roles });

    return NextResponse.json(
      {
        message: '用户创建成功',
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.USER, '创建用户失败', { details: { error: String(error) } });
    return NextResponse.json(
      { details: { error: '服务器内部错误', details: String(error) } },
      { status: 500 }
    );
  }
}
