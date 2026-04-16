// src/app/api/admin/skills-governance/merge-candidates/route.ts
// Skills Governance - 合并候选 API

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getFrequentOverlapPairs } from '@/services/skill-observation-stats';
import type { SimilarSkill } from '@/services/skill-similarity';

// 合并候选类型
interface MergeCandidate {
  skillId: string;
  skillName: string;
  skillDisplayName: string;
  skillCategory: string;
  similarSkills: SimilarSkill[];
  overlapScore: number;
  recommendation: string;
}

// GET /api/admin/skills-governance/merge-candidates - 获取合并候选列表
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
    const minOverlapScore = parseFloat(searchParams.get('minOverlapScore') || '0.75');

    // 3. 获取高频重叠对
    const overlapPairs = await getFrequentOverlapPairs(100);

    // 4. 筛选高重叠分数的对
    const highOverlapPairs = overlapPairs.filter(p => p.overlapScore >= minOverlapScore);

    // 5. 获取相关 Skill 信息
    const allSkillIds = new Set<string>();
    for (const pair of highOverlapPairs) {
      allSkillIds.add(pair.skillId1);
      allSkillIds.add(pair.skillId2);
    }

    const skills = await prisma.skill.findMany({
      where: { id: { in: Array.from(allSkillIds) } },
      select: {
        id: true,
        name: true,
        displayName: true,
        category: true,
        userId: true,
      },
    });

    const skillMap = new Map(skills.map(s => [s.id, s]));

    // 6. 构建合并候选列表
    const candidates: MergeCandidate[] = [];

    // 按重叠对构建候选
    for (const pair of highOverlapPairs.slice(0, limit)) {
      const skill1 = skillMap.get(pair.skillId1);
      const skill2 = skillMap.get(pair.skillId2);

      if (!skill1 || !skill2) continue;

      // 确定推荐类型
      let recommendation = 'manual-review';
      if (pair.overlapScore >= 0.9 && pair.overlapType.includes('exact')) {
        recommendation = 'merge';
      } else if (pair.overlapScore >= 0.85 && pair.overlapType.includes('semantic')) {
        recommendation = 'merge';
      } else if (pair.overlapType.includes('techStack')) {
        recommendation = 'techStack-split';
      }

      // 构建 SimilarSkill 结构
      const similarSkills: SimilarSkill[] = [
        {
          skillId: pair.skillId2,
          skillName: pair.skillName2,
          displayName: skill2.displayName || skill2.name,
          category: skill2.category || 'Unknown',
          techStack: [], // 从 overlap pairs 无法获取技术栈信息
          similarity: pair.overlapScore,
          overlapType: pair.overlapType.split(',')[0] as SimilarSkill['overlapType'],
          overlapScore: pair.overlapScore,
          keywordScore: pair.overlapScore * 0.7,
          reason: `高频重叠（${pair.overlapCount}次共同出现）`,
        },
      ];

      candidates.push({
        skillId: pair.skillId1,
        skillName: pair.skillName1,
        skillDisplayName: skill1.displayName || skill1.name,
        skillCategory: skill1.category || 'Unknown',
        similarSkills,
        overlapScore: pair.overlapScore,
        recommendation,
      });
    }

    // 7. 查询待处理的合并记录
    const pendingMergeRecords = await prisma.skillMergeRecord.findMany({
      where: { status: 'pending' },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    // 8. 获取合并记录相关的 Skill 信息
    const mergeSkillIds = new Set<string>();
    for (const record of pendingMergeRecords) {
      mergeSkillIds.add(record.sourceSkillId);
      mergeSkillIds.add(record.targetSkillId);
    }

    const mergeSkills = await prisma.skill.findMany({
      where: { id: { in: Array.from(mergeSkillIds) } },
      select: { id: true, name: true, displayName: true, category: true },
    });

    const mergeSkillMap = new Map(mergeSkills.map(s => [s.id, s]));

    // 9. 组装响应
    const result = {
      candidates: candidates.slice(0, limit),
      pendingMergeRecords: pendingMergeRecords.map(r => ({
        id: r.id,
        sourceSkillId: r.sourceSkillId,
        sourceSkillName: mergeSkillMap.get(r.sourceSkillId)?.name || 'Unknown',
        sourceSkillDisplayName: mergeSkillMap.get(r.sourceSkillId)?.displayName || 'Unknown',
        targetSkillId: r.targetSkillId,
        targetSkillName: mergeSkillMap.get(r.targetSkillId)?.name || 'Unknown',
        targetSkillDisplayName: mergeSkillMap.get(r.targetSkillId)?.displayName || 'Unknown',
        mergeReason: r.mergeReason,
        mergeDetails: r.mergeDetails ? JSON.parse(r.mergeDetails) : null,
        status: r.status,
        sourceOwnerConsent: r.sourceOwnerConsent,
        targetOwnerConsent: r.targetOwnerConsent,
        createdAt: r.createdAt,
      })),
      summary: {
        totalCandidates: candidates.length,
        mergeRecommendations: candidates.filter(c => c.recommendation === 'merge').length,
        techStackSplitRecommendations: candidates.filter(c => c.recommendation === 'techStack-split').length,
        manualReviewRecommendations: candidates.filter(c => c.recommendation === 'manual-review').length,
        pendingMergeRecords: pendingMergeRecords.length,
      },
    };

    logger.access(LOG_MODULES.SKILL, auth.payload, 'skills_governance_merge_candidates', { limit, minOverlapScore });

    return NextResponse.json({ data: result }, { status: 200 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取合并候选列表失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}