/**
 * Skill Governance Service
 * 统一治理服务：快速重复检测 + 异步分析队列 + LLM 深度分析
 */

import { prisma } from '@/lib/prisma';
import { generateId } from '@/lib/id-generator';
import {
  analyzeSkillDuplication,
  type SkillForLLMAnalysis,
  type LLMAnalysisResult,
} from './skill-llm-analysis';
import {
  computeKeywordSimilarity,
  computeCategorySimilarity,
  type OverlapType,
} from './skill-similarity';

// ============================================================================
// Types
// ============================================================================

/**
 * 用于快速检测的技能数据
 */
export interface SkillForQuickCheck {
  id: string;
  name: string;
  displayName: string;
  techStackId?: string | null;
  vulnerabilityPatternId?: string | null;
  cwe?: string | null;
}

/**
 * 快速重复检测结果
 */
export interface QuickDuplicateCheckResult {
  isPotentialDuplicate: boolean;
  duplicates: Array<{
    skillId: string;
    skillName: string;
    displayName: string;
    matchType: 'exact_language_vuln' | 'same_language' | 'same_vuln_type';
    confidence: number;
    reason: string;
  }>;
  summary: string;
}

/**
 * 治理分析任务状态
 */
export interface GovernanceAnalysisTask {
  skillId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

/**
 * 技能对分析结果（存储到数据库）
 */
export interface SkillPairAnalysisResult {
  skillId: string;
  relatedSkillId: string;
  isDuplicate: boolean;
  overlapType: OverlapType | 'exact' | 'subset' | 'related' | 'distinct';
  confidence: number;
  llmReason: string;
  keyDifferences: string[];
  recommendation: 'merge' | 'keep_separate' | 'review';
}

// ============================================================================
// 快速重复检测：同语言 + 同漏洞类型
// ============================================================================

/**
 * 快速重复检测
 * 检查新技能是否与现有技能存在"同语言 + 同漏洞类型"的潜在重复
 *
 * @param newSkill 新技能数据
 * @param existingSkills 现有技能列表
 * @returns 快速检测结果
 */
export function quickDuplicateCheck(
  newSkill: SkillForQuickCheck,
  existingSkills: SkillForQuickCheck[]
): QuickDuplicateCheckResult {
  const duplicates: QuickDuplicateCheckResult['duplicates'] = [];

  for (const existing of existingSkills) {
    // 跳过自己
    if (existing.id === newSkill.id) {
      continue;
    }

    // 1. 检查完全匹配：同语言 ID + 同漏洞类型 ID
    if (
      newSkill.techStackId &&
      existing.techStackId &&
      newSkill.techStackId === existing.techStackId &&
      newSkill.vulnerabilityPatternId &&
      existing.vulnerabilityPatternId &&
      newSkill.vulnerabilityPatternId === existing.vulnerabilityPatternId
    ) {
      duplicates.push({
        skillId: existing.id,
        skillName: existing.name,
        displayName: existing.displayName,
        matchType: 'exact_language_vuln',
        confidence: 0.95,
        reason: `同语言(${newSkill.techStackId}) + 同漏洞类型(${newSkill.vulnerabilityPatternId})`,
      });
      continue;
    }

    // 2. 检查同语言（不同漏洞类型）
    if (
      newSkill.techStackId &&
      existing.techStackId &&
      newSkill.techStackId === existing.techStackId
    ) {
      duplicates.push({
        skillId: existing.id,
        skillName: existing.name,
        displayName: existing.displayName,
        matchType: 'same_language',
        confidence: 0.6,
        reason: `同语言(${newSkill.techStackId})，但漏洞类型不同`,
      });
      continue;
    }

    // 3. 检查同漏洞类型（不同语言）
    if (
      newSkill.vulnerabilityPatternId &&
      existing.vulnerabilityPatternId &&
      newSkill.vulnerabilityPatternId === existing.vulnerabilityPatternId
    ) {
      duplicates.push({
        skillId: existing.id,
        skillName: existing.name,
        displayName: existing.displayName,
        matchType: 'same_vuln_type',
        confidence: 0.5,
        reason: `同漏洞类型(${newSkill.vulnerabilityPatternId})，但语言不同`,
      });
      continue;
    }

    // 4. 兼容旧数据：使用 CWE 匹配
    if (!newSkill.techStackId && !existing.techStackId) {
      const cweMatch =
        newSkill.cwe && existing.cwe && newSkill.cwe === existing.cwe;

      if (cweMatch) {
        duplicates.push({
          skillId: existing.id,
          skillName: existing.name,
          displayName: existing.displayName,
          matchType: 'same_vuln_type',
          confidence: 0.45,
          reason: `同CWE(${newSkill.cwe})`,
        });
      }
    }
  }

  // 按置信度排序
  duplicates.sort((a, b) => b.confidence - a.confidence);

  // 构建摘要
  const highConfidenceCount = duplicates.filter(d => d.confidence >= 0.85).length;
  const summary =
    highConfidenceCount > 0
      ? `发现 ${highConfidenceCount} 个高置信度潜在重复，建议进行 LLM 深度分析`
      : duplicates.length > 0
        ? `发现 ${duplicates.length} 个潜在相关技能，置信度较低`
        : '未发现潜在重复';

  return {
    isPotentialDuplicate: duplicates.length > 0,
    duplicates,
    summary,
  };
}

// ============================================================================
// 异步分析队列触发
// ============================================================================

/**
 * 触发治理分析
 * 创建异步分析任务，对技能进行深度重复检测
 *
 * @param skillId 要分析的技能 ID
 * @returns 分析任务信息
 */
export async function triggerGovernanceAnalysis(skillId: string): Promise<GovernanceAnalysisTask> {
  // 1. 获取技能信息
  const skill = await prisma.skill.findUnique({
    where: { id: skillId },
    include: {
      SkillCategory: true,
      VulnerabilityTree: true,
    },
  });

  if (!skill) {
    throw new Error(`Skill not found: ${skillId}`);
  }

  // 2. 查找潜在重复技能
  const potentialDuplicates = await findPotentialDuplicates(skill);

  // 3. 创建分析记录（标记为 pending）
  const analysisRecords = await prisma.skillAnalysis.createMany({
    data: potentialDuplicates.map(d => ({
      id: generateId('analysis'),
      skillId: skill.id,
      relatedSkillId: d.id,
      analysisType: 'duplication_check',
      isDuplicate: false,
      confidence: 0,
      reviewStatus: 'pending',
      analyzedBy: 'system',
    })),
    skipDuplicates: true,
  });

  // 4. 返回任务状态
  return {
    skillId,
    status: 'pending',
    startedAt: new Date(),
  };
}

/**
 * 查找潜在重复技能
 */
async function findPotentialDuplicates(skill: {
  id: string;
  techStackId?: string | null;
  vulnerabilityPatternId?: string | null;
  cwe?: string | null;
}): Promise<Array<{ id: string; name: string }>> {
  // 构建查询条件
  const conditions: Array<{
    techStackId?: string | null;
    vulnerabilityPatternId?: string | null;
    cwe?: string | null;
  }> = [];

  // 条件 1：同语言 + 同漏洞类型
  if (skill.techStackId && skill.vulnerabilityPatternId) {
    conditions.push({
      techStackId: skill.techStackId,
      vulnerabilityPatternId: skill.vulnerabilityPatternId,
    });
  }

  // 条件 2：同语言
  if (skill.techStackId) {
    conditions.push({
      techStackId: skill.techStackId,
    });
  }

  // 条件 3：同漏洞类型
  if (skill.vulnerabilityPatternId) {
    conditions.push({
      vulnerabilityPatternId: skill.vulnerabilityPatternId,
    });
  }

  // 条件 4：同 CWE
  if (skill.cwe) {
    conditions.push({
      cwe: skill.cwe,
    });
  }

  // 执行查询
  const duplicates = await prisma.skill.findMany({
    where: {
      id: { not: skill.id },
      OR: conditions,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
    },
  });

  return duplicates;
}

// ============================================================================
// LLM 深度分析并存储结果
// ============================================================================

/**
 * 分析技能对
 * 使用 LLM 进行深度分析，并将结果存储到 SkillAnalysis 表
 *
 * @param skillA 技能 A
 * @param skillB 技能 B
 * @returns 分析结果
 */
export async function analyzeSkillPair(
  skillA: SkillForLLMAnalysis,
  skillB: SkillForLLMAnalysis
): Promise<SkillPairAnalysisResult> {
  // 1. 调用 LLM 分析
  const llmResult = await analyzeSkillDuplication(skillA, skillB);

  // 2. 存储分析结果到数据库
  const analysisRecord = await prisma.skillAnalysis.create({
    data: {
      id: generateId('analysis'),
      skillId: skillA.id,
      relatedSkillId: skillB.id,
      analysisType: 'duplication_check',
      isDuplicate: llmResult.isDuplicate,
      overlapType: llmResult.overlapType,
      confidence: llmResult.confidence,
      llmReason: llmResult.reason,
      keyDifferences: JSON.stringify(llmResult.keyDifferences || []),
      sharedFunctionality: JSON.stringify(llmResult.sharedFunctionality || []),
      recommendation: llmResult.recommendation,
      reviewStatus: 'pending',
      analyzedBy: 'llm',
    },
  });

  // 3. 返回结果
  return {
    skillId: skillA.id,
    relatedSkillId: skillB.id,
    isDuplicate: llmResult.isDuplicate,
    overlapType: llmResult.overlapType,
    confidence: llmResult.confidence,
    llmReason: llmResult.reason,
    keyDifferences: llmResult.keyDifferences || [],
    recommendation: llmResult.recommendation,
  };
}

/**
 * 批量分析技能对
 * 对多个技能对进行 LLM 分析并存储结果
 *
 * @param pairs 技能对列表
 * @param options 批量分析选项
 * @returns 批量分析结果
 */
export async function batchAnalyzeSkillPairs(
  pairs: Array<{ skillA: SkillForLLMAnalysis; skillB: SkillForLLMAnalysis }>,
  options: {
    concurrency?: number;
    onProgress?: (current: number, total: number) => void;
  } = {}
): Promise<{
  total: number;
  duplicates: number;
  results: SkillPairAnalysisResult[];
}> {
  const { concurrency = 3, onProgress } = options;
  const results: SkillPairAnalysisResult[] = [];
  let duplicates = 0;

  // 分批处理
  for (let i = 0; i < pairs.length; i += concurrency) {
    const batch = pairs.slice(i, i + concurrency);

    // 并发执行
    const batchResults = await Promise.all(
      batch.map(pair => analyzeSkillPair(pair.skillA, pair.skillB))
    );

    // 统计
    for (const result of batchResults) {
      results.push(result);
      if (result.isDuplicate) {
        duplicates++;
      }
    }

    // 进度回调
    if (onProgress) {
      onProgress(Math.min(i + concurrency, pairs.length), pairs.length);
    }

    // 避免 API 限流
    if (i + concurrency < pairs.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return {
    total: pairs.length,
    duplicates,
    results,
  };
}

// ============================================================================
// 查询分析结果
// ============================================================================

/**
 * 获取技能的分析结果
 *
 * @param skillId 技能 ID
 * @returns 分析结果列表
 */
export async function getSkillAnalysisResults(skillId: string): Promise<
  Array<{
    id: string;
    relatedSkillId: string | null;
    analysisType: string;
    isDuplicate: boolean;
    overlapType: string | null;
    confidence: number;
    llmReason: string | null;
    keyDifferences: string | null;
    recommendation: string | null;
    reviewStatus: string;
    analyzedAt: Date;
  }>
> {
  return prisma.skillAnalysis.findMany({
    where: { skillId },
    orderBy: { confidence: 'desc' },
  });
}

/**
 * 获取待审核的分析结果
 *
 * @param limit 返回数量限制
 * @returns 待审核分析结果列表
 */
export async function getPendingReviewAnalyses(limit: number = 50): Promise<
  Array<{
    id: string;
    skillId: string;
    relatedSkillId: string | null;
    isDuplicate: boolean;
    confidence: number;
    llmReason: string | null;
    recommendation: string | null;
    reviewStatus: string;
  }>
> {
  return prisma.skillAnalysis.findMany({
    where: {
      reviewStatus: 'pending',
      confidence: { gte: 0.7 }, // 只返回高置信度的
    },
    orderBy: { confidence: 'desc' },
    take: limit,
  });
}

/**
 * 更新分析结果审核状态
 *
 * @param analysisId 分析记录 ID
 * @param reviewStatus 审核状态
 * @param reviewedBy 审核人
 * @param reviewNotes 审核备注
 */
export async function updateAnalysisReviewStatus(
  analysisId: string,
  reviewStatus: 'approved' | 'rejected',
  reviewedBy: string,
  reviewNotes?: string
): Promise<void> {
  await prisma.skillAnalysis.update({
    where: { id: analysisId },
    data: {
      reviewStatus,
      reviewedBy,
      reviewedAt: new Date(),
      reviewNotes,
    },
  });
}

// ============================================================================
// 导出
// ============================================================================

export default {
  quickDuplicateCheck,
  triggerGovernanceAnalysis,
  analyzeSkillPair,
  batchAnalyzeSkillPairs,
  getSkillAnalysisResults,
  getPendingReviewAnalyses,
  updateAnalysisReviewStatus,
};