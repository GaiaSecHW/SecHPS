import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// 获取所有用户
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
    if (!hasPermission(payload.permissions, PERMISSIONS.USER_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 获取所有用户
    const users = await prisma.user.findMany({
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
      orderBy: {
        createdAt: 'desc',
      },
    });

    // 格式化返回数据
    const formattedUsers = users.map(user => ({
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      avatar: user.avatar,
      isActive: user.isActive,
      createdAt: user.createdAt,
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
    }));

    return NextResponse.json({ users: formattedUsers, total: users.length });
  } catch (error) {
    console.error('获取用户错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 创建用户（管理员专用）
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
    if (!hasPermission(payload.permissions, PERMISSIONS.USER_CREATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const body = await request.json();
    const { email, username, password, name, roles } = body;

    // 验证输入
    if (!email || !username || !password) {
      return NextResponse.json(
        { error: '缺少必填字段' },
        { status: 400 }
      );
    }

    // 检查邮箱是否已存在
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: '邮箱已存在' },
        { status: 400 }
      );
    }

    // 检查用户名是否已存在
    const existingUsername = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUsername) {
      return NextResponse.json(
        { error: '用户名已存在' },
        { status: 400 }
      );
    }

    // 哈希密码
    const { hashPassword } = await import('@/lib/auth');
    const passwordHash = await hashPassword(password);

    // 创建用户
    const user = await prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
        name: name || username,
      },
    });

    // 分配角色
    if (roles && roles.length > 0) {
      for (const roleName of roles) {
        const role = await prisma.role.findUnique({
          where: { name: roleName },
        });

        if (role) {
          await prisma.userRole.create({
            data: {
              userId: user.id,
              roleId: role.id,
            },
          });
        }
      }
    } else {
      // 分配默认角色
      const defaultRole = await prisma.role.findUnique({
        where: { name: 'user' },
      });

      if (defaultRole) {
        await prisma.userRole.create({
          data: {
            userId: user.id,
            roleId: defaultRole.id,
          },
        });
      }
    }

    // 创建默认 AI4WEB 配置
    await prisma.opencodeConfig.create({
      data: {
        userId: user.id,
        name: 'Default',
        baseURL: 'http://localhost:54321',
      },
    });

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'user_create',
        resource: user.id,
        details: JSON.stringify({ email, username, roles }),
      },
    });

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
    console.error('创建用户错误:', error);
    return NextResponse.json(
      { error: '服务器内部错误', details: String(error) },
      { status: 500 }
    );
  }
}
