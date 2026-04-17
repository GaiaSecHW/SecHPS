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
 * DELETE /api/admin/skills-governance/full-analysis
 * 重置分析进度状态
 */
export async function DELETE(request: Request) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_UPDATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    const currentProgress = await getProgress();
    
    // 检查是否真的可以重置
    if (currentProgress.status === 'running') {
      const lastUpdate = currentProgress.updatedAt ? new Date(currentProgress.updatedAt) : null;
      const now = new Date();
      const secondsSinceUpdate = lastUpdate ? (now.getTime() - lastUpdate.getTime()) / 1000 : Infinity;
      
      // 如果 30 秒内有更新，说明任务还在跑，不能重置
      if (secondsSinceUpdate < 30) {
        return NextResponse.json({ 
          error: '分析任务正在运行中，无法重置',
          lastUpdate: lastUpdate?.toISOString(),
          secondsSinceUpdate: Math.round(secondsSinceUpdate),
        }, { status: 409 });
      }
    }

    // 重置进度为 idle
    await updateProgress({
      status: 'idle',
      startedAt: null,
      completedAt: null,
      current: 0,
      total: 0,
      error: null,
      results: { duplicates: 0, related: 0, distinct: 0 },
    });

    logger.info(LOG_MODULES.SKILL, '分析进度已重置');

    return NextResponse.json({
      data: { success: true, message: '进度已重置' }
    }, { status: 200 });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '重置进度失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: '重置失败' }, { status: 500 });
  }
}

/**
 * 分析进度状态键
 */
const ANALYSIS_PROGRESS_KEY = 'skill_full_analysis_progress';

/**
 * 进度状态接口
 */
interface AnalysisProgress {
  status: 'idle' | 'running' | 'completed' | 'error';
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;  // 最后更新时间
  current: number;
  total: number;
  error: string | null;
  results: {
    duplicates: number;
    related: number;
    distinct: number;
  };
}

/**
 * 获取分析进度
 */
async function getProgress(): Promise<AnalysisProgress> {
  const config = await prisma.systemConfig.findUnique({
    where: { key: ANALYSIS_PROGRESS_KEY },
  });
  
  if (!config) {
    return {
      status: 'idle',
      startedAt: null,
      completedAt: null,
      updatedAt: null,
      current: 0,
      total: 0,
      error: null,
      results: { duplicates: 0, related: 0, distinct: 0 },
    };
  }
  
  return JSON.parse(config.value);
}

/**
 * 更新分析进度
 */
