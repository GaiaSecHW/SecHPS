// src/app/api/vulnerabilities/stats/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/vulnerabilities/stats - 获取漏洞统计
export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    const where: Record<string, unknown> = {};
    if (projectId) where.projectId = projectId;

    // 总数和按状态统计
    const [total, byStatus, bySeverity, byType, recentVulnerabilities] = await Promise.all([
      prisma.vulnerability.count({ where }),
      prisma.vulnerability.groupBy({
        by: ['status'],
        _count: { id: true },
        where,
      }),
      prisma.vulnerability.groupBy({
        by: ['severity'],
        _count: { id: true },
        where,
      }),
      prisma.vulnerability.groupBy({
        by: ['type'],
        _count: { id: true },
        where,
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
      prisma.vulnerability.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { createdAt: true },
      }),
    ]);

    // 计算趋势（按天分组）
    const trendMap = new Map<string, number>();
    recentVulnerabilities.forEach(v => {
      const date = v.createdAt.toISOString().split('T')[0];
      trendMap.set(date, (trendMap.get(date) || 0) + 1);
    });
    const trend = Array.from(trendMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const stats = {
      total,
      byStatus: Object.fromEntries(byStatus.map(s => [s.status, s._count.id])),
      bySeverity: Object.fromEntries(bySeverity.map(s => [s.severity, s._count.id])),
      byType: Object.fromEntries(byType.map(t => [t.type, t._count.id])),
      trend,
    };

    return NextResponse.json({ stats });
  } catch (error) {
    console.error('获取漏洞统计错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
