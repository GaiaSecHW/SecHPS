/**
 * Skill Overlap Analysis Service
 * 功能重复分析服务：聚类相似Skills、提取共享关键词、识别独特检测点
 */

import type { SimilarSkill, OverlapType } from './skill-similarity';

// ============================================================================
// Types
// ============================================================================

/**
 * 独特检测点
 */
export interface UniquePoint {
  /** 技能ID */
  skillId: string;
  /** 技能名称 */
  skillName: string;
  /** 独特关键词 */
  uniqueKeywords: string[];
  /** 独特技术栈 */
  uniqueTechStack: string[];
  /** 独特CWE */
  uniqueCwe: string | null;
  /** 独特性描述 */
  description: string;
}

/**
 * 重叠组
 */
export interface OverlapGroup {
  /** 组名称（基于主要重叠类型） */
  groupName: string;
  /** 组内技能列表 */
  skills: SimilarSkill[];
  /** 重叠类型 */
  overlapType: OverlapType;
  /** 组平均重叠得分 */
  overlapScore: number;
  /** 共享关键词 */
  sharedKeywords: string[];
  /** 各技能独特检测点 */
  uniquePoints: UniquePoint[];
}

/**
 * 重叠分析结果
 */
export interface OverlapAnalysis {
  /** 分析时间戳 */
  timestamp: string;
  /** 总匹配数 */
  totalMatches: number;
  /** 重叠组数 */
  totalGroups: number;
  /** 重叠组列表 */
  groups: OverlapGroup[];
  /** 摘要统计 */
  summary: {
    exactMatches: number;
    semanticOverlaps: number;
    techStackOverlaps: number;
    triggerOverlaps: number;
    highRiskGroups: number; // overlapScore >= 0.85
  };
}

/**
 * 聚类配置
 */
export interface ClusterConfig {
  /** 相似度阈值，超过此值的技能归为一组 */
  threshold: number;
  /** 是否按重叠类型分组 */
  groupByOverlapType: boolean;
  /** 最小组成员数 */
  minGroupSize: number;
}

/**
 * 默认聚类配置
 */
export const DEFAULT_CLUSTER_CONFIG: ClusterConfig = {
  threshold: 0.75,
  groupByOverlapType: true,
  minGroupSize: 2,
};

// ============================================================================
// 主函数：分析技能重叠
// ============================================================================

/**
 * 分析技能重叠
 * 
 * @param matches 相似技能匹配列表
 * @param config 聚类配置
 * @returns 重叠分析结果
 */
export function analyzeSkillOverlap(
  matches: SimilarSkill[],
  config: Partial<ClusterConfig> = {}
): OverlapAnalysis {
  const clusterConfig = { ...DEFAULT_CLUSTER_CONFIG, ...config };
  const timestamp = new Date().toISOString();
  
  // 如果没有匹配，返回空结果
  if (!matches || matches.length === 0) {
    return {
      timestamp,
      totalMatches: 0,
      totalGroups: 0,
      groups: [],
      summary: {
        exactMatches: 0,
        semanticOverlaps: 0,
        techStackOverlaps: 0,
        triggerOverlaps: 0,
        highRiskGroups: 0,
      },
    };
  }
  
  // 聚类相似技能
  const groups = clusterSimilarSkills(matches, clusterConfig.threshold);
  
  // 为每个组提取共享关键词和独特检测点
  const enrichedGroups: OverlapGroup[] = groups.map(group => {
    const sharedKeywords = extractSharedKeywords(group.skills);
    const uniquePoints = group.skills.map(skill => 
      extractUniquePoints(skill, group.skills)
    );
    
    return {
      ...group,
      sharedKeywords,
      uniquePoints,
    };
  });
  
  // 计算摘要统计
  const summary = calculateSummary(enrichedGroups);
  
  return {
    timestamp,
    totalMatches: matches.length,
    totalGroups: enrichedGroups.length,
    groups: enrichedGroups,
    summary,
  };
}

// ============================================================================
// 聚类算法
// ============================================================================

/**
 * 聚类相似技能
 * 
 * 使用简单的阈值分组算法：
 * 1. 按重叠类型分组
 * 2. 在每个类型组内，按相似度阈值聚类
 * 
 * @param skills 相似技能列表
 * @param threshold 相似度阈值
 * @returns 重叠组列表
 */