async function updateProgress(progress: Partial<AnalysisProgress>): Promise<void> {
  const current = await getProgress();
  const updated = { ...current, ...progress, updatedAt: new Date().toISOString() };
  
  await prisma.systemConfig.upsert({
    where: { key: ANALYSIS_PROGRESS_KEY },
    create: {
      id: `config-${Date.now()}`,
      key: ANALYSIS_PROGRESS_KEY,
      value: JSON.stringify(updated),
      description: 'Skills 全量 LLM 分析进度',
      updatedAt: new Date(),
    },
    update: {
      value: JSON.stringify(updated),
      updatedAt: new Date(),
    },
  });
}

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
        techStackId: true,
        vulnerabilityPatternId: true,
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
          techStack: typeof skillA.techStack === 'string' ? JSON.parse(skillA.techStack || '[]') : [],
          cwe: skillA.cwe,
          content: skillA.content || undefined,
        };

        const skillBForSim: SkillForSimilarity = {
          id: skillB.id,
          name: skillB.name,
          displayName: skillB.displayName,
          description: skillB.description || '',
          category: skillB.category,
          techStack: typeof skillB.techStack === 'string' ? JSON.parse(skillB.techStack || '[]') : [],
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
              techStack: Array.isArray(skillA.techStack) ? skillA.techStack : (typeof skillA.techStack === 'string' ? JSON.parse(skillA.techStack || '[]') : []),
              cwe: skillA.cwe,
              content: skillA.content || undefined,
            },
            skillB: {
              id: skillB.id,
              name: skillB.name,
              displayName: skillB.displayName || skillB.name,
              description: skillB.description || '',
              category: skillB.category,
              techStack: Array.isArray(skillB.techStack) ? skillB.techStack : (typeof skillB.techStack === 'string' ? JSON.parse(skillB.techStack || '[]') : []),
              cwe: skillB.cwe,
              content: skillB.content || undefined,
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

    // USD to CNY 汇率（可配置）
    const USD_TO_CNY_RATE = 7.2;
    const estimatedCostUSD = filteredPairs.length * 0.001;
    const estimatedCostCNY = estimatedCostUSD * USD_TO_CNY_RATE;

    // 获取当前进度状态
    const progress = await getProgress();

    return NextResponse.json({
      data: {
        totalSkills: skills.length,
        totalPairs: pairs.length,
        filteredPairs: filteredPairs.length,
        estimatedTime: `${Math.ceil(filteredPairs.length * 2 / 60)} 分钟`, // 约 2 秒/对
        estimatedCost: `¥${estimatedCostCNY.toFixed(2)} (≈ $${estimatedCostUSD.toFixed(2)})`, // 人民币 + 美元
        estimatedCostUSD: estimatedCostUSD.toFixed(2),
        estimatedCostCNY: estimatedCostCNY.toFixed(2),
        // 添加进度状态
        progress,
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

    // 检查是否已有分析在进行
    const currentProgress = await getProgress();
    if (currentProgress.status === 'running') {
      return NextResponse.json({ 
        error: '已有分析任务在进行中，请等待完成',
        progress: currentProgress,
      }, { status: 409 });
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
        techStackId: true,
        vulnerabilityPatternId: true,
      },
    });

    logger.info(LOG_MODULES.SKILL, '开始全量 LLM 分析');

    // 清除现有的待分析数据，避免重复
    const deletedPending = await prisma.skillNewImpactAnalysis.deleteMany({
      where: { status: 'pending' },
    });
    logger.info(LOG_MODULES.SKILL, '清除待分析数据', { deletedCount: deletedPending.count });

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
          techStack: typeof skillA.techStack === 'string' ? JSON.parse(skillA.techStack || '[]') : [],
          cwe: skillA.cwe,
          content: skillA.content || undefined,
        };

        const skillBForSim: SkillForSimilarity = {
          id: skillB.id,
          name: skillB.name,
          displayName: skillB.displayName,
          description: skillB.description || '',
          category: skillB.category,
          techStack: typeof skillB.techStack === 'string' ? JSON.parse(skillB.techStack || '[]') : [],
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
              techStack: Array.isArray(skillA.techStack) ? skillA.techStack : (typeof skillA.techStack === 'string' ? JSON.parse(skillA.techStack || '[]') : []),
              cwe: skillA.cwe,
              content: skillA.content || undefined,
            },
            skillB: {
              id: skillB.id,
              name: skillB.name,
              displayName: skillB.displayName || skillB.name,
              description: skillB.description || '',
              category: skillB.category,
              techStack: Array.isArray(skillB.techStack) ? skillB.techStack : (typeof skillB.techStack === 'string' ? JSON.parse(skillB.techStack || '[]') : []),
              cwe: skillB.cwe,
              content: skillB.content || undefined,
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

    // 执行模式：初始化进度状态
    await updateProgress({
      status: 'running',
      startedAt: new Date().toISOString(),
      completedAt: null,
      current: 0,
      total: filteredPairs.length,
      error: null,
      results: { duplicates: 0, related: 0, distinct: 0 },
    });

    // 用于追踪进度的临时结果
    let tempResults: Array<{ analysis: { isDuplicate: boolean; overlapType: string } }> = [];

    // 进行 LLM 分析
    const results = await batchAnalyzeSkills(filteredPairs, {
      concurrency: 3,
      onProgress: async (current, total) => {
        logger.info(LOG_MODULES.SKILL, 'LLM 分析进度', { current, total });
        
        // 计算当前结果统计
        const duplicates = tempResults.filter(r => r.analysis.isDuplicate).length;
        const related = tempResults.filter(r => r.analysis.overlapType === 'related').length;
        const distinct = tempResults.filter(r => r.analysis.overlapType === 'distinct').length;
        
        // 更新进度
        await updateProgress({
          current,
          total,
          results: { duplicates, related, distinct },
        });
      },
      // 每完成一个分析后更新临时结果
      onResult: (result) => {
        tempResults.push(result);
      },
    });

    // 将结果保存到 SkillAnalysis 表
    let savedCount = 0;
    let duplicateGroupsCreated = 0;
    
    for (const result of results.results) {
      try {
        // 创建 SkillAnalysis 记录
        await prisma.skillAnalysis.create({
          data: {
            id: `analysis-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            skillId: result.skillA,
            relatedSkillId: result.skillB,
            analysisType: 'full_analysis',
            isDuplicate: result.analysis.isDuplicate,
            overlapType: result.analysis.overlapType,
            confidence: result.analysis.confidence,
            llmReason: result.analysis.reason,
            keyDifferences: result.analysis.keyDifferences 
              ? JSON.stringify(result.analysis.keyDifferences) 
              : null,
            recommendation: result.analysis.recommendation,
            reviewStatus: result.analysis.confidence >= 0.85 ? 'pending' : 'approved',
            analyzedBy: 'system',
          },
        });
        
        // 高置信度重复：自动创建重复组
        if (result.analysis.isDuplicate && result.analysis.confidence >= 0.85) {
          const existingGroup = await prisma.skillDuplicateGroup.findFirst({
            where: {
              members: {
                some: { skillId: result.skillA },
              },
            },
          });
          
          if (!existingGroup) {
            // 获取技能信息
            const skillA = await prisma.skill.findUnique({
              where: { id: result.skillA },
              select: { techStackId: true, vulnerabilityPatternId: true },
            });
            
            const groupId = `group-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            
            await prisma.skillDuplicateGroup.create({
              data: {
                id: groupId,
                language: skillA?.techStackId || 'unknown',
                vulnerabilityType: skillA?.vulnerabilityPatternId || 'unknown',
                status: 'pending_review',
                skillCount: 2,
                members: {
                  create: [
                    { skillId: result.skillA, role: 'primary', similarityScore: 1.0 },
                    { skillId: result.skillB, role: 'member', similarityScore: result.analysis.confidence },
                  ],
                },
              },
            });
            duplicateGroupsCreated++;
          }
        }
        
        savedCount++;
      } catch (e) {
        // 忽略重复等错误
      }
    }

    logger.info(LOG_MODULES.SKILL, '全量 LLM 分析完成');

    // 更新进度为完成
    await updateProgress({
      status: 'completed',
      completedAt: new Date().toISOString(),
      current: results.total,
      total: results.total,
      results: {
        duplicates: results.duplicates,
        related: results.related,
        distinct: results.distinct,
      },
    });

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
        duplicateGroupsCreated,
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
    
    // 更新进度为错误
    await updateProgress({
      status: 'error',
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
    
    return NextResponse.json({ 
      error: '服务器内部错误',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
