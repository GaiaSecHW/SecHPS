// src/app/api/vulnerabilities/[id]/verify/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// POST /api/vulnerabilities/:id/verify - 验证修复
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

    const vulnerability = await prisma.vulnerability.findUnique({ where: { id } });
    if (!vulnerability) {
      return NextResponse.json({ error: '漏洞不存在' }, { status: 404 });
    }

    if (vulnerability.status !== 'fixed') {
      return NextResponse.json(
        { error: '只有已修复的漏洞才能验证' },
        { status: 400 }
      );
    }

    const updated = await prisma.vulnerability.update({
      where: { id },
      data: {
        status: 'verified',
        verifiedBy: payload.userId,
        verifiedAt: new Date(),
      },
    });

    return NextResponse.json({ vulnerability: updated });
  } catch (error) {
    console.error('验证修复错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
