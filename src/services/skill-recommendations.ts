/**
 * Skill Recommendations Service
 * 处理建议生成服务：根据重叠分析和影响预测生成处理建议
 */

import type { OverlapGroup, UniquePoint } from './skill-overlap-analysis';
import type { SimilarSkill, OverlapType } from './skill-similarity';

// ============================================================================
// Types
// ============================================================================

/**
 * 建议动作类型
 */
export type RecommendationAction =
  | 'merge'           // 合并建议（有明确覆盖关系时）
  | 'techStack-split' // 技术栈拆分建议（技术栈可以明确分开时）
  | 'keep-all'        // 保留全部建议（影响可控时）
  | 'manual-review';  // 人工审核建议（复杂情况需要人工审核）

/**
 * 建议优先级
 */
export type RecommendationPriority = 'high' | 'medium' | 'low';

/**
 * 影响预测（来自 skill-impact-prediction.ts，T4并行执行中）
 */
export interface ImpactPrediction {
  /** 是否存在重复检测 */
  duplicateDetection: boolean;
  /** 预估冗余报告数 */
  estimatedRedundantReports: number;
  /** 预估Token增加量 */
  estimatedTokenIncrease: number;
  /** 整体严重程度 */
  overallSeverity: 'low' | 'medium' | 'high' | 'critical';
  /** 影响详情 */
  details: {
    /** 受影响的Workflow数 */
    affectedWorkflows: number;
    /** 预估用户困惑度 */
    userConfusionRisk: number;
    /** 预估选择冲突率 */
    selectionConflictRate: number;
  };
}

/**
 * 处理建议
 */
export interface Recommendation {
  /** 建议动作 */
  action: RecommendationAction;
  /** 优先级 */
  priority: RecommendationPriority;
  /** 建议描述 */
  description: string;
  /** 建议原因 */
  reason: string;
  /** 预期收益 */
  expectedBenefit: string;
  /** 目标技能（merge时） */
  targetSkill?: string;
  /** 来源技能列表（merge时） */
  sourceSkills?: string[];
  /** 技术栈拆分方案（techStack-split时） */
  techStackSplitPlan?: TechStackSplitPlan[];
  /** 需人工审核的点（manual-review时） */
  reviewPoints?: string[];
}

/**
 * 技术栈拆分方案
 */
export interface TechStackSplitPlan {
  skillId: string;
  skillName: string;
  techStack: string[];
  uniqueKeywords: string[];
}

/**
 * 建议生成配置
 */
export interface RecommendationConfig {
  /** merge建议阈值：overlapScore超过此值时优先考虑merge */
  mergeThreshold: number;
  /** keep-all阈值：severity低于此值时考虑keep-all */
  keepAllSeverityThreshold: 'medium';
  /** 是否优先考虑技术栈拆分 */
  preferTechStackSplit: boolean;
}

/**
 * 默认配置
 */
export const DEFAULT_RECOMMENDATION_CONFIG: RecommendationConfig = {
  mergeThreshold: 0.85,
  keepAllSeverityThreshold: 'medium',
  preferTechStackSplit: true,
};

// ============================================================================
// 主函数：生成处理建议
// ============================================================================

/**
 * 生成处理建议
 * 
 * 根据重叠分析和影响预测，生成处理建议列表（按优先级排序）
 * 
 * @param overlapGroup 重叠组
 * @param impact 影响预测
 * @param config 配置
 * @returns 建议列表（按优先级排序：merge优先，manual-review最后）
 */
