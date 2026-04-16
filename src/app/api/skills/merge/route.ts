// src/app/api/skills/merge/route.ts
/**
 * Skill 合并 API
 * 
 * POST: 执行合并操作
 * GET: 获取合并候选（高频重叠对）
 * 
 * 权限检查: SKILL_UPDATE
 */

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { AuditLogger } from '@/lib/audit/logger';
import {
  executeSkillMerge,
  checkMergeCompatibility,
  type MergeStrategy,
  type MergeOptions,
  type MergeResult,
} from '@/services/skill-merge';
import { getFrequentOverlapPairs } from '@/services/skill-observation-stats';
import { prisma } from '@/lib/prisma';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';

/**
 * POST /api/skills/merge
 * 执行 Skill 合并操作
 * 
 * Request body:
 * {
 *   strategy: 'content-merge' | 'replace' | 'techStack-split',
 *   targetSkillId: string,
 *   sourceSkillIds: string[],
 *   mergeReason: string,
 *   newSkillName?: string,
 *   newSkillDisplayName?: string
 * }
 * 
 * Response:
 * {
 *   success: boolean,
 *   mergedSkill?: Skill,
 *   deprecatedSkills?: Skill[],
 *   updatedSkills?: Skill[],
 *   mergeRecord?: SkillMergeRecord,
 *   error?: string
 * }
 */
