// src/app/api/scans/[id]/start/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// POST /api/scans/:id/start - 启动扫描
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

    const scan = await prisma.scanTask.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!scan) {
      return NextResponse.json({ error: '扫描任务不存在' }, { status: 404 });
    }

    if (scan.status === 'running') {
      return NextResponse.json({ error: '任务已在运行中' }, { status: 400 });
    }

    // 更新任务状态
    const updated = await prisma.scanTask.update({
      where: { id },
      data: {
        status: 'running',
        startedAt: new Date(),
        progress: 0,
        completedSkills: 0,
        findingsCount: 0,
        currentSkill: null,
        error: null,
      },
    });

    // TODO: 实际执行扫描的逻辑（后台任务）
    // 这里只更新状态，实际执行需要集成 Agent 执行引擎

    return NextResponse.json({
      scan: {
        ...updated,
        skillIds: JSON.parse(updated.skillIds),
      },
      message: '扫描任务已启动',
    });
  } catch (error) {
    console.error('启动扫描错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
