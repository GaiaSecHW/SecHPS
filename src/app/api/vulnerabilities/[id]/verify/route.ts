// src/app/api/vulnerabilities/[id]/verify/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// POST /api/vulnerabilities/:id/verify - 验证修复
// 数据隔离：普通用户只能验证自己项目的漏洞，管理员可以验证所有
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 验证所有权
    let where: any = { id };
    if (!userIsAdmin) {
      where.Project = { userId: payload.userId };
    }

    const vulnerability = await prisma.vulnerability.findFirst({ 
      where,
      include: { Project: { select: { userId: true } } },
    });
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

    logger.update(LOG_MODULES.VULNERABILITY, payload, id, { action: 'verify' });

    return NextResponse.json({ vulnerability: updated });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.VULNERABILITY, '验证修复错误', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}