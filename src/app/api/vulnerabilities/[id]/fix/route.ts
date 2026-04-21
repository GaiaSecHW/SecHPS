// src/app/api/vulnerabilities/[id]/fix/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// POST /api/vulnerabilities/:id/fix - 标记已修复
// 数据隔离：普通用户只能标记自己项目的漏洞为已修复，管理员可以标记所有
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