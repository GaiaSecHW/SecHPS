import { NextResponse } from 'next/server';
import {
  generateClearCookieHeader,
  COOKIE_CONFIG,
} from '@/lib/auth';

export async function POST(request: Request) {
  try {
    // 清除 access token cookie
    const accessTokenCookie = generateClearCookieHeader(
      COOKIE_CONFIG.ACCESS_TOKEN.name
    );
    
    // 清除 refresh token cookie
    const refreshTokenCookie = generateClearCookieHeader(
      COOKIE_CONFIG.REFRESH_TOKEN.name
    );

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
    console.error('Logout error:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}