// src/app/api/skills/[id]/metrics/route.ts
// GET - 获取技能评估指标

import { NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { calculateSkillMetrics } from '@/services/skill-evolution/metrics-calculator';
import { prisma } from '@/lib/prisma';
import { buildTenantFilter } from '@/lib/tenant-filter';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload, tenant } = auth as AuthSuccessResult;

  const { id } = await params;

  // 租户隔离检查：验证 Skill 访问权限
  const skill = await prisma.skill.findUnique({
    where: { id },
    select: { userId: true, tenantId: true, isPublic: true },
  });

  if (!skill) {
    return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 });
  }

  if (skill.userId && skill.userId !== payload.userId) {
    if (!tenant.isPlatformAdmin && !tenant.isIcsTenant) {
      const tenantFilter = buildTenantFilter(tenant, {
        tenantField: 'tenantId',
        isPublicField: 'isPublic',
      });
      const matchesFilter = 
        (tenantFilter as any).OR?.some((cond: any) => {
          if (cond.isPublic && skill.isPublic) return true;
          if (cond.tenantId && skill.tenantId === cond.tenantId) return true;
          return false;
        }) ?? false;
      
      if (!matchesFilter) {
        return NextResponse.json({ error: '禁止访问此 Skill' }, { status: 403 });
      }
    }
  }

  // 解析时间范围参数
  const url = new URL(request.url);
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');

  const timeRange = startDate && endDate
    ? { start: new Date(startDate), end: new Date(endDate) }
    : undefined;

  try {
    const metrics = await calculateSkillMetrics(id, timeRange);

    // 计算 F1 Score
    const recall = metrics.totalFindings > 0 
      ? metrics.confirmedCount / metrics.totalFindings 
      : 0;
    const f1Score = (metrics.precision + recall) > 0
      ? 2 * (metrics.precision * recall) / (metrics.precision + recall)
      : 0;

    return NextResponse.json({
      skillId: metrics.skillId,
      skillName: metrics.skillName,
      displayName: metrics.displayName,
      precision: metrics.precision,
      recall,
      f1Score,
      falsePositiveRate: metrics.falsePositiveRate,
      confirmedCount: metrics.confirmedCount,
      falsePositiveCount: metrics.falsePositiveCount,
      pendingCount: metrics.pendingCount,
      totalExecutions: metrics.totalExecutions,
      totalFindings: metrics.totalFindings,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] 获取 Skill 指标失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取指标失败' },
      { status: 500 }
    );
  }
}