export function clusterSimilarSkills(
  skills: SimilarSkill[],
  threshold: number
): OverlapGroup[] {
  if (!skills || skills.length === 0) {
    return [];
  }
  
  // 按重叠类型分组
  const typeGroups = new Map<OverlapType, SimilarSkill[]>();
  
  for (const skill of skills) {
    const existing = typeGroups.get(skill.overlapType) || [];
    existing.push(skill);
    typeGroups.set(skill.overlapType, existing);
  }
  
  const result: OverlapGroup[] = [];
  let groupIndex = 0;
  
  // 对每个类型组进行聚类
  for (const [overlapType, typeSkills] of typeGroups) {
    // 按相似度排序
    const sortedSkills = [...typeSkills].sort((a, b) => b.similarity - a.similarity);
    
    // 简单聚类：将相似度相近的技能归为一组
    const clusters: SimilarSkill[][] = [];
    const used = new Set<string>();
    
    for (const skill of sortedSkills) {
      if (used.has(skill.skillId)) {
        continue;
      }
      
      // 创建新簇
      const cluster: SimilarSkill[] = [skill];
      used.add(skill.skillId);
      
      // 查找相似技能加入簇
      for (const candidate of sortedSkills) {
        if (used.has(candidate.skillId)) {
          continue;
        }
        
        // 如果候选技能与簇中任一技能相似度超过阈值，加入簇
        const isSimilar = cluster.some(
          s => Math.abs(s.similarity - candidate.similarity) < (1 - threshold) * 0.5
        );
        
        if (isSimilar) {
          cluster.push(candidate);
          used.add(candidate.skillId);
        }
      }
      
      clusters.push(cluster);
    }
    
    // 将簇转换为重叠组
    for (const cluster of clusters) {
      if (cluster.length < DEFAULT_CLUSTER_CONFIG.minGroupSize) {
        // 单个技能也作为一个组（用于展示）
        // 但标记为低优先级
      }
      
      const avgOverlapScore = cluster.reduce((sum, s) => sum + s.overlapScore, 0) / cluster.length;
      
      result.push({
        groupName: generateGroupName(overlapType, cluster, groupIndex),
        skills: cluster,
        overlapType,
        overlapScore: avgOverlapScore,
        sharedKeywords: [], // 稍后填充
        uniquePoints: [], // 稍后填充
      });
      
      groupIndex++;
    }
  }
  
  // 按重叠得分排序
  return result.sort((a, b) => b.overlapScore - a.overlapScore);
}

/**
 * 生成组名称
 */
function generateGroupName(
  overlapType: OverlapType,
  skills: SimilarSkill[],
  index: number
): string {
  const typeNames: Record<OverlapType, string> = {
    'exact': '完全匹配',
    'semantic-overlap': '语义重叠',
    'techStack-overlap': '技术栈重叠',
    'trigger-overlap': '触发词重叠',
  };
  
  const skillNames = skills.slice(0, 3).map(s => s.displayName).join(', ');
  const more = skills.length > 3 ? ` +${skills.length - 3}` : '';
  
  return `${typeNames[overlapType]}: ${skillNames}${more}`;
}

// ============================================================================
// 关键词提取
// ============================================================================

/**
 * 提取共享关键词
 * 
 * 从一组技能中提取共同出现的关键词
 * 
 * @param skills 技能列表
 * @returns 共享关键词列表
 */
export function extractSharedKeywords(skills: SimilarSkill[]): string[] {
  if (!skills || skills.length === 0) {
    return [];
  }
  
  // 提取每个技能的关键词
  const skillKeywords = skills.map(skill => {
    const keywords = new Set<string>();
    
    // 从技能名称提取
    const nameWords = tokenize(skill.skillName);
    nameWords.forEach(w => keywords.add(w.toLowerCase()));
    
    // 从显示名称提取
    const displayWords = tokenize(skill.displayName);
    displayWords.forEach(w => keywords.add(w.toLowerCase()));
    
    // 从技术栈提取
    skill.techStack?.forEach(t => keywords.add(t.toLowerCase()));
    
    // 从原因描述提取关键词
    const reasonWords = tokenize(skill.reason);
    reasonWords.forEach(w => keywords.add(w.toLowerCase()));
    
    return keywords;
  });
  
  // 找出所有技能共有的关键词
  if (skillKeywords.length === 1) {
    return [...skillKeywords[0]].slice(0, 10);
  }
  
  const sharedKeywords: string[] = [];
  const firstKeywords = skillKeywords[0];
  
  for (const keyword of firstKeywords) {
    const isShared = skillKeywords.slice(1).every(keywords => keywords.has(keyword));
    if (isShared && keyword.length > 2) { // 过滤太短的关键词
      sharedKeywords.push(keyword);
    }
  }
  
  // 按重要性排序（技术栈关键词优先）
  return sharedKeywords
    .sort((a, b) => {
      const aIsTech = skills.some(s => s.techStack?.includes(a));
      const bIsTech = skills.some(s => s.techStack?.includes(b));
      if (aIsTech && !bIsTech) return -1;
      if (!aIsTech && bIsTech) return 1;
      return a.localeCompare(b);
    })
    .slice(0, 15);
}

