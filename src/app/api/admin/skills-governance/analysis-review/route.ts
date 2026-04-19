// src/app/api/admin/skills-governance/analysis-review/route.ts
// Skills 分析结果审核 API

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/admin/skills-governance/analysis-review
 * 获取待审核的分析结果列表
 */
export async function GET(request: Request) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = (page - 1) * limit;

    // 构建查询条件
    const where: Record<string, unknown> = {
      analysisType: 'full_analysis',
    };
    if (status !== 'all') {
      where.reviewStatus = status;
    }

    // 查询分析结果
    const [analyses, total] = await Promise.all([
      prisma.skillAnalysis.findMany({
        where,
        include: {
          skill: {
            select: {
              id: true,
              name: true,
              displayName: true,
              techStackId: true,
              vulnerabilityPatternId: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.skillAnalysis.count({ where }),
    ]);

    // 获取关联的 Skill 信息
    const relatedSkillIds = analyses
      .map(a => a.relatedSkillId)
      .filter((id): id is string => !!id);

    const relatedSkills = await prisma.skill.findMany({
      where: { id: { in: relatedSkillIds } },
      select: {
        id: true,
        name: true,
        displayName: true,
        techStackId: true,
        vulnerabilityPatternId: true,
      },
    });

    const relatedSkillMap = new Map(relatedSkills.map(s => [s.id, s]));

    // 组装响应
    const results = analyses.map(analysis => ({
      id: analysis.id,
      skillA: analysis.skill,
      skillB: relatedSkillMap.get(analysis.relatedSkillId || '') || null,
      isDuplicate: analysis.isDuplicate,
      overlapType: analysis.overlapType,
      confidence: analysis.confidence,
      llmReason: analysis.llmReason,
      recommendation: analysis.recommendation,
      entryPointComparison: analysis.entryPointComparison 
        ? JSON.parse(analysis.entryPointComparison) 
        : null,
      reviewStatus: analysis.reviewStatus,
      reviewedBy: analysis.reviewedBy,
      reviewedAt: analysis.reviewedAt,
      reviewNotes: analysis.reviewNotes,
      createdAt: analysis.createdAt,
    }));

    return NextResponse.json({
      data: {
        analyses: results,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    }, { status: 200 });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取分析审核列表失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
