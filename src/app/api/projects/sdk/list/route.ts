// src/app/api/projects/sdk/list/route.ts

import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/projects/sdk/list
 * 获取 SDK 项目列表（当前未使用，返回空列表）
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

    // SDK 项目列表功能暂未实现
    // 返回空列表
    return NextResponse.json({ projects: [] });
  } catch (error) {
    console.error('[SDK List] Error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
