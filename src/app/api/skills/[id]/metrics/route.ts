// src/app/api/skills/[id]/metrics/route.ts
// GET - 获取技能评估指标

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { calculateSkillMetrics } from '@/services/skill-evolution/metrics-calculator';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }

  const { id } = await params;

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
