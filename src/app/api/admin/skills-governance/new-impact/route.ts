// src/app/api/admin/skills-governance/new-impact/route.ts
// Skills Governance - 新增 Skill 影响分析 API

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';

// GET /api/admin/skills-governance/new-impact - 获取新增 Skill 影响分析列表
export async function GET(request: Request) {
  try {
    // 1. 认证和权限检查
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    // 2. 解析查询参数
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status') || undefined;
    const skillId = searchParams.get('skillId') || undefined;
    const minOverlapScore = searchParams.get('minOverlapScore') ? parseFloat(searchParams.get('minOverlapScore')!) : undefined;

    const { skip, take, page: pageNum, limit: pageLimit } = getOffsetPagination({ page, limit });

    // 3. 构建查询条件
    const where: Record<string, unknown> = {};

    if (status) {
      where.status = status;
    }

    if (skillId) {
      where.skillId = skillId;
    }

    if (minOverlapScore) {
      where.overlapScore = { gte: minOverlapScore };
    }

    // 4. 查询总数和数据
    const [total, analyses] = await Promise.all([
      prisma.skillNewImpactAnalysis.count({ where }),
      prisma.skillNewImpactAnalysis.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          Skill: {
            select: {
              id: true,
              name: true,
              displayName: true,
              vulnerabilityPatternId: true,
            },
          },
        },
      }),
    ]);

    // 5. 组装响应数据
    const analysesWithSkill = analyses.map(a => ({
      id: a.id,
      skillId: a.skillId,
      skillName: a.Skill?.name || 'Unknown',
      skillDisplayName: a.Skill?.displayName || 'Unknown',
      skillCategory: a.Skill?.vulnerabilityPatternId || 'Unknown',
      similarSkills: a.similarSkills ? JSON.parse(a.similarSkills) : null,
      overlapScore: a.overlapScore,
      affectedWorkflows: a.affectedWorkflows ? JSON.parse(a.affectedWorkflows) : null,
      recommendation: a.recommendation,
      recommendationReason: a.recommendationReason,
      status: a.status,
      analyzedAt: a.analyzedAt,
      actionedAt: a.actionedAt,
      createdBy: a.createdBy,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }));

    logger.access(LOG_MODULES.SKILL, auth.payload, 'skills_governance_new_impact', { page, limit, status });

    return NextResponse.json(createPaginatedResponse(analysesWithSkill, total, pageNum, pageLimit));
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取新增 Skill 影响分析失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}