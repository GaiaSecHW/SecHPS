import { NextResponse } from 'next/server';
import {
  verifyRefreshToken,
  verifyTokenAllowExpired,
  generateToken,
  generateRefreshToken,
  getUserWithPermissions,
  generateCookieHeader,
  COOKIE_CONFIG,
} from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { User } from '@prisma/client';

export async function POST(request: Request) {
  try {
    // 1. 尝试从 Cookie 获取 refresh token
    const cookieHeader = request.headers.get('cookie') || '';
    const cookies = Object.fromEntries(
      cookieHeader.split(';').map((c) => {
        const [key, ...v] = c.trim().split('=');
        return [key, v.join('=')];
      })
    );

    let refreshToken = cookies[COOKIE_CONFIG.REFRESH_TOKEN.name];

    // 2. 如果没有 Cookie，尝试从请求体获取
    if (!refreshToken) {
      const body = await request.json().catch(() => ({}));
      refreshToken = body.refreshToken;
    }

    if (!refreshToken) {
      return NextResponse.json(
        { error: '缺少 refresh token' },
        { status: 401 }
      );
    }

    // 3. 验证 refresh token
    const refreshPayload = verifyRefreshToken(refreshToken);
    if (!refreshPayload) {
      return NextResponse.json(
        { error: '无效或过期的 refresh token' },
        { status: 401 }
      );
    }

    // 4. 获取用户信息和权限
    const userWithPerms = await getUserWithPermissions(refreshPayload.userId);
    if (!userWithPerms) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 401 }
      );
    }

    const { user, roles, permissions } = userWithPerms;

    // 5. 检查用户是否激活
    if (!user.isActive) {
      return NextResponse.json(
        { error: '账户已被禁用' },
        { status: 403 }
      );
    }

    // 6. 生成新的 access token
    const newAccessToken = generateToken(user, roles, permissions);

    // 7. 生成新的 refresh token（轮换机制）
    const newRefreshToken = generateRefreshToken(user.id);

    // 8. 设置 Cookie 并返回
    const accessTokenCookie = generateCookieHeader(
      COOKIE_CONFIG.ACCESS_TOKEN.name,
      newAccessToken,
      COOKIE_CONFIG.ACCESS_TOKEN.maxAge
    );
    const refreshTokenCookie = generateCookieHeader(
      COOKIE_CONFIG.REFRESH_TOKEN.name,
      newRefreshToken,
      COOKIE_CONFIG.REFRESH_TOKEN.maxAge
    );

    return NextResponse.json(
      {
        message: 'Token 刷新成功',
        token: newAccessToken, // 兼容前端 localStorage 方案
        refreshToken: newRefreshToken, // 可选：返回给前端存储
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
          avatar: user.avatar,
          roles: roles.map((r) => r.name),
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
    console.error('Token refresh error:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}