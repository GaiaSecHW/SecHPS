/**
 * Skill Impact Prediction Service
 * 影响预测服务：预测技能重叠对系统的影响
 */

import type { OverlapGroup } from './skill-overlap-analysis';

// ============================================================================
// Types
// ============================================================================

/**
 * 影响严重程度
 */
export type ImpactSeverity = 'low' | 'medium' | 'high';

/**
 * 影响预测结果
 */
export interface ImpactPrediction {
  /** 是否会产生重复检测 */
  duplicateDetection: boolean;
  /** 预估冗余报告数 */
  estimatedRedundantReports: number;
  /** Token消耗增加百分比 */
  estimatedTokenIncrease: string;
  /** 总体影响严重程度 */
  overallSeverity: ImpactSeverity;
  /** 影响详情 */
  details: {
    /** 组内技能数量 */
    groupSize: number;
    /** 重叠类型 */
    overlapType: string;
    /** 重叠得分 */
    overlapScore: number;
    /** 预测依据 */
    reasoning: string;
  };
}

/**
 * 影响预测配置
 */
export interface ImpactPredictionConfig {
  /** 冗余报告系数（每个技能产生的冗余报告数） */
  redundantReportFactor: number;
  /** Token增加系数（每个额外技能增加的Token百分比） */
  tokenIncreaseFactor: number;
  /** 中等严重度阈值（冗余报告数） */
  mediumSeverityThreshold: number;
  /** 高严重度阈值（冗余报告数） */
  highSeverityThreshold: number;
}

/**
 * 默认影响预测配置
 */
export const DEFAULT_IMPACT_CONFIG: ImpactPredictionConfig = {
  redundantReportFactor: 2,
  tokenIncreaseFactor: 30,
  mediumSeverityThreshold: 4,
  highSeverityThreshold: 8,
};

// ============================================================================
// 主函数：预测影响
// ============================================================================

/**
 * 预测重叠组的影响
 * 
 * @param group 重叠组
 * @param config 预测配置
 * @returns 影响预测结果
 */
export function predictImpact(
  group: OverlapGroup,
  config: Partial<ImpactPredictionConfig> = {}
): ImpactPrediction {
  const predictionConfig = { ...DEFAULT_IMPACT_CONFIG, ...config };
  
  const groupSize = group.skills.length;
  const overlapType = group.overlapType;
  const overlapScore = group.overlapScore;
  
  // 判断是否会产生重复检测
  const duplicateDetection = groupSize > 1 && overlapType === 'semantic-overlap';
  
  // 计算预估冗余报告数
  const estimatedRedundantReports = calculateRedundantReports(
    groupSize,
    predictionConfig.redundantReportFactor
  );
  
  // 计算Token消耗增加百分比
  const estimatedTokenIncrease = calculateTokenIncrease(
    groupSize,
    predictionConfig.tokenIncreaseFactor
  );
  
  // 计算总体影响严重程度
  const overallSeverity = calculateSeverity({
    duplicateDetection,
    estimatedRedundantReports,
    estimatedTokenIncrease,
    overlapScore,
    config: predictionConfig,
  });
  
  // 生成预测依据
  const reasoning = generateReasoning(
    duplicateDetection,
    estimatedRedundantReports,
    estimatedTokenIncrease,
    overallSeverity,
    groupSize,
    overlapType
  );
  
  return {
    duplicateDetection,
    estimatedRedundantReports,
    estimatedTokenIncrease,
    overallSeverity,
    details: {
      groupSize,
      overlapType,
      overlapScore,
      reasoning,
    },
  };
}

// ============================================================================
// 计算函数
// ============================================================================

/**
 * 计算预估冗余报告数
 * 
 * @param groupSize 组内技能数量
 * @param factor 冗余报告系数
 * @returns 预估冗余报告数
 */
