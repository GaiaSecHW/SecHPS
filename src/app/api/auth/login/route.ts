import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword, generateToken, getUserWithPermissions } from '@/lib/auth';
import { ROLES } from '@/types/permissions';
import { auditLogAuth } from '@/lib/audit/logger';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, password } = body;

    // 验证输入
    if (!username || !password) {
      return NextResponse.json(
        { error: '请输入用户名和密码' },
        { status: 400 }
      );
    }

    // 查找用户（仅支持用户名登录）
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      return NextResponse.json(
        { error: '用户名或密码错误' },
        { status: 401 }
      );
    }

    // 验证密码
    const isValidPassword = await verifyPassword(password, user.passwordHash);

    if (!isValidPassword) {
      return NextResponse.json(
        { error: '用户名或密码错误' },
        { status: 401 }
      );
    }

    // 检查用户是否激活
    if (!user.isActive) {
      return NextResponse.json(
        { error: '账户已被禁用' },
        { status: 403 }
      );
    }

    // 获取用户权限
    const { roles, permissions } = await getUserWithPermissions(user.id);

    // 生成 JWT Token
    const token = generateToken(user, roles, permissions);

    // 记录审计日志
    await auditLogAuth('login', user.id, request, {
      metadata: { method: 'username_password' },
    });

    return NextResponse.json(
      {
        message: '登录成功',
        token,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
          avatar: user.avatar,
          roles: roles.map(r => r.name),
          permissions: permissions,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}
