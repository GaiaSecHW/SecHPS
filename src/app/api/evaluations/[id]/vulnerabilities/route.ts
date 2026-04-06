// src/app/api/evaluations/[id]/vulnerabilities/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

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

    const { id } = await params;

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