/**
 * 简单分词（复用自 skill-similarity.ts）
 */
function tokenize(text: string): string[] {
  const cleaned = text.replace(/[^\w\u4e00-\u9fa5]/g, ' ');
  const words = cleaned.split(/\s+/).filter(w => w.length > 1);
  
  const tokens: string[] = [];
  for (const word of words) {
    if (/[\u4e00-\u9fa5]/.test(word)) {
      // 中文词，生成2-gram和3-gram
      for (let i = 0; i < word.length - 1; i++) {
        tokens.push(word.slice(i, i + 2));
        if (i < word.length - 2) {
          tokens.push(word.slice(i, i + 3));
        }
      }
    } else {
      tokens.push(word);
    }
  }
  
  return tokens;
}

// ============================================================================
// 独特检测点提取
// ============================================================================

/**
 * 提取独特检测点
 * 
 * 分析单个技能相对于组内其他技能的独特之处
 * 
 * @param skill 目标技能
 * @param groupSkills 组内所有技能
 * @returns 独特检测点
 */
export function extractUniquePoints(
  skill: SimilarSkill,
  groupSkills: SimilarSkill[]
): UniquePoint {
  // 收集其他技能的特征
  const otherKeywords = new Set<string>();
  const otherTechStack = new Set<string>();
  const otherCwe = new Set<string>();
  
  for (const other of groupSkills) {
    if (other.skillId === skill.skillId) {
      continue;
    }
    
    // 收集关键词
    tokenize(other.skillName).forEach(w => otherKeywords.add(w.toLowerCase()));
    tokenize(other.displayName).forEach(w => otherKeywords.add(w.toLowerCase()));
    other.techStack?.forEach(t => otherTechStack.add(t.toLowerCase()));
    if (other.cwe) {
      otherCwe.add(other.cwe);
    }
  }
  
  // 找出独特关键词
  const skillKeywords = new Set<string>();
  tokenize(skill.skillName).forEach(w => skillKeywords.add(w.toLowerCase()));
  tokenize(skill.displayName).forEach(w => skillKeywords.add(w.toLowerCase()));
  
  const uniqueKeywords = [...skillKeywords].filter(
    k => !otherKeywords.has(k) && k.length > 2
  );
  
  // 找出独特技术栈
  const uniqueTechStack = (skill.techStack || []).filter(
    t => !otherTechStack.has(t.toLowerCase())
  );
  
  // 检查独特CWE
  const uniqueCwe = skill.cwe && !otherCwe.has(skill.cwe) ? skill.cwe : null;
  
  // 生成描述
  const description = generateUniqueDescription(
    skill,
    uniqueKeywords,
    uniqueTechStack,
    uniqueCwe
  );
  
  return {
    skillId: skill.skillId,
    skillName: skill.skillName,
    uniqueKeywords: uniqueKeywords.slice(0, 10),
    uniqueTechStack,
    uniqueCwe,
    description,
  };
}

/**
 * 生成独特性描述
 */
function generateUniqueDescription(
  skill: SimilarSkill,
  uniqueKeywords: string[],
  uniqueTechStack: string[],
  uniqueCwe: string | null
): string {
  const parts: string[] = [];
  
  if (uniqueTechStack.length > 0) {
    parts.push(`独特技术栈: ${uniqueTechStack.slice(0, 3).join(', ')}`);
  }
  
  if (uniqueCwe) {
    parts.push(`独特CWE: ${uniqueCwe}`);
  }
  
  if (uniqueKeywords.length > 0) {
    parts.push(`独特关键词: ${uniqueKeywords.slice(0, 5).join(', ')}`);
  }
  
  if (parts.length === 0) {
    return `${skill.displayName} 与组内其他技能高度相似，无明显独特检测点`;
  }
  
  return parts.join(' | ');
}

// ============================================================================
// 摘要统计
// ============================================================================

/**
 * 计算摘要统计
 */
