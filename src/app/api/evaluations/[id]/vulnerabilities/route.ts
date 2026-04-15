// src/app/api/evaluations/[id]/vulnerabilities/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { PERMISSIONS } from '@/types/permissions';

export async function GET(
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

    // 权限检查
    if (!hasPermission(payload.permissions, PERMISSIONS.EVALUATION_READ)) {
      return NextResponse.json({ error: '无权限查看漏洞' }, { status: 403 });
    }

    const { id } = await params;

    // 评估归属校验
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      include: { project: { select: { userId: true } } },
    });

    if (!evaluation) {
      return NextResponse.json({ vulnerabilities: [] });
    }

    if (evaluation.project.userId !== payload.userId) {
      return NextResponse.json({ error: '无权查看此评估漏洞' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const severity = searchParams.get('severity');
    const type = searchParams.get('type');
    const status = searchParams.get('status');

    const where: any = { evaluationId: id };
    if (severity) where.severity = severity;
    if (type) where.type = { contains: type };
    if (status) where.status = status;

    const vulnerabilities = await prisma.vulnerability.findMany({
      where,
      orderBy: [
        { severity: 'asc' },
        { createdAt: 'desc' },
      ],
    });

    return NextResponse.json({ vulnerabilities });
  } catch (error) {
    console.error('Get vulnerabilities error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
