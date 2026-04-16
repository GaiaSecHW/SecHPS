// src/app/api/vulnerabilities/stats/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/vulnerabilities/stats - 获取漏洞统计
// 普通用户：只统计自己项目的漏洞
// 管理员：统计所有漏洞
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的令牌' } }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');

    // 检查是否是管理员 - roles 是 string[]
    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');
    
    // 构建查询条件
    const where: Record<string, unknown> = {};
    
    // 管理员可以看到所有漏洞；普通用户只能看到自己项目的漏洞
    if (!isAdmin) {
      if (projectId) {
        // 指定了项目ID，需要验证用户是否有权限访问该项目
        const project = await prisma.project.findUnique({
          where: { id: projectId },
          select: { userId: true },
        });
        if (!project || project.userId !== payload.userId) {
          return NextResponse.json({ details: { error: '禁止访问' } }, { status: 403 });
        }
        where.projectId = projectId;
      } else {
        // 普通用户没有指定项目：只统计自己项目的漏洞
        const userProjects = await prisma.project.findMany({
          where: { userId: payload.userId },
          select: { id: true },
        });
        const projectIds = userProjects.map(p => p.id);
        
        if (projectIds.length === 0) {
          // 用户没有项目，返回空统计
          return NextResponse.json({
            stats: {
              total: 0,
              byStatus: {},
              bySeverity: {},
              byType: {},
              trend: [],
            },
          });
        }
        
        where.projectId = { in: projectIds };
      }
    } else {
      // 管理员：可以查看指定项目或所有漏洞
      if (projectId) {
        where.projectId = projectId;
      }
    }

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
    logger.errorNoUser(LOG_MODULES.VULNERABILITY, '获取漏洞统计错误', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
