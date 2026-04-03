// src/app/api/scans/[id]/reports/export/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// POST /api/scans/:id/reports/export - 导出报告
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
    const body = await request.json();
    const { format = 'json', reportId } = body;

    // 获取扫描任务
    const scan = await prisma.scanTask.findUnique({
      where: { id },
      include: {
        project: {
          select: { id: true, name: true },
        },
        executions: {
          include: {
            skill: {
              select: { id: true, name: true, displayName: true },
            },
          },
        },
        reports: reportId ? { where: { id: reportId } } : true,
      },
    });

    if (!scan) {
      return NextResponse.json({ error: '扫描任务不存在' }, { status: 404 });
    }

    // 根据格式导出
    if (format === 'json') {
      const exportData = {
        scanTask: {
          id: scan.id,
          name: scan.name,
          description: scan.description,
          status: scan.status,
          progress: scan.progress,
          findingsCount: scan.findingsCount,
          startedAt: scan.startedAt,
          completedAt: scan.completedAt,
          createdAt: scan.createdAt,
        },
        project: scan.project,
        skillIds: JSON.parse(scan.skillIds),
        executions: scan.executions.map(e => ({
          id: e.id,
          skill: e.skill,
          status: e.status,
          startedAt: e.startedAt,
          completedAt: e.completedAt,
          duration: e.duration,
          error: e.error,
        })),
        reports: scan.reports.map(r => ({
          id: r.id,
          name: scan.name + ' Report',
          summary: JSON.parse(r.summary),
          details: JSON.parse(r.details),
          createdAt: r.createdAt,
        })),
        exportedAt: new Date().toISOString(),
      };

      return new Response(JSON.stringify(exportData, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="scan-${scan.id}-report.json"`,
        },
      });
    }

    if (format === 'csv') {
      // 简单的 CSV 导出
      const rows = [
        ['ID', 'Name', 'Status', 'Progress', 'Findings', 'Started', 'Completed'],
        [
          scan.id,
          scan.name,
          scan.status,
          `${scan.progress}%`,
          scan.findingsCount.toString(),
          scan.startedAt?.toISOString() || '',
          scan.completedAt?.toISOString() || '',
        ],
      ];

      const csv = rows.map(row => row.join(',')).join('\n');

      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="scan-${scan.id}-report.csv"`,
        },
      });
    }

    return NextResponse.json({ error: '不支持的导出格式' }, { status: 400 });
  } catch (error) {
    console.error('导出报告错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
