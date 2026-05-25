// src/app/api/skills/[id]/analyze/route.ts
// POST - 分析技能平衡性并生成改进建议

import { NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { processEvolutionTask } from '@/services/skill-evolution/task-manager';
import { createEvolutionTask } from '@/services/skill-evolution/evolution-scheduler';
import { getCompactCases } from '@/services/skill-evolution/case-extractor';
import { calculateSkillMetrics } from '@/services/skill-evolution/metrics-calculator';
import { prisma } from '@/lib/prisma';
import { buildTenantFilter } from '@/lib/tenant-filter';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload, tenant } = auth as AuthSuccessResult;

  const { id } = await params;

  try {
    // 1. 检查 Skill 是否存在
    const skill = await prisma.skill.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        displayName: true,
        content: true,
        userId: true,
        tenantId: true,
        isPublic: true,
      },
    });

    if (!skill) {
      return NextResponse.json(
        { error: 'Skill 不存在' },
        { status: 404 }
      );
    }

    // 2. 租户隔离检查（非所有者需要验证访问权限）
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

    // 3. 获取案例数据
    const cases = await getCompactCases(id);

    // 检查是否有足够的案例进行分析
    if (cases.falsePositives.length === 0) {
      return NextResponse.json(
        { error: '没有误报案例可供分析，至少需要 1 个误报案例' },
        { status: 400 }
      );
    }

    if (cases.confirmedCases.length === 0) {
      return NextResponse.json(
        { error: '没有正确发现案例可供分析，至少需要 1 个正确发现案例进行平衡分析' },
        { status: 400 }
      );
    }

    // 3. 获取 Skill 指标（用于创建任务）
    const metrics = await calculateSkillMetrics(id);

    // 4. 创建进化任务
    const task = await createEvolutionTask(id, 'manual', metrics);

    // 5. 处理任务（包含平衡分析和改进生成）
    const result = await processEvolutionTask(task.id);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || '分析失败' },
        { status: 500 }
      );
    }

    // 6. 获取更新后的任务详情
    const updatedTask = await prisma.skillEvolutionTask.findUnique({
      where: { id: task.id },
    });

    return NextResponse.json({
      success: true,
      taskId: task.id,
      skillId: id,
      skillName: skill.name,
      displayName: skill.displayName,
      improvement: null,
      stats: {
        falsePositiveCount: cases.totalFalsePositives,
        confirmedCount: cases.totalConfirmed,
        precisionBefore: metrics.precision,
      },
      analyzedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(LOG_MODULES.SKILL, '分析 Skill 失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '分析失败' },
      { status: 500 }
    );
  }
}
