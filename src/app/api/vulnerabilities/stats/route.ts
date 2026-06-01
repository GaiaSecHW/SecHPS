import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/vulnerabilities/stats - 获取漏洞统计
// 数据隔离：基于租户上下文过滤，普通租户用户只能统计同租户项目的漏洞
export async function GET(request: Request) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.VULNERABILITY_READ });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload, tenant } = auth as AuthSuccessResult;

  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');

    const isPrivileged = tenant.isPlatformAdmin || (tenant.isIcsTenant && payload.roles.includes('admin'));

    const where: Record<string, unknown> = {};

    if (!isPrivileged) {
      // Security: 非特权用户只能看自己或同租户 TaskInstance 的漏洞
      const accessibleTasks = await prisma.taskInstance.findMany({
        where: {
          OR: [
            { userId: payload.userId },
            { tenantId: tenant.tenantId },
          ],
        },
        select: { id: true },
      });
      if (accessibleTasks.length > 0) {
        where.taskId = { in: accessibleTasks.map(t => t.id) };
      } else {
        where.taskId = null;
      }
    }

    if (taskId) {
      where.taskId = taskId;
    }

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

    const taskCounts = await prisma.vulnerability.groupBy({
      by: ['taskId'],
      where: { ...where, taskId: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    const taskIds = taskCounts.map(t => t.taskId).filter(Boolean) as string[];
    const taskInstances = taskIds.length > 0 ? await prisma.taskInstance.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, name: true, agentName: true, createdAt: true },
    }) : [];

    const tasks = taskCounts.map(tc => {
      const ti = taskInstances.find(t => t.id === tc.taskId);
      return {
        id: tc.taskId,
        name: ti?.name || '未知任务',
        agentName: ti?.agentName || '',
        count: tc._count.id,
      };
    });

    return NextResponse.json({ stats, tasks });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.VULNERABILITY, '获取漏洞统计错误', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}