export function calculateRedundantReports(
  groupSize: number,
  factor: number = DEFAULT_IMPACT_CONFIG.redundantReportFactor
): number {
  // 每个技能可能产生 factor 个冗余报告
  return Math.floor(groupSize * factor);
}

/**
 * 计算Token消耗增加百分比
 * 
 * @param groupSize 组内技能数量
 * @param factor Token增加系数
 * @returns Token消耗增加百分比字符串
 */
export function calculateTokenIncrease(
  groupSize: number,
  factor: number = DEFAULT_IMPACT_CONFIG.tokenIncreaseFactor
): string {
  // 第一个技能不增加Token，后续每个技能增加 factor%
  const increase = (groupSize - 1) * factor;
  return `${increase.toFixed(0)}%`;
}

/**
 * 计算总体影响严重程度
 * 
 * @param params 计算参数
 * @returns 严重程度
 */
export function calculateSeverity(params: {
  duplicateDetection: boolean;
  estimatedRedundantReports: number;
  estimatedTokenIncrease: string;
  overlapScore: number;
  config: ImpactPredictionConfig;
}): ImpactSeverity {
  const {
    duplicateDetection,
    estimatedRedundantReports,
    overlapScore,
    config,
  } = params;
  
  // 解析Token增加百分比
  const tokenIncreasePercent = parseInt(params.estimatedTokenIncrease, 10);
  
  // 评分系统
  let score = 0;
  
  // 重复检测 +30分
  if (duplicateDetection) {
    score += 30;
  }
  
  // 冗余报告数评分
  if (estimatedRedundantReports >= config.highSeverityThreshold) {
    score += 40;
  } else if (estimatedRedundantReports >= config.mediumSeverityThreshold) {
    score += 25;
  } else if (estimatedRedundantReports > 0) {
    score += 10;
  }
  
  // Token增加评分
  if (tokenIncreasePercent >= 60) {
    score += 30;
  } else if (tokenIncreasePercent >= 30) {
    score += 20;
  } else if (tokenIncreasePercent > 0) {
    score += 10;
  }
  
  // 重叠得分评分（高重叠得分意味着更严重）
  if (overlapScore >= 0.9) {
    score += 20;
  } else if (overlapScore >= 0.8) {
    score += 10;
  }
  
  // 根据总分判断严重程度
  if (score >= 70) {
    return 'high';
  } else if (score >= 40) {
    return 'medium';
  }
  
  return 'low';
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 生成预测依据描述
 */
function generateReasoning(
  duplicateDetection: boolean,
  estimatedRedundantReports: number,
  estimatedTokenIncrease: string,
  severity: ImpactSeverity,
  groupSize: number,
  overlapType: string
): string {
  const reasons: string[] = [];
  
  if (duplicateDetection) {
    reasons.push(`检测到语义重叠(${overlapType})，可能导致重复检测`);
  }
  
  if (estimatedRedundantReports > 0) {
    reasons.push(`预计产生${estimatedRedundantReports}个冗余报告`);
  }
  
  if (estimatedTokenIncrease !== '0%') {
    reasons.push(`Token消耗预计增加${estimatedTokenIncrease}`);
  }
  
  if (groupSize > 2) {
    reasons.push(`组内包含${groupSize}个相似技能`);
  }
  
  if (reasons.length === 0) {
    return '影响较小，无需特别关注';
  }
  
  const severityText = {
    low: '低风险',
    medium: '中等风险',
    high: '高风险',
  };
  
  return `[${severityText[severity]}] ${reasons.join('；')}。`;
}

/**
 * 批量预测多个重叠组的影响
 * 
 * @param groups 重叠组列表
 * @param config 预测配置
 * @returns 影响预测结果列表
 */
export function predictBatchImpact(
  groups: OverlapGroup[],
  config: Partial<ImpactPredictionConfig> = {}
): ImpactPrediction[] {
  return groups.map(group => predictImpact(group, config));
}

/**
 * 获取高风险影响预测
 * 
 * @param predictions 影响预测列表
 * @returns 高风险预测列表
 */
export function getHighSeverityPredictions(
  predictions: ImpactPrediction[]
): ImpactPrediction[] {
  return predictions.filter(p => p.overallSeverity === 'high');
}

/**
 * 获取中等风险影响预测
 * 
 * @param predictions 影响预测列表
 * @returns 中等风险预测列表
 */
export function getMediumSeverityPredictions(
  predictions: ImpactPrediction[]
): ImpactPrediction[] {
  return predictions.filter(p => p.overallSeverity === 'medium');
}

/**
 * 汇总影响预测统计
 * 
 * @param predictions 影响预测列表
 * @returns 统计结果
 */
export function summarizeImpactPredictions(
  predictions: ImpactPrediction[]
): {
  total: number;
  duplicateDetectionCount: number;
  totalRedundantReports: number;
  avgTokenIncrease: number;
  severityDistribution: Record<ImpactSeverity, number>;
} {
  const severityDistribution: Record<ImpactSeverity, number> = {
    low: 0,
    medium: 0,
    high: 0,
  };
  
  let duplicateDetectionCount = 0;
  let totalRedundantReports = 0;
  let totalTokenIncrease = 0;
  
  for (const prediction of predictions) {
    severityDistribution[prediction.overallSeverity]++;
    
    if (prediction.duplicateDetection) {
      duplicateDetectionCount++;
    }
    
    totalRedundantReports += prediction.estimatedRedundantReports;
    totalTokenIncrease += parseInt(prediction.estimatedTokenIncrease, 10);
  }
  
  return {
    total: predictions.length,
    duplicateDetectionCount,
    totalRedundantReports,
    avgTokenIncrease: predictions.length > 0 
      ? Math.round(totalTokenIncrease / predictions.length) 
      : 0,
    severityDistribution,
  };
}

/**
 * 生成影响预测报告
 * 
 * @param predictions 影响预测列表
 * @returns 文本报告
 */
export function generateImpactReport(predictions: ImpactPrediction[]): string {
  const summary = summarizeImpactPredictions(predictions);
  
  const lines: string[] = [
    `# 技能重叠影响预测报告`,
    `生成时间: ${new Date().toISOString()}`,
    ``,
    `## 摘要`,
    `- 总预测数: ${summary.total}`,
    `- 重复检测数: ${summary.duplicateDetectionCount}`,
    `- 总冗余报告: ${summary.totalRedundantReports}`,
    `- 平均Token增加: ${summary.avgTokenIncrease}%`,
    `- 风险分布: 低=${summary.severityDistribution.low}, 中=${summary.severityDistribution.medium}, 高=${summary.severityDistribution.high}`,
    ``,
  ];
  
  if (predictions.length === 0) {
    lines.push(`无重叠影响预测。`);
    return lines.join('\n');
  }
  
  // 按严重程度排序
  const sorted = [...predictions].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.overallSeverity] - order[b.overallSeverity];
  });
  
  lines.push(`## 详细预测`);
  lines.push(``);
  
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const severityEmoji = {
      low: '🟢',
      medium: '🟡',
      high: '🔴',
    };
    
    lines.push(`### ${i + 1}. ${severityEmoji[p.overallSeverity]} ${p.details.groupSize}个技能 - ${p.overallSeverity.toUpperCase()}`);
    lines.push(`- 重复检测: ${p.duplicateDetection ? '是' : '否'}`);
    lines.push(`- 冗余报告: ${p.estimatedRedundantReports}`);
    lines.push(`- Token增加: ${p.estimatedTokenIncrease}`);
    lines.push(`- 重叠类型: ${p.details.overlapType}`);
    lines.push(`- 重叠得分: ${(p.details.overlapScore * 100).toFixed(0)}%`);
    lines.push(`- 预测依据: ${p.details.reasoning}`);
    lines.push(``);
  }
  
  return lines.join('\n');
}