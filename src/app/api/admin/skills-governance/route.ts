// src/app/api/admin/skills-governance/route.ts
// Skills Governance - 观测模块 API 主路由

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { getStatsSummary, getTopOverlapSkills, getFrequentOverlapPairs } from '@/services/skill-observation-stats';
import { prisma } from '@/lib/prisma';

// GET /api/admin/skills-governance - 观测模块总览
export async function GET(request: Request) {
  try {
    // 1. 认证和权限检查
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    // 2. 获取统计摘要
    const statsSummary = await getStatsSummary();

    // 3. 获取高频重叠 Skills（前5个）
    const topOverlapSkills = await getTopOverlapSkills(5);

    // 4. 获取高频重叠对（前5个）
    const overlapPairs = await getFrequentOverlapPairs(5);

    // 5. 获取待处理的影响分析数量
    const pendingImpactCount = await prisma.skillNewImpactAnalysis.count({
      where: { status: 'pending' },
    });

    // 6. 获取待处理的合并记录数量
    const pendingMergeCount = await prisma.skillMergeRecord.count({
      where: { status: 'pending' },
    });

    // 7. 组装响应
    const overview = {
      stats: statsSummary,
      topOverlapSkills: topOverlapSkills.map(s => ({
        skillId: s.skillId,
        skillName: s.skillName,
        skillDisplayName: s.skillDisplayName,
        skillCategory: s.skillCategory,
        overlapCount: s.overlapCount,
        warningCount: s.warningCount,
        riskLevel: s.riskLevel,
      })),
      overlapPairs: overlapPairs.map(p => ({
        skillId1: p.skillId1,
        skillName1: p.skillName1,
        skillId2: p.skillId2,
        skillName2: p.skillName2,
        overlapCount: p.overlapCount,
        overlapScore: p.overlapScore,
        overlapType: p.overlapType,
      })),
      pendingItems: {
        impactAnalysis: pendingImpactCount,
        mergeRecords: pendingMergeCount,
      },
    };

    logger.access(LOG_MODULES.SKILL, auth.payload, 'skills_governance_overview', {});

    return NextResponse.json({ data: overview }, { status: 200 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取 Skills Governance 总览失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}