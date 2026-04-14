// src/app/api/config/template/route.ts
// 获取当前用户的 skillOutputTemplate

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

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

    // 获取当前用户的激活配置
    const config = await prisma.opencodeConfig.findFirst({
      where: { 
        userId: payload.userId,
        isActive: true,
      },
      select: {
        skillOutputTemplate: true,
      },
    });

    return NextResponse.json({ 
      skillOutputTemplate: config?.skillOutputTemplate || null 
    });
  } catch (error) {
    console.error('Get template error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}