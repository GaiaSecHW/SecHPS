// src/app/api/vulnerabilities/[id]/fix/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// POST /api/vulnerabilities/:id/fix - 标记已修复
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

    if (vulnerability.status !== 'confirmed') {
      return NextResponse.json(
        { error: '只有已确认的漏洞才能标记修复' },
        { status: 400 }
      );
    }

    const updated = await prisma.vulnerability.update({
      where: { id },
      data: {
        status: 'fixed',
        fixedBy: payload.userId,
        fixedAt: new Date(),
      },
    });

    logger.update(LOG_MODULES.VULNERABILITY, payload, id, { action: 'fix' });

    return NextResponse.json({ vulnerability: updated });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.VULNERABILITY, '标记修复错误', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
