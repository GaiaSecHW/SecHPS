import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  hashPassword,
  generateToken,
  generateRefreshToken,
  getUserWithPermissions,
  generateCookieHeader,
  COOKIE_CONFIG,
} from '@/lib/auth';
import { ROLES, DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from '@/types/permissions';
import type { Permission } from '@prisma/client';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, password, name, email } = body;

    // 验证输入（用户名和密码为必填项）
    if (!username || !password) {
      return NextResponse.json(
        { details: { error: '请输入用户名和密码' } },
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

    // 如果提供了邮箱，检查邮箱是否已存在
    if (email) {
      const existingEmail = await prisma.user.findUnique({
        where: { email },
      });

      if (existingEmail) {
        return NextResponse.json(
          { details: { error: '邮箱已被使用' } },
          { status: 400 }
        );
      }
    }

    // 哈希密码
    const passwordHash = await hashPassword(password);

    // 创建用户
    const user = await prisma.user.create({
      data: {
        id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        username,
        passwordHash,
        name: name || username,
        email: email || `${username}@local`, // 如果没有提供邮箱，使用默认邮箱
        updatedAt: new Date(),
      },
    });

    // 分配默认角色（USER）
    const defaultRole = await prisma.role.findUnique({
      where: { name: ROLES.USER },
    });

    if (defaultRole) {
      await prisma.userRole.create({
        data: {
          id: `ur-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          userId: user.id,
          roleId: defaultRole.id,
        },
      });
    }

    // 获取用户权限
    const userWithPerms = await getUserWithPermissions(user.id);
    const roles = userWithPerms?.roles || [];
    const permissions = userWithPerms?.permissions || [];

    // 生成 JWT Token（注册后自动登录）
    const token = generateToken(user, roles, permissions);
    
    // 生成 Refresh Token
    const refreshToken = generateRefreshToken(user.id);

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
        message: '注册成功',
        token,
        refreshToken, // 可选：返回给前端用于 localStorage 备份
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
          roles: roles.map(r => r.name),
          permissions: permissions,
        },
      },
      {
        status: 201,
        headers: {
          'Set-Cookie': `${accessTokenCookie}, ${refreshTokenCookie}`,
        },
      }
    );
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AUTH, '注册失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { details: { error: '服务器内部错误' } },
      { status: 500 }
    );
  }
}
