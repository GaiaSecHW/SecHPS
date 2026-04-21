// src/app/api/skills/[id]/evolve/route.ts
// POST - 应用改进建议进化技能

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { applyImprovement, rejectImprovement } from '@/services/skill-evolution/version-creator';
import { getImprovementDetail } from '@/services/skill-evolution/improvement-generator';
import { prisma } from '@/lib/prisma';

interface EvolveRequest {
  improvementId: string;
  action: 'apply' | 'reject';
  reason?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }

  const { id } = await params;
  const body: EvolveRequest = await request.json();
  const { improvementId, action, reason } = body;

  if (!improvementId) {
    return NextResponse.json(
      { error: '缺少 improvementId 参数' },
      { status: 400 }
    );
  }

  if (!action || !['apply', 'reject'].includes(action)) {
    return NextResponse.json(
      { error: '无效的 action 参数，必须是 apply 或 reject' },
      { status: 400 }
    );
  }

  try {
    // 验证 improvement 属于该 skill
    const improvement = await getImprovementDetail(improvementId);
    if (!improvement) {
      return NextResponse.json(
        { error: '改进记录不存在' },
        { status: 404 }
      );
    }

    if (improvement.skillId !== id) {
      return NextResponse.json(
        { error: '改进记录不属于该 Skill' },
        { status: 400 }
      );
    }

    if (improvement.status !== 'pending') {
      return NextResponse.json(
        { error: `改进记录状态为 ${improvement.status}，无法操作` },
        { status: 400 }
      );
    }

    // 从 auth 中获取用户 ID
    const userId = (auth as any).userId || 'system';

    if (action === 'apply') {
      // 应用改进
      const result = await applyImprovement(
        improvementId,
        userId,
        reason || '通过 API 应用改进'
      );

      // 更新进化任务状态
      await prisma.skillEvolutionTask.updateMany({
        where: { improvementId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          newVersionId: result.newSkillId,
        },
      });

      return NextResponse.json({
        success: true,
        skillId: id,
        previousVersion: result.oldVersion,
        newVersion: result.newVersion,
        newSkillId: result.newSkillId,
        evolutionId: result.evolutionId,
        status: 'completed',
        appliedAt: new Date().toISOString(),
        message: '技能进化完成，新版本已创建',
      });
    } else {
      // 拒绝改进
      const result = await rejectImprovement(
        improvementId,
        userId,
        reason || '通过 API 拒绝改进'
      );

      // 更新进化任务状态
      await prisma.skillEvolutionTask.updateMany({
        where: { improvementId },
        data: {
          status: 'rejected',
          completedAt: new Date(),
        },
      });

      return NextResponse.json({
        success: true,
        skillId: id,
        improvementId: result.improvementId,
        status: 'rejected',
        reason: result.reason,
        rejectedAt: new Date().toISOString(),
        message: '改进建议已拒绝',
      });
    }
  } catch (error) {
    console.error('[API] 进化 Skill 失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '进化操作失败' },
      { status: 500 }
    );
  }
}
