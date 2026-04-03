// src/app/api/scans/[id]/reports/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/scans/:id/reports - 获取扫描报告列表
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

    const reports = await prisma.scanReport.findMany({
      where: { scanTaskId: id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      reports: reports.map(r => ({
        ...r,
        summary: JSON.parse(r.summary),
        details: JSON.parse(r.details),
      })),
    });
  } catch (error) {
    console.error('获取扫描报告错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
