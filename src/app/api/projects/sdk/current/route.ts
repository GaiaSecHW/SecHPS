// src/app/api/projects/sdk/current/route.ts

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/projects/sdk/current
 * 获取当前 SDK 项目（当前未使用，返回 null）
 */
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // SDK 当前项目功能暂未实现
    // 返回 null
    return NextResponse.json({ project: null });
  } catch (error) {
    console.error('[SDK Current] Error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
