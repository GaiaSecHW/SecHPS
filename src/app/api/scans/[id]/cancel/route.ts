// src/app/api/scans/[id]/cancel/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// POST /api/scans/:id/cancel - 取消扫描
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

    const scan = await prisma.scanTask.findUnique({ where: { id } });

    if (!scan) {
      return NextResponse.json({ error: '扫描任务不存在' }, { status: 404 });
    }

    if (scan.status !== 'running') {
      return NextResponse.json({ error: '只有运行中的任务可以取消' }, { status: 400 });
    }

    // 更新任务状态
    const updated = await prisma.scanTask.update({
      where: { id },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
      },
    });

    // 取消关联的执行
    await prisma.skillExecution.updateMany({
      where: {
        scanTaskId: id,
        status: 'pending',
      },
      data: {
        status: 'cancelled',
      },
    });

    return NextResponse.json({
      scan: {
        ...updated,
        skillIds: JSON.parse(updated.skillIds),
      },
      message: '扫描任务已取消',
    });
  } catch (error) {
    console.error('取消扫描错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
