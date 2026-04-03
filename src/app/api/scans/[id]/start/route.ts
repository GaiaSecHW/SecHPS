// src/app/api/scans/[id]/start/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { ScanExecutor } from '@/lib/scan-executor';

// 存储活跃的扫描执行器（用于取消）
const activeScans = new Map<string, ScanExecutor>();

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
    await prisma.scanTask.update({
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

    // 在后台执行扫描
    const executor = new ScanExecutor(id);
    activeScans.set(id, executor);

    // 异步执行，不阻塞响应
    executor.execute()
      .then(async (results) => {
        console.log(`[ScanExecutor] 扫描完成: ${id}`, results);
        activeScans.delete(id);
      })
      .catch(async (error) => {
        console.error(`[ScanExecutor] 扫描失败: ${id}`, error);
        await prisma.scanTask.update({
          where: { id },
          data: {
            status: 'failed',
            error: error.message,
            completedAt: new Date(),
          },
        });
        activeScans.delete(id);
      });

    return NextResponse.json({
      scan: {
        ...scan,
        skillIds: JSON.parse(scan.skillIds),
      },
      message: '扫描任务已启动',
    });
  } catch (error) {
    console.error('启动扫描错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 导出供取消 API 使用
export { activeScans };