export function generateRecommendations(
  overlapGroup: OverlapGroup,
  impact: ImpactPrediction,
  config: Partial<RecommendationConfig> = {}
): Recommendation[] {
  const cfg = { ...DEFAULT_RECOMMENDATION_CONFIG, ...config };
  const recommendations: Recommendation[] = [];

  // 1. 检查是否可以merge（有明确覆盖关系）
  if (canSuggestMerge(overlapGroup, cfg.mergeThreshold)) {
    recommendations.push(suggestMerge(overlapGroup));
  }

  // 2. 检查是否可以技术栈拆分
  if (canSuggestTechStackSplit(overlapGroup)) {
    recommendations.push(suggestTechStackSplit(overlapGroup));
  }

  // 3. 检查是否可以保留全部（影响可控）
  if (canSuggestKeepAll(impact, cfg.keepAllSeverityThreshold)) {
    recommendations.push(suggestKeepAll(overlapGroup, impact));
  }

  // 4. 复杂情况需要人工审核（总是作为备选）
  recommendations.push(suggestManualReview(overlapGroup));

  // 按优先级排序（high > medium > low）
  return recommendations.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

// ============================================================================
// 建议生成函数
// ============================================================================

/**
 * 判断是否可以建议merge
 * 
 * 条件：
 * 1. overlapScore >= mergeThreshold（高度重叠）
 * 2. 有明确的primary skill（其他skills可被覆盖）
 * 3. overlapType为exact或semantic-overlap
 */
function canSuggestMerge(group: OverlapGroup, threshold: number): boolean {
  // 高度重叠
  if (group.overlapScore < threshold) {
    return false;
  }

  // 完全匹配或语义重叠适合merge
  if (group.overlapType !== 'exact' && group.overlapType !== 'semantic-overlap') {
    return false;
  }

  // 检查是否有明确的primary skill（独特检测点最少）
  const hasPrimarySkill = group.uniquePoints.some(
    point => point.uniqueKeywords.length === 0 && 
             point.uniqueTechStack.length === 0 &&
             !point.uniqueCwe
  );

  return hasPrimarySkill;
}

/**
 * 生成merge建议
 */
export function suggestMerge(group: OverlapGroup): Recommendation {
  // 找出primary skill（独特检测点最少）
  const primarySkill = group.uniquePoints.reduce((min, point) => {
    const uniqueness = point.uniqueKeywords.length + 
                       point.uniqueTechStack.length +
                       (point.uniqueCwe ? 1 : 0);
    const minUniqueness = min.uniqueKeywords.length + 
                          min.uniqueTechStack.length +
                          (min.uniqueCwe ? 1 : 0);
    return uniqueness < minUniqueness ? point : min;
  }, group.uniquePoints[0]);

  // 其他skills作为source
  const sourceSkills = group.skills
    .filter(s => s.skillId !== primarySkill.skillId)
    .map(s => s.skillName);

  return {
    action: 'merge',
    priority: 'high',
    description: `建议将 ${sourceSkills.length} 个相似技能合并到 ${primarySkill.skillName}`,
    reason: `重叠得分 ${(group.overlapScore * 100).toFixed(0)}%，存在明确覆盖关系，${primarySkill.skillName} 可覆盖其他技能的功能`,
    expectedBenefit: `减少冗余检测，降低 ${(group.skills.length - 1) * 20}% 的重复报告`,
    targetSkill: primarySkill.skillId,
    sourceSkills,
  };
}

/**
 * 判断是否可以建议技术栈拆分
 * 
 * 条件：
 * 1. overlapType为techStack-overlap
 * 2. 各skills有不同且可区分的techStack
 */
function canSuggestTechStackSplit(group: OverlapGroup): boolean {
  // 技术栈重叠类型
  if (group.overlapType !== 'techStack-overlap') {
    return false;
  }

  // 检查各skills是否有独特技术栈
  const hasUniqueTechStack = group.uniquePoints.every(
    point => point.uniqueTechStack.length > 0
  );

  return hasUniqueTechStack;
}

/**
 * 生成技术栈拆分建议
 */
export function suggestTechStackSplit(group: OverlapGroup): Recommendation {
  // 构建拆分方案
  const splitPlan: TechStackSplitPlan[] = group.uniquePoints.map(point => ({
    skillId: point.skillId,
    skillName: point.skillName,
    techStack: point.uniqueTechStack,
    uniqueKeywords: point.uniqueKeywords,
  }));

  const techStackList = splitPlan
    .map(p => `${p.skillName}: ${p.techStack.join(', ')}`)
    .join('; ');

  return {
    action: 'techStack-split',
    priority: 'medium',
    description: `建议按技术栈拆分，各技能专注不同技术栈`,
    reason: `各技能有独特技术栈，可通过技术栈区分触发场景`,
    expectedBenefit: `保持各技能独立性，避免技术栈混淆，提高匹配精确度`,
    techStackSplitPlan: splitPlan,
  };
}

/**
 * 判断是否可以建议保留全部
 * 
 * 条件：
 * 1. overallSeverity为low
 * 2. 影响可控
 */
function canSuggestKeepAll(
  impact: ImpactPrediction,
  threshold: 'medium'
): boolean {
  // severity低于阈值
  const severityOrder = { low: 0, medium: 1, high: 2, critical: 3 };
  const thresholdOrder = severityOrder[threshold];
  const impactOrder = severityOrder[impact.overallSeverity];

  return impactOrder < thresholdOrder;
}

/**
 * 生成保留全部建议
 */
export function suggestKeepAll(
  group: OverlapGroup,
  impact: ImpactPrediction
): Recommendation {
  return {
    action: 'keep-all',
    priority: 'low',
    description: `建议保留全部 ${group.skills.length} 个技能，不做合并`,
    reason: `影响程度为 ${impact.overallSeverity}，预估冗余报告 ${impact.estimatedRedundantReports} 个，影响可控`,
    expectedBenefit: `保持技能多样性，避免合并带来的功能丢失风险`,
  };
}

/**
 * 生成人工审核建议
 * 
 * 复杂情况总是需要人工审核作为备选
 */
export function suggestManualReview(group: OverlapGroup): Recommendation {
  // 收集需要审核的点
  const reviewPoints: string[] = [];

  // 检查重叠类型复杂度
  if (group.overlapType === 'trigger-overlap') {
    reviewPoints.push('触发词重叠类型需要人工判断语义差异');
  }

  // 检查独特检测点
  for (const point of group.uniquePoints) {
    if (point.uniqueCwe) {
      reviewPoints.push(`${point.skillName} 有独特CWE: ${point.uniqueCwe}，需确认是否保留`);
    }
    if (point.uniqueKeywords.length > 5) {
      reviewPoints.push(`${point.skillName} 有较多独特关键词，需确认功能差异`);
    }
  }

  // 检查共享关键词
  if (group.sharedKeywords.length > 10) {
    reviewPoints.push('共享关键词过多，需人工判断是否真正重复');
  }

  // 默认审核点
  if (reviewPoints.length === 0) {
    reviewPoints.push('重叠情况复杂，建议人工审核后决定处理方式');
  }

  return {
    action: 'manual-review',
    priority: 'low',
    description: `建议人工审核后决定处理方式`,
    reason: `重叠类型 ${group.overlapType}，存在 ${group.uniquePoints.length} 个独特检测点，需人工判断`,
    expectedBenefit: `确保处理决策准确，避免误合并或误拆分`,
    reviewPoints,
  };
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取最佳建议
 * 
 * @param recommendations 建议列表
 * @returns 优先级最高的建议
 */
export function getBestRecommendation(
  recommendations: Recommendation[]
): Recommendation | null {
  if (recommendations.length === 0) {
    return null;
  }

  // 已按优先级排序，返回第一个
  return recommendations[0];
}

/**
 * 获取指定类型的建议
 * 
 * @param recommendations 建议列表
 * @param action 建议类型
 * @returns 匹配的建议
 */
export function getRecommendationByAction(
  recommendations: Recommendation[],
  action: RecommendationAction
): Recommendation | null {
  return recommendations.find(r => r.action === action) || null;
}

/**
 * 生成建议报告
 * 
 * @param recommendations 建议列表
 * @returns 文本报告
 */
export function generateRecommendationReport(
  recommendations: Recommendation[]
): string {
  const lines: string[] = [
    `# 处理建议报告`,
    `生成时间: ${new Date().toISOString()}`,
    ``,
    `## 建议列表（按优先级排序）`,
    ``,
  ];

  if (recommendations.length === 0) {
    lines.push(`无处理建议。`);
    return lines.join('\n');
  }

  for (let i = 0; i < recommendations.length; i++) {
    const rec = recommendations[i];
    const priorityLabel = rec.priority === 'high' ? '🔴 高' : 
                          rec.priority === 'medium' ? '🟡 中' : '🟢 低';

    lines.push(`### ${i + 1}. ${rec.action} [${priorityLabel}]`);
    lines.push(`- **描述**: ${rec.description}`);
    lines.push(`- **原因**: ${rec.reason}`);
    lines.push(`- **预期收益**: ${rec.expectedBenefit}`);

    if (rec.targetSkill) {
      lines.push(`- **目标技能**: ${rec.targetSkill}`);
    }
    if (rec.sourceSkills && rec.sourceSkills.length > 0) {
      lines.push(`- **来源技能**: ${rec.sourceSkills.join(', ')}`);
    }
    if (rec.techStackSplitPlan && rec.techStackSplitPlan.length > 0) {
      lines.push(`- **技术栈拆分方案**:`);
      for (const plan of rec.techStackSplitPlan) {
        lines.push(`  - ${plan.skillName}: ${plan.techStack.join(', ')}`);
      }
    }
    if (rec.reviewPoints && rec.reviewPoints.length > 0) {
      lines.push(`- **审核要点**:`);
      for (const point of rec.reviewPoints) {
        lines.push(`  - ${point}`);
      }
    }

    lines.push(``);
  }

  // 最佳建议
  const best = getBestRecommendation(recommendations);
  if (best) {
    lines.push(`## 推荐方案`);
    lines.push(``);
    lines.push(`**${best.action}** - ${best.description}`);
    lines.push(``);
  }

  return lines.join('\n');
}

/**
 * 判断建议是否可执行
 * 
 * @param recommendation 建议
 * @returns 是否可自动执行（manual-review不可自动执行）
 */
export function isExecutableRecommendation(
  recommendation: Recommendation
): boolean {
  return recommendation.action !== 'manual-review';
}

/**
 * 获取建议执行风险等级
 * 
 * @param recommendation 建议
 * @returns 风险等级
 */
export function getRecommendationRisk(
  recommendation: Recommendation
): 'low' | 'medium' | 'high' {
  switch (recommendation.action) {
    case 'merge':
      return 'high'; // 合并可能丢失功能
    case 'techStack-split':
      return 'medium'; // 拆分需要调整配置
    case 'keep-all':
      return 'low'; // 保留全部风险最低
    case 'manual-review':
      return 'low'; // 人工审核本身无风险
    default:
      return 'medium';
  }
}