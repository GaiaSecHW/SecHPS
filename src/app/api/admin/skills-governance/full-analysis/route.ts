// src/app/api/admin/skills-governance/full-analysis/route.ts
// Skills Governance - 全量 LLM 分析 API

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { 
  batchAnalyzeSkills, 
  filterPairsForLLMAnalysis,
  type SkillForLLMAnalysis 
} from '@/services/skill-llm-analysis';
import { computeKeywordSimilarity, computeCategorySimilarity, type SkillForSimilarity } from '@/services/skill-similarity';

/**
 * GET /api/admin/skills-governance/full-analysis
 * 获取全量分析状态和预估信息
 */
export async function GET(request: Request) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    // 获取所有最新版本的 Skills
    const skills = await prisma.skill.findMany({
      where: { isLatest: true },
      select: {
        id: true,
        name: true,
        displayName: true,
        description: true,
        category: true,
        cwe: true,
        techStack: true,
        content: true,
        triggers: true,
      },
    });

    // 计算需要分析的技能对数量（预筛选）
    const pairs: Array<{ 
      skillA: SkillForLLMAnalysis; 
      skillB: SkillForLLMAnalysis;
      preliminarySimilarity: number;
    }> = [];

    for (let i = 0; i < skills.length; i++) {
      for (let j = i + 1; j < skills.length; j++) {
        const skillA = skills[i];
        const skillB = skills[j];

        // 快速预筛选：同类别才考虑
        if (skillA.category !== skillB.category) continue;

        // 计算预相似度
        const skillAForSim: SkillForSimilarity = {
          id: skillA.id,
          name: skillA.name,
          displayName: skillA.displayName,
          description: skillA.description || '',
          category: skillA.category,
          techStack: Array.isArray(skillA.techStack) ? skillA.techStack : [],
          cwe: skillA.cwe,
          content: skillA.content || undefined,
        };

        const skillBForSim: SkillForSimilarity = {
          id: skillB.id,
          name: skillB.name,
          displayName: skillB.displayName,
          description: skillB.description || '',
          category: skillB.category,
          techStack: Array.isArray(skillB.techStack) ? skillB.techStack : [],
          cwe: skillB.cwe,
          content: skillB.content || undefined,
        };

        const keywordResult = computeKeywordSimilarity(skillAForSim, skillBForSim);
        const categoryResult = computeCategorySimilarity(skillAForSim, skillBForSim);
        const preliminarySimilarity = keywordResult.score * 0.4 + categoryResult.overlapScore * 0.35;

        // 全量分析：只要同类别且预相似度 >= 0.2 就保留，让 LLM 来判断
        if (preliminarySimilarity >= 0.2) {
          pairs.push({
            skillA: {
              id: skillA.id,
              name: skillA.name,
              displayName: skillA.displayName || skillA.name,
              description: skillA.description || '',
              category: skillA.category,
              techStack: Array.isArray(skillA.techStack) ? skillA.techStack : [],
              cwe: skillA.cwe,
              content: skillA.content || undefined,
              triggers: Array.isArray(skillA.triggers) ? skillA.triggers : [],
            },
            skillB: {
              id: skillB.id,
              name: skillB.name,
              displayName: skillB.displayName || skillB.name,
              description: skillB.description || '',
              category: skillB.category,
              techStack: Array.isArray(skillB.techStack) ? skillB.techStack : [],
              cwe: skillB.cwe,
              content: skillB.content || undefined,
              triggers: Array.isArray(skillB.triggers) ? skillB.triggers : [],
            },
            preliminarySimilarity,
          });
        }
      }
    }

    // 过滤：同类别 + 预相似度达标即可
    const filteredPairs = filterPairsForLLMAnalysis(pairs, {
      minPreliminarySimilarity: 0.2,
      skipDifferentCategory: true,
    });

    return NextResponse.json({
      data: {
        totalSkills: skills.length,
        totalPairs: pairs.length,
        filteredPairs: filteredPairs.length,
        estimatedTime: `${Math.ceil(filteredPairs.length * 2 / 60)} 分钟`, // 约 2 秒/对
        estimatedCost: `${(filteredPairs.length * 0.001).toFixed(2)} USD`, // 预估成本
      }
    }, { status: 200 });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取全量分析预览失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * POST /api/admin/skills-governance/full-analysis
 * 执行全量 LLM 分析
 * 
 * Body:
 * - mode: 'preview' | 'execute' - 预览或执行
 * - limit: number - 限制分析数量（可选）
 * - skipConfirmed: boolean - 跳过已确认的（可选）
 */
