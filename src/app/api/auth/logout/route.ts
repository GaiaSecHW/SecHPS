import { NextResponse } from 'next/server';
import {
  generateClearCookieHeader,
  COOKIE_CONFIG,
  verifyToken,
} from '@/lib/auth';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function POST(request: Request) {
  try {
    // 尝试获取当前用户信息用于日志
    const authHeader = request.headers.get('authorization');
    let payload = null;
    
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      payload = verifyToken(token);
    }
    
    // 清除 access token cookie
    const accessTokenCookie = generateClearCookieHeader(
      COOKIE_CONFIG.ACCESS_TOKEN.name
    );
    
    // 清除 refresh token cookie
    const refreshTokenCookie = generateClearCookieHeader(
      COOKIE_CONFIG.REFRESH_TOKEN.name
    );

    // 记录注销日志
    if (payload) {
      logger.logout(payload, { email: payload.email });
    } else {
      logger.logNoUser(LOG_MODULES.AUTH, '用户注销（无token）');
    }

    return NextResponse.json(
      { message: '登出成功' },
      {
        status: 200,
        headers: {
          'Set-Cookie': `${accessTokenCookie}, ${refreshTokenCookie}`,
        },
      }
    );
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.AUTH, '登出失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { details: { error: '服务器内部错误' } },
      { status: 500 }
    );
  }
}