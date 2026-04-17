// src/app/api/vulnerabilities/[id]/false-positive/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// POST /api/vulnerabilities/:id/false-positive - 标记误报
// 数据隔离：普通用户只能标记自己项目的漏洞为误报，管理员可以标记所有
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

    // 检查是否是管理员
    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');

    // 验证所有权
    let where: any = { id };
    if (!isAdmin) {
      where.Project = { userId: payload.userId };
    }

    const vulnerability = await prisma.vulnerability.findFirst({ 
      where,
      include: { Project: { select: { userId: true } } },
    });
    if (!vulnerability) {
      return NextResponse.json({ error: '漏洞不存在' }, { status: 404 });
    }

    const updated = await prisma.vulnerability.update({
      where: { id },
      data: {
        status: 'false-positive',
        confirmedBy: payload.userId,
        confirmedAt: new Date(),
      },
    });

    // 更新关联的执行记录
    if (vulnerability.skillExecutionId) {
      await prisma.skillExecution.update({
        where: { id: vulnerability.skillExecutionId },
        data: { falsePositiveCount: { increment: 1 } },
      });
    }

    logger.update(LOG_MODULES.VULNERABILITY, payload, id, { action: 'false-positive' });

    return NextResponse.json({ vulnerability: updated });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.VULNERABILITY, '标记误报错误', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}