export async function POST(request: Request) {
  try {
    // 1. 认证和权限检查
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_UPDATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    // 2. 解析请求体
    const body = await request.json();
    const {
      strategy,
      targetSkillId,
      sourceSkillIds,
      mergeReason,
      newSkillName,
      newSkillDisplayName,
    } = body;

    // 3. 验证必填字段
    if (!strategy) {
      return NextResponse.json(
        { success: false, error: '缺少合并策略 (strategy)' },
        { status: 400 }
      );
    }

    if (!targetSkillId) {
      return NextResponse.json(
        { success: false, error: '缺少目标 Skill ID (targetSkillId)' },
        { status: 400 }
      );
    }

    if (!sourceSkillIds || !Array.isArray(sourceSkillIds) || sourceSkillIds.length === 0) {
      return NextResponse.json(
        { success: false, error: '缺少源 Skill IDs (sourceSkillIds)' },
        { status: 400 }
      );
    }

    if (!mergeReason) {
      return NextResponse.json(
        { success: false, error: '缺少合并原因 (mergeReason)' },
        { status: 400 }
      );
    }

    // 4. 验证策略类型
    const validStrategies: MergeStrategy[] = ['content-merge', 'replace', 'techStack-split'];
    if (!validStrategies.includes(strategy)) {
      return NextResponse.json(
        { success: false, error: `无效的合并策略: ${strategy}。有效策略: ${validStrategies.join(', ')}` },
        { status: 400 }
      );
    }

    // 5. 检查合并兼容性（预检）
    const compatibility = await checkMergeCompatibility(targetSkillId, sourceSkillIds);
    
    if (!compatibility.compatible) {
      return NextResponse.json(
        {
          success: false,
          error: '合并兼容性检查失败',
          details: {
            issues: compatibility.issues,
            warnings: compatibility.warnings,
          },
        },
        { status: 400 }
      );
    }

    // 6. 执行合并
    const mergeOptions: MergeOptions = {
      strategy,
      targetSkillId,
      sourceSkillIds,
      mergeReason,
      userId: payload.userId,
      newSkillName,
      newSkillDisplayName,
    };

    const result: MergeResult = await executeSkillMerge(mergeOptions);

    // 7. 处理结果
    if (!result.success) {
      logger.errorWithUser(
        LOG_MODULES.SKILL,
        payload,
        'Skill 合并执行失败',
        targetSkillId,
        { details: { error: result.error, strategy, sourceSkillIds } }
      );
      
      return NextResponse.json(
        { success: false, error: result.error || '合并执行失败' },
        { status: 500 }
      );
    }

    // 8. 记录审计日志
    AuditLogger.log({
      userId: payload.userId,
      action: 'skill_merge' as any,
      resource: result.mergedSkill?.id || targetSkillId,
      details: {
        strategy,
        targetSkillId,
        sourceSkillIds,
        mergeReason,
        mergedSkillId: result.mergedSkill?.id,
        deprecatedSkillIds: result.deprecatedSkills?.map(s => s.id),
      },
    }).catch(err => {
      logger.errorWithUser(
        LOG_MODULES.SKILL,
        payload,
        '记录审计日志失败',
        targetSkillId,
        { details: { error: err instanceof Error ? err.message : String(err) } }
      );
    });

    // 9. 返回成功结果
    logger.create(
      LOG_MODULES.SKILL,
      payload,
      result.mergedSkill?.id || targetSkillId,
      { strategy, deprecatedCount: result.deprecatedSkills?.length || 0 }
    );

    return NextResponse.json({
      success: true,
      mergedSkill: result.mergedSkill,
      deprecatedSkills: result.deprecatedSkills,
      updatedSkills: result.updatedSkills,
      mergeRecord: result.mergeRecord,
      warnings: compatibility.warnings.length > 0 ? compatibility.warnings : undefined,
    }, { status: 200 });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, 'Skill 合并 API 错误', {
      details: { error: error instanceof Error ? error.message : String(error) }
    });
    return NextResponse.json(
      { success: false, error: '服务器内部错误' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/skills/merge
 * 获取合并候选（高频重叠对）
 * 
 * Query params:
 * - limit: 返回数量限制（默认20）
 * - minOverlapScore: 最小重叠分数（默认0.75）
 * - page: 页码（默认1）
 * 
 * Response:
 * {
 *   candidates: {
 *     skillId: string,
 *     skillName: string,
 *     similarSkills: SimilarSkill[],
 *     overlapScore: number
 *   }[],
 *   pendingMergeRecords: SkillMergeRecord[],
 *   summary: {
 *     totalCandidates: number,
 *     pendingCount: number,
 *     highOverlapCount: number
 *   }
 * }
 */
export async function GET(request: Request) {
  try {
    // 1. 认证和权限检查
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    // 2. 解析查询参数
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20');
    const minOverlapScore = parseFloat(searchParams.get('minOverlapScore') || '0.75');
    const page = parseInt(searchParams.get('page') || '1');

    const { skip, take } = getOffsetPagination({ page, limit });

    // 3. 获取高频重叠对
    const overlapPairs = await getFrequentOverlapPairs(limit * 2); // 获取更多用于筛选

    // 4. 筛选符合条件的重叠对
    const filteredPairs = overlapPairs.filter(pair => pair.overlapScore >= minOverlapScore);

    // 5. 构建 Skill 信息 Map
    const skillIds = new Set<string>();
    filteredPairs.forEach(pair => {
      skillIds.add(pair.skillId1);
      skillIds.add(pair.skillId2);
    });

    const skills = await prisma.skill.findMany({
      where: {
        id: { in: Array.from(skillIds) },
        isLatest: true,
      },
      select: {
        id: true,
        name: true,
        displayName: true,
        category: true,
        techStack: true,
      },
    });

    const skillMap = new Map(skills.map(s => [s.id, s]));

    // 6. 构建合并候选列表
    const candidates: Array<{
      skillId: string;
      skillName: string;
      skillDisplayName: string;
      category: string;
      techStack: string[];
      similarSkills: Array<{
        skillId: string;
        skillName: string;
        skillDisplayName: string;
        overlapScore: number;
        overlapType: string;
      }>;
      overlapScore: number;
      recommendation: 'merge' | 'techStack-split' | 'manual-review';
    }> = [];

    // 按技能分组重叠对
    const skillOverlapMap = new Map<string, Array<{
      otherSkillId: string;
      overlapScore: number;
      overlapType: string;
    }>>();

    filteredPairs.forEach(pair => {
      // 为 skillId1 添加 skillId2
      if (!skillOverlapMap.has(pair.skillId1)) {
        skillOverlapMap.set(pair.skillId1, []);
      }
      skillOverlapMap.get(pair.skillId1)!.push({
        otherSkillId: pair.skillId2,
        overlapScore: pair.overlapScore,
        overlapType: pair.overlapType,
      });

      // 为 skillId2 添加 skillId1
      if (!skillOverlapMap.has(pair.skillId2)) {
        skillOverlapMap.set(pair.skillId2, []);
      }
      skillOverlapMap.get(pair.skillId2)!.push({
        otherSkillId: pair.skillId1,
        overlapScore: pair.overlapScore,
        overlapType: pair.overlapType,
      });
    });

    // 构建候选列表
    skillOverlapMap.forEach((overlaps, skillId) => {
      const skill = skillMap.get(skillId);
      if (!skill) return;

      // 计算平均重叠分数
      const avgOverlapScore = overlaps.reduce((sum, o) => sum + o.overlapScore, 0) / overlaps.length;

      // 构建相似技能列表
      const similarSkills = overlaps.map(o => {
        const otherSkill = skillMap.get(o.otherSkillId);
        return {
          skillId: o.otherSkillId,
          skillName: otherSkill?.name || 'Unknown',
          skillDisplayName: otherSkill?.displayName || 'Unknown',
          overlapScore: o.overlapScore,
          overlapType: o.overlapType,
        };
      });

      // 推断推荐操作
      let recommendation: 'merge' | 'techStack-split' | 'manual-review' = 'manual-review';
      
      if (avgOverlapScore >= 0.85) {
        recommendation = 'merge';
      } else if (overlaps.some(o => o.overlapType === 'techStack-overlap')) {
        recommendation = 'techStack-split';
      }

      candidates.push({
        skillId,
        skillName: skill.name,
        skillDisplayName: skill.displayName,
        category: skill.category,
        techStack: skill.techStack ? JSON.parse(skill.techStack) : [],
        similarSkills,
        overlapScore: avgOverlapScore,
        recommendation,
      });
    });

    // 7. 按重叠分数排序并分页
    candidates.sort((a, b) => b.overlapScore - a.overlapScore);
    const paginatedCandidates = candidates.slice(skip, skip + take);

    // 8. 获取待处理的合并记录
    const pendingMergeRecords = await prisma.skillMergeRecord.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // 9. 构建摘要
    const summary = {
      totalCandidates: candidates.length,
      pendingCount: pendingMergeRecords.length,
      highOverlapCount: candidates.filter(c => c.overlapScore >= 0.85).length,
    };

    // 10. 记录访问日志
    logger.access(
      LOG_MODULES.SKILL,
      payload,
      'GET /api/skills/merge',
      { limit, minOverlapScore, candidatesCount: paginatedCandidates.length }
    );

    return NextResponse.json({
      candidates: paginatedCandidates,
      pendingMergeRecords,
      summary,
      pagination: {
        page,
        limit,
        total: candidates.length,
        totalPages: Math.ceil(candidates.length / limit),
      },
    }, { status: 200 });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取合并候选错误', {
      details: { error: error instanceof Error ? error.message : String(error) }
    });
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}