export async function POST(request: Request) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_UPDATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    const body = await request.json();
    const { mode = 'execute', limit, skipConfirmed = true } = body;

    // 获取所有最新版本的 Skills
    const skills = await prisma.skill.findMany({
      where: { isLatest: true },
      select: {
        id: true,
        name: true,
        displayName: true,
        description: true,
        category: true,
        cwe: true,
        techStack: true,
        content: true,
        triggers: true,
      },
    });

    logger.info(LOG_MODULES.SKILL, '开始全量 LLM 分析');

    // 构建需要分析的技能对
    const pairs: Array<{ 
      skillA: SkillForLLMAnalysis; 
      skillB: SkillForLLMAnalysis;
      preliminarySimilarity: number;
    }> = [];

    for (let i = 0; i < skills.length; i++) {
      for (let j = i + 1; j < skills.length; j++) {
        const skillA = skills[i];
        const skillB = skills[j];

        // 快速预筛选：同类别才考虑
        if (skillA.category !== skillB.category) continue;

        // 如果跳过已确认的，检查是否已存在合并记录
        if (skipConfirmed) {
          const existingMerge = await prisma.skillMergeRecord.findFirst({
            where: {
              OR: [
                { sourceSkillId: skillA.id, targetSkillId: skillB.id },
                { sourceSkillId: skillB.id, targetSkillId: skillA.id },
              ],
              status: { in: ['completed', 'rejected'] },
            },
          });
          if (existingMerge) continue;
        }

        // 计算预相似度
        const skillAForSim: SkillForSimilarity = {
          id: skillA.id,
          name: skillA.name,
          displayName: skillA.displayName,
          description: skillA.description || '',
          category: skillA.category,
          techStack: Array.isArray(skillA.techStack) ? skillA.techStack : [],
          cwe: skillA.cwe,
          content: skillA.content || undefined,
        };

        const skillBForSim: SkillForSimilarity = {
          id: skillB.id,
          name: skillB.name,
          displayName: skillB.displayName,
          description: skillB.description || '',
          category: skillB.category,
          techStack: Array.isArray(skillB.techStack) ? skillB.techStack : [],
          cwe: skillB.cwe,
          content: skillB.content || undefined,
        };

        const keywordResult = computeKeywordSimilarity(skillAForSim, skillBForSim);
        const categoryResult = computeCategorySimilarity(skillAForSim, skillBForSim);
        const preliminarySimilarity = keywordResult.score * 0.4 + categoryResult.overlapScore * 0.35;

        // 全量分析：只要同类别且预相似度 >= 0.2 就保留
        if (preliminarySimilarity >= 0.2) {
          pairs.push({
            skillA: {
              id: skillA.id,
              name: skillA.name,
              displayName: skillA.displayName || skillA.name,
              description: skillA.description || '',
              category: skillA.category,
              techStack: Array.isArray(skillA.techStack) ? skillA.techStack : [],
              cwe: skillA.cwe,
              content: skillA.content || undefined,
              triggers: Array.isArray(skillA.triggers) ? skillA.triggers : [],
            },
            skillB: {
              id: skillB.id,
              name: skillB.name,
              displayName: skillB.displayName || skillB.name,
              description: skillB.description || '',
              category: skillB.category,
              techStack: Array.isArray(skillB.techStack) ? skillB.techStack : [],
              cwe: skillB.cwe,
              content: skillB.content || undefined,
              triggers: Array.isArray(skillB.triggers) ? skillB.triggers : [],
            },
            preliminarySimilarity,
          });
        }
      }
    }

    // 过滤：同类别 + 预相似度 >= 0.2
    let filteredPairs = filterPairsForLLMAnalysis(pairs, {
      minPreliminarySimilarity: 0.2,
      skipDifferentCategory: true,
    });

    // 应用限制
    if (limit && limit > 0) {
      filteredPairs = filteredPairs.slice(0, limit);
    }

    // 预览模式：只返回信息，不执行
    if (mode === 'preview') {
      return NextResponse.json({
        data: {
          mode: 'preview',
          totalSkills: skills.length,
          totalPairs: pairs.length,
          filteredPairs: filteredPairs.length,
          pairs: filteredPairs.slice(0, 20).map(p => ({
            skillA: { id: p.skillA.id, name: p.skillA.name, displayName: p.skillA.displayName },
            skillB: { id: p.skillB.id, name: p.skillB.name, displayName: p.skillB.displayName },
            preliminarySimilarity: p.preliminarySimilarity,
          })),
        }
      }, { status: 200 });
    }

    // 执行模式：进行 LLM 分析
    const results = await batchAnalyzeSkills(filteredPairs, {
      concurrency: 3,
      onProgress: (current, total) => {
        logger.info(LOG_MODULES.SKILL, 'LLM 分析进度');
      },
    });

    // 将结果保存到数据库
    let savedCount = 0;
    for (const result of results.results) {
      // 查找或创建 SkillNewImpactAnalysis
      try {
        const existing = await prisma.skillNewImpactAnalysis.findFirst({
          where: {
            skillId: result.skillA,
            status: 'pending',
          },
        });

        if (existing) {
          await prisma.skillNewImpactAnalysis.update({
            where: { id: existing.id },
            data: {
              similarSkills: JSON.stringify([{
                skillId: result.skillB,
                similarity: result.analysis.confidence,
                overlapType: result.analysis.overlapType,
                reason: result.analysis.reason,
              }]),
              overlapScore: result.analysis.confidence,
              recommendation: result.analysis.recommendation,
              recommendationReason: result.analysis.reason,
              analyzedAt: new Date(),
              updatedAt: new Date(),
            },
          });
        } else {
          await prisma.skillNewImpactAnalysis.create({
            data: {
              id: `llm-analysis-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
              skillId: result.skillA,
              similarSkills: JSON.stringify([{
                skillId: result.skillB,
                similarity: result.analysis.confidence,
                overlapType: result.analysis.overlapType,
                reason: result.analysis.reason,
              }]),
              overlapScore: result.analysis.confidence,
              affectedWorkflows: null,
              recommendation: result.analysis.recommendation,
              recommendationReason: result.analysis.reason,
              status: 'pending',
              analyzedAt: new Date(),
              updatedAt: new Date(),
            },
          });
        }
        savedCount++;
      } catch (e) {
        // 忽略重复等错误
      }
    }

    logger.info(LOG_MODULES.SKILL, '全量 LLM 分析完成');

    return NextResponse.json({
      data: {
        success: true,
        summary: {
          total: results.total,
          duplicates: results.duplicates,
          related: results.related,
          distinct: results.distinct,
        },
        savedToDb: savedCount,
        results: results.results.slice(0, 50).map(r => ({
          skillA: r.skillA,
          skillB: r.skillB,
          isDuplicate: r.analysis.isDuplicate,
          overlapType: r.analysis.overlapType,
          confidence: r.analysis.confidence,
          recommendation: r.analysis.recommendation,
          reason: r.analysis.reason,
          keyDifferences: r.analysis.keyDifferences,
        })),
      }
    }, { status: 200 });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '全量 LLM 分析失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ 
      error: '服务器内部错误',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
