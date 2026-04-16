// src/app/api/admin/skills-governance/high-frequency/route.ts
// Skills Governance - 高频重叠排行 API

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { getTopOverlapSkills, getFrequentOverlapPairs } from '@/services/skill-observation-stats';

// GET /api/admin/skills-governance/high-frequency - 获取高频重叠排行
export async function GET(request: Request) {
  try {
    // 1. 认证和权限检查
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    // 2. 解析查询参数
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20');

    // 3. 获取高频重叠 Skills
    const skills = await getTopOverlapSkills(limit);

    // 4. 获取高频重叠对
    const overlapPairs = await getFrequentOverlapPairs(limit);

    // 5. 组装响应
    const result = {
      skills: skills.map(s => ({
        id: s.id,
        skillId: s.skillId,
        skillName: s.skillName,
        skillDisplayName: s.skillDisplayName,
        skillCategory: s.skillCategory,
        totalObservations: s.totalObservations,
        warningCount: s.warningCount,
        matchCount: s.matchCount,
        overlapCount: s.overlapCount,
        matchRate: s.matchRate,
        warningRate: s.warningRate,
        avgMatchScore: s.avgMatchScore,
        firstObservedAt: s.firstObservedAt,
        lastObservedAt: s.lastObservedAt,
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
        firstObservedAt: p.firstObservedAt,
        lastObservedAt: p.lastObservedAt,
      })),
    };

    logger.access(LOG_MODULES.SKILL, auth.payload, 'skills_governance_high_frequency', { limit });

    return NextResponse.json({ data: result }, { status: 200 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取高频重叠排行失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}