function calculateSummary(groups: OverlapGroup[]): OverlapAnalysis['summary'] {
  let exactMatches = 0;
  let semanticOverlaps = 0;
  let techStackOverlaps = 0;
  let triggerOverlaps = 0;
  let highRiskGroups = 0;
  
  for (const group of groups) {
    switch (group.overlapType) {
      case 'exact':
        exactMatches += group.skills.length;
        break;
      case 'semantic-overlap':
        semanticOverlaps += group.skills.length;
        break;
      case 'techStack-overlap':
        techStackOverlaps += group.skills.length;
        break;
      case 'trigger-overlap':
        triggerOverlaps += group.skills.length;
        break;
    }
    
    if (group.overlapScore >= 0.85) {
      highRiskGroups++;
    }
  }
  
  return {
    exactMatches,
    semanticOverlaps,
    techStackOverlaps,
    triggerOverlaps,
    highRiskGroups,
  };
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取高风险重叠组
 * 
 * @param analysis 重叠分析结果
 * @param threshold 风险阈值（默认0.85）
 * @returns 高风险组列表
 */
export function getHighRiskGroups(
  analysis: OverlapAnalysis,
  threshold: number = 0.85
): OverlapGroup[] {
  return analysis.groups.filter(g => g.overlapScore >= threshold);
}

/**
 * 获取指定重叠类型的组
 * 
 * @param analysis 重叠分析结果
 * @param overlapType 重叠类型
 * @returns 匹配的组列表
 */
export function getGroupsByType(
  analysis: OverlapAnalysis,
  overlapType: OverlapType
): OverlapGroup[] {
  return analysis.groups.filter(g => g.overlapType === overlapType);
}

/**
 * 检查技能是否在重叠组中
 * 
 * @param analysis 重叠分析结果
 * @param skillId 技能ID
 * @returns 是否在重叠组中
 */
export function isSkillInOverlapGroup(
  analysis: OverlapAnalysis,
  skillId: string
): boolean {
  return analysis.groups.some(g => 
    g.skills.some(s => s.skillId === skillId)
  );
}

/**
 * 获取技能所在的所有重叠组
 * 
 * @param analysis 重叠分析结果
 * @param skillId 技能ID
 * @returns 包含该技能的组列表
 */
export function getGroupsForSkill(
  analysis: OverlapAnalysis,
  skillId: string
): OverlapGroup[] {
  return analysis.groups.filter(g => 
    g.skills.some(s => s.skillId === skillId)
  );
}

/**
 * 生成重叠分析报告
 * 
 * @param analysis 重叠分析结果
 * @returns 文本报告
 */
export function generateOverlapReport(analysis: OverlapAnalysis): string {
  const lines: string[] = [
    `# 技能重叠分析报告`,
    `生成时间: ${analysis.timestamp}`,
    ``,
    `## 摘要`,
    `- 总匹配数: ${analysis.totalMatches}`,
    `- 重叠组数: ${analysis.totalGroups}`,
    `- 完全匹配: ${analysis.summary.exactMatches}`,
    `- 语义重叠: ${analysis.summary.semanticOverlaps}`,
    `- 技术栈重叠: ${analysis.summary.techStackOverlaps}`,
    `- 触发词重叠: ${analysis.summary.triggerOverlaps}`,
    `- 高风险组: ${analysis.summary.highRiskGroups}`,
    ``,
  ];
  
  if (analysis.groups.length === 0) {
    lines.push(`未发现技能重叠。`);
    return lines.join('\n');
  }
  
  lines.push(`## 重叠组详情`);
  lines.push(``);
  
  for (let i = 0; i < analysis.groups.length; i++) {
    const group = analysis.groups[i];
    lines.push(`### ${i + 1}. ${group.groupName}`);
    lines.push(`- 重叠类型: ${group.overlapType}`);
    lines.push(`- 重叠得分: ${(group.overlapScore * 100).toFixed(0)}%`);
    lines.push(`- 技能数量: ${group.skills.length}`);
    
    if (group.sharedKeywords.length > 0) {
      lines.push(`- 共享关键词: ${group.sharedKeywords.join(', ')}`);
    }
    
    lines.push(``);
    lines.push(`**技能列表:**`);
    for (const skill of group.skills) {
      lines.push(`- ${skill.displayName} (${skill.skillName}) - 相似度: ${(skill.similarity * 100).toFixed(0)}%`);
    }
    
    lines.push(``);
    lines.push(`**独特检测点:**`);
    for (const point of group.uniquePoints) {
      lines.push(`- **${point.skillName}**: ${point.description}`);
    }
    
    lines.push(``);
  }
  
  return lines.join('\n');
}