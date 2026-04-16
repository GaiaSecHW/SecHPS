import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  verifyPassword,
  generateToken,
  generateRefreshToken,
  getUserWithPermissions,
  generateCookieHeader,
  COOKIE_CONFIG,
} from '@/lib/auth';
import { ROLES } from '@/types/permissions';
import { auditLogAuth } from '@/lib/audit/logger';
import { invalidateUserCaches } from '@/lib/cache';
import { logger, LOG_MODULES } from '@/lib/logger';

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
      // 登录失败：用户不存在
      logger.loginFailedNoUser(username, '用户不存在');
      return NextResponse.json(
        { error: '用户名或密码错误' },
        { status: 401 }
      );
    }

    // 验证密码
    const isValidPassword = await verifyPassword(password, user.passwordHash);

    if (!isValidPassword) {
      // 登录失败：密码错误
      logger.loginFailedNoUser(username, '密码错误', { details: { userId: user.id, email: user.email } });
      return NextResponse.json(
        { error: '用户名或密码错误' },
        { status: 401 }
      );
    }

    // 检查用户是否激活
    if (!user.isActive) {
      // 登录失败：账户被禁用
      logger.loginFailedNoUser(username, '账户被禁用', { details: { userId: user.id, email: user.email } });
      return NextResponse.json(
        { error: '账户已被禁用' },
        { status: 403 }
      );
    }

    // 获取用户权限
    const userWithPerms = await getUserWithPermissions(user.id);
    
    if (!userWithPerms) {
      return NextResponse.json(
        { error: '获取用户权限失败' },
        { status: 500 }
      );
    }
    
    const { roles, permissions } = userWithPerms;

    // 清除用户缓存，确保获取最新权限
    invalidateUserCaches(user.id);

    // 生成 JWT Token
    const token = generateToken(user, roles, permissions);
    
    // 生成 Refresh Token
    const refreshToken = generateRefreshToken(user.id);

    // 记录审计日志
    await auditLogAuth('login', user.id, request, {
      metadata: { method: 'username_password' },
    });
    
    // 登录成功日志
    logger.loginSuccess(user.id, user.email, { username: user.username, roles: roles.map(r => r.name) });

    // 设置 HttpOnly Cookie
    const accessTokenCookie = generateCookieHeader(
      COOKIE_CONFIG.ACCESS_TOKEN.name,
      token,
      COOKIE_CONFIG.ACCESS_TOKEN.maxAge
    );
    const refreshTokenCookie = generateCookieHeader(
      COOKIE_CONFIG.REFRESH_TOKEN.name,
      refreshToken,
      COOKIE_CONFIG.REFRESH_TOKEN.maxAge
    );

    return NextResponse.json(
      {
        message: '登录成功',
        token,
        refreshToken, // 可选：返回给前端用于 localStorage 备份
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
      {
        status: 200,
        headers: {
          'Set-Cookie': `${accessTokenCookie}, ${refreshTokenCookie}`,
        },
      }
    );
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AUTH, '登录失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}