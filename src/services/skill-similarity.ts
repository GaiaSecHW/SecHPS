/**
 * Skill Similarity Service
 * 三层相似度检测服务：关键词匹配、类别+CWE匹配、内容深度分析（可选LLM）
 */

import { 
  analyzeSkillDuplication, 
  type SkillForLLMAnalysis, 
  type LLMAnalysisResult 
} from './skill-llm-analysis';

// ============================================================================
// Types
// ============================================================================

/**
 * 重叠类型枚举
 */
export type OverlapType = 
  | 'exact'              // 完全相同（名称、类别、CWE都匹配）
  | 'semantic-overlap'   // 语义重叠（描述相似但不同类别）
  | 'techStack-overlap'  // 技术栈重叠
  | 'trigger-overlap';   // 触发词重叠

/**
 * 相似技能结果
 */
export interface SimilarSkill {
  skillId: string;
  skillName: string;
  displayName: string;
  category: string;
  techStack: string[];
  cwe?: string | null;
  similarity: number;           // 综合相似度 0-1
  overlapType: OverlapType;
  overlapScore: number;         // 重叠得分 0-1
  keywordScore: number;         // 关键词得分 0-1
  contentScore?: number;        // 内容得分（可选，LLM分析时）
  reason: string;
  llmAnalysis?: LLMAnalysisResult;  // LLM 深度分析结果（可选）
}

/**
 * 相似度计算结果
 */
export interface SimilarityResult {
  total: number;
  keyword: number;
  category: number;
  content?: number;
  overlapType: OverlapType;
  details: {
    keywordMatches: string[];
    categoryMatch: boolean;
    cweMatch: boolean;
    techStackOverlap: string[];
  };
}

/**
 * 用于相似度计算的技能数据
 */
export interface SkillForSimilarity {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  techStack: string[];
  cwe?: string | null;
  content?: string;
}

/**
 * 相似度阈值配置
 */
export interface SimilarityThresholds {
  /** 综合相似度阈值，超过此值认为技能相似 */
  overall: number;
  /** 关键词匹配权重 */
  keywordWeight: number;
  /** 类别匹配权重 */
  categoryWeight: number;
  /** 内容匹配权重（LLM） */
  contentWeight: number;
  /** 是否启用LLM内容分析 */
  enableLLMAnalysis: boolean;
}

/**
 * 默认阈值配置
 */
export const DEFAULT_THRESHOLDS: SimilarityThresholds = {
  overall: 0.75,
  keywordWeight: 0.4,
  categoryWeight: 0.35,
  contentWeight: 0.25,
  enableLLMAnalysis: false,  // 默认关闭，需要显式启用
};

// ============================================================================
// 类别关键词映射（参考 route.ts:422-433）
// ============================================================================

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'code-audit': ['sql', '注入', 'injection', 'xss', '漏洞', '漏洞检测', '代码审计', '审计', '安全检测', 'vulnerability', 'security'],
  'auth': ['认证', '授权', '登录', '密码', 'jwt', 'oauth', '鉴权', 'authentication', 'authorization', 'login', 'password'],
  'sensitive': ['敏感', '密钥', '泄露', '硬编码', 'password', 'secret', 'key', 'credential', 'sensitive', 'leak'],
  'api': ['api', '接口', 'rest', 'graphql', 'endpoint', 'swagger', 'openapi'],
  'config': ['配置', 'config', '设置', 'setting', 'configuration', 'env', 'environment'],
  'crypto': ['加密', '解密', 'crypto', 'cipher', 'ssl', 'tls', 'encryption', 'decryption', 'hash'],
  'web': ['web', '网页', '网站', 'http', '请求', 'request', 'response', 'html', 'frontend'],
  'business': ['业务', '逻辑', '流程', 'workflow', 'business', 'logic', 'process'],
  'client': ['客户端', 'client', '前端', 'frontend', 'browser', 'ui'],
  'cloud': ['云', 'cloud', 'aws', 'azure', 'kubernetes', 'docker', 'k8s', 'gcp', 'deployment'],
};

// 反向映射：关键词 -> 类别
const KEYWORD_TO_CATEGORY: Map<string, string> = new Map();
for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
  for (const keyword of keywords) {
    KEYWORD_TO_CATEGORY.set(keyword.toLowerCase(), category);
  }
}

// ============================================================================
// 关键词相似度计算（BM25风格）
// ============================================================================

/**
 * 计算关键词相似度（BM25风格）
 * 
 * @param skillA 第一个技能
 * @param skillB 第二个技能
 * @returns 相似度分数 0-1
 */
export function computeKeywordSimilarity(
  skillA: SkillForSimilarity,
  skillB: SkillForSimilarity
): { score: number; matches: string[] } {
  // 提取文本
  const textA = `${skillA.name} ${skillA.displayName} ${skillA.description}`.toLowerCase();
  const textB = `${skillB.name} ${skillB.displayName} ${skillB.description}`.toLowerCase();
  
  // 分词（简单空格分割 + 中文分词简化）
  const wordsA = tokenize(textA);
  const wordsB = tokenize(textB);
  
  // 计算词频
  const freqA = getWordFrequency(wordsA);
  const freqB = getWordFrequency(wordsB);
  
  // 获取所有唯一词
  const allWords = new Set([...freqA.keys(), ...freqB.keys()]);
  
  // 计算重叠
  const matches: string[] = [];
  let overlapScore = 0;
  
  for (const word of allWords) {
    const countA = freqA.get(word) || 0;
    const countB = freqB.get(word) || 0;
    
    if (countA > 0 && countB > 0) {
      matches.push(word);
      // BM25风格的加权：词频越高权重越低（避免常见词主导）
      const idf = Math.log(2 / (1 + Math.min(countA, countB)));
      overlapScore += idf * Math.min(countA, countB);
    }
  }
  
  // 归一化
  const maxPossibleScore = Math.min(wordsA.length, wordsB.length);
  const normalizedScore = maxPossibleScore > 0 ? overlapScore / maxPossibleScore : 0;
  
  return {
    score: Math.min(1, normalizedScore),
    matches,
  };
}

/**
 * 简单分词
 */
function tokenize(text: string): string[] {
  // 移除标点符号，分割为词
  const cleaned = text.replace(/[^\w\u4e00-\u9fa5]/g, ' ');
  const words = cleaned.split(/\s+/).filter(w => w.length > 1);
  
  // 中文简单分词（按字符分割，2-3字组合）
  const chineseTokens: string[] = [];
  for (const word of words) {
    if (/[\u4e00-\u9fa5]/.test(word)) {
      // 中文词，生成2-gram和3-gram
      for (let i = 0; i < word.length - 1; i++) {
        chineseTokens.push(word.slice(i, i + 2));
        if (i < word.length - 2) {
          chineseTokens.push(word.slice(i, i + 3));
        }
      }
    } else {
      chineseTokens.push(word);
    }
  }
  
  return chineseTokens;
}

/**
 * 计算词频
 */
function getWordFrequency(words: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const word of words) {
    freq.set(word, (freq.get(word) || 0) + 1);
  }
  return freq;
}

// ============================================================================
// 类别 + CWE 相似度计算
// ============================================================================

/**
 * 计算类别和CWE相似度
 * 
 * @param skillA 第一个技能
 * @param skillB 第二个技能
 * @returns 重叠类型和得分
 */
export function computeCategorySimilarity(
  skillA: SkillForSimilarity,
  skillB: SkillForSimilarity
): { overlapType: OverlapType; overlapScore: number; techStackOverlap: string[] } {
  // 1. 检查完全匹配
  const sameName = skillA.name.toLowerCase() === skillB.name.toLowerCase();
  const sameCategory = skillA.category === skillB.category;
  const sameCWE = skillA.cwe && skillB.cwe && skillA.cwe === skillB.cwe;
  
  if (sameName && sameCategory) {
    return {
      overlapType: 'exact',
      overlapScore: 1.0,
      techStackOverlap: [],
    };
  }
  
  // 2. CWE 匹配（高优先级）
  if (sameCWE) {
    return {
      overlapType: 'semantic-overlap',
      overlapScore: 0.9,
      techStackOverlap: [],
    };
  }
  
  // 3. 类别匹配
  if (sameCategory) {
    // 检查技术栈重叠
    const techStackOverlap = computeTechStackOverlap(skillA.techStack, skillB.techStack);
    
    if (techStackOverlap.length > 0) {
      return {
        overlapType: 'techStack-overlap',
        overlapScore: 0.7 + (techStackOverlap.length * 0.05), // 每个重叠技术栈加5%
        techStackOverlap,
      };
    }
    
    return {
      overlapType: 'semantic-overlap',
      overlapScore: 0.6,
      techStackOverlap: [],
    };
  }
  
  // 4. 技术栈重叠（不同类别）
  const techStackOverlap = computeTechStackOverlap(skillA.techStack, skillB.techStack);
  if (techStackOverlap.length > 0) {
    return {
      overlapType: 'techStack-overlap',
      overlapScore: 0.4 + (techStackOverlap.length * 0.05),
      techStackOverlap,
    };
  }
  
  // 5. 触发词重叠（检查描述中的关键词）
  const triggerOverlap = computeTriggerOverlap(skillA, skillB);
  if (triggerOverlap.length > 0) {
    return {
      overlapType: 'trigger-overlap',
      overlapScore: 0.3 + (triggerOverlap.length * 0.03),
      techStackOverlap: [],
    };
  }
  
  // 无明显重叠
  return {
    overlapType: 'trigger-overlap',
    overlapScore: 0,
    techStackOverlap: [],
  };
}

/**
 * 计算技术栈重叠
 */
function computeTechStackOverlap(
  techStackA: string[],
  techStackB: string[]
): string[] {
  if (!techStackA?.length || !techStackB?.length) {
    return [];
  }
  
  const overlap: string[] = [];
  const normalizedA = techStackA.map(t => t.toLowerCase());
  const normalizedB = techStackB.map(t => t.toLowerCase());
  
  for (let i = 0; i < normalizedA.length; i++) {
    for (let j = 0; j < normalizedB.length; j++) {
      const a = normalizedA[i];
      const b = normalizedB[j];
      
      // 完全匹配或包含匹配
      if (a === b || a.includes(b) || b.includes(a)) {
        overlap.push(techStackA[i]); // 保留原始大小写
        break;
      }
    }
  }
  
  return [...new Set(overlap)]; // 去重
}

/**
 * 计算触发词重叠
 */
function computeTriggerOverlap(
  skillA: SkillForSimilarity,
  skillB: SkillForSimilarity
): string[] {
  const keywordsA = CATEGORY_KEYWORDS[skillA.category] || [];
  const textB = `${skillB.name} ${skillB.displayName} ${skillB.description}`.toLowerCase();
  
  const overlap: string[] = [];
  for (const keyword of keywordsA) {
    if (textB.includes(keyword.toLowerCase())) {
      overlap.push(keyword);
    }
  }
  
  return overlap;
}

// ============================================================================
// 内容深度分析（可选LLM）
// ============================================================================

/**
 * 计算内容相似度（可选LLM分析）
 * 
 * @param skillA 第一个技能
 * @param skillB 第二个技能
 * @param useLLM 是否使用LLM分析
 * @returns 相似度分数 0-1
 */
export async function computeContentSimilarity(
  skillA: SkillForSimilarity,
  skillB: SkillForSimilarity,
  useLLM: boolean = false
): Promise<number> {
  // 如果没有内容，返回0
  if (!skillA.content || !skillB.content) {
    return 0;
  }
  
  // 不使用LLM时，使用简单的文本相似度
  if (!useLLM) {
    return computeTextSimilarity(skillA.content, skillB.content);
  }
  
  // 使用LLM分析（需要实现LLM调用）
  try {
    return await computeLLMContentSimilarity(skillA, skillB);
  } catch (error) {
    console.warn('[SkillSimilarity] LLM分析失败，降级到文本相似度:', error);
    // 降级方案：使用文本相似度
    return computeTextSimilarity(skillA.content, skillB.content);
  }
}

/**
 * 简单文本相似度（Jaccard系数）
 */
function computeTextSimilarity(textA: string, textB: string): number {
  const wordsA = new Set(tokenize(textA.toLowerCase()));
  const wordsB = new Set(tokenize(textB.toLowerCase()));
  
  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);
  
  return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * LLM内容相似度分析
 * 
 * 注意：这是一个占位实现，实际需要调用LLM API
 */
async function computeLLMContentSimilarity(
  skillA: SkillForSimilarity,
  skillB: SkillForSimilarity
): Promise<number> {
  // TODO: 实现LLM调用
  // 这里返回一个基于关键词的简单分数作为占位
  const keywordResult = computeKeywordSimilarity(skillA, skillB);
  return keywordResult.score;
}

// ============================================================================
// 主函数：查找相似技能
// ============================================================================

/**
 * 查找相似技能
 * 
 * @param skill 目标技能
 * @param allSkills 所有技能列表
 * @param thresholds 阈值配置
 * @returns 相似技能列表
 */
export async function findSimilarSkills(
  skill: SkillForSimilarity,
  allSkills: SkillForSimilarity[],
  thresholds: Partial<SimilarityThresholds> = {}
): Promise<SimilarSkill[]> {
  const config = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const results: SimilarSkill[] = [];
  
  for (const candidate of allSkills) {
    // 跳过自己
    if (candidate.id === skill.id) {
      continue;
    }
    
    // 1. 计算关键词相似度
    const keywordResult = computeKeywordSimilarity(skill, candidate);
    
    // 2. 计算类别相似度
    const categoryResult = computeCategorySimilarity(skill, candidate);
    
    // 3. 计算内容相似度（可选）
    let contentScore = 0;
    if (config.enableLLMAnalysis) {
      contentScore = await computeContentSimilarity(skill, candidate, true);
    }
    
    // 4. 计算综合相似度
    const totalScore = 
      keywordResult.score * config.keywordWeight +
      categoryResult.overlapScore * config.categoryWeight +
      contentScore * config.contentWeight;
    
    // 5. 检查是否超过阈值
    if (totalScore >= config.overall) {
      results.push({
        skillId: candidate.id,
        skillName: candidate.name,
        displayName: candidate.displayName,
        category: candidate.category,
        techStack: candidate.techStack,
        cwe: candidate.cwe,
        similarity: totalScore,
        overlapType: categoryResult.overlapType,
        overlapScore: categoryResult.overlapScore,
        keywordScore: keywordResult.score,
        contentScore: config.enableLLMAnalysis ? contentScore : undefined,
        reason: buildReason(keywordResult, categoryResult, totalScore),
      });
    }
  }
  
  // 按相似度排序
  return results.sort((a, b) => b.similarity - a.similarity);
}

/**
 * 构建原因描述
 */
function buildReason(
  keywordResult: { score: number; matches: string[] },
  categoryResult: { overlapType: OverlapType; overlapScore: number; techStackOverlap: string[] },
  totalScore: number
): string {
  const parts: string[] = [];
  
  if (keywordResult.matches.length > 0) {
    parts.push(`关键词匹配: ${keywordResult.matches.slice(0, 5).join(', ')}${keywordResult.matches.length > 5 ? '...' : ''}`);
  }
  
  switch (categoryResult.overlapType) {
    case 'exact':
      parts.push('完全匹配');
      break;
    case 'semantic-overlap':
      parts.push('语义重叠');
      break;
    case 'techStack-overlap':
      if (categoryResult.techStackOverlap.length > 0) {
        parts.push(`技术栈重叠: ${categoryResult.techStackOverlap.join(', ')}`);
      }
      break;
    case 'trigger-overlap':
      parts.push('触发词重叠');
      break;
  }
  
  parts.push(`综合相似度: ${(totalScore * 100).toFixed(0)}%`);
  
  return parts.join(' | ');
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 批量检测技能相似度
 * 
 * @param skills 技能列表
 * @param thresholds 阈值配置
 * @returns 相似技能对列表
 */
export async function findAllSimilarPairs(
  skills: SkillForSimilarity[],
  thresholds: Partial<SimilarityThresholds> = {}
): Promise<Array<{ skillA: SkillForSimilarity; skillB: SkillForSimilarity; similarity: SimilarSkill }>> {
  const config = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const pairs: Array<{ skillA: SkillForSimilarity; skillB: SkillForSimilarity; similarity: SimilarSkill }> = [];
  
  // 两两比较
  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const similarSkills = await findSimilarSkills(skills[i], [skills[j]], config);
      if (similarSkills.length > 0) {
        pairs.push({
          skillA: skills[i],
          skillB: skills[j],
          similarity: similarSkills[0],
        });
      }
    }
  }
  
  // 按相似度排序
  return pairs.sort((a, b) => b.similarity.similarity - a.similarity.similarity);
}

/**
 * 检查技能是否与现有技能重复
 * 
 * @param newSkill 新技能
 * @param existingSkills 现有技能列表
 * @param thresholds 阈值配置
 * @returns 是否重复及原因
 */
export async function checkSkillDuplication(
  newSkill: SkillForSimilarity,
  existingSkills: SkillForSimilarity[],
  thresholds: Partial<SimilarityThresholds> = {}
): Promise<{ isDuplicate: boolean; similarSkills: SimilarSkill[]; reason: string }> {
  const similarSkills = await findSimilarSkills(newSkill, existingSkills, thresholds);
  
  // 检查是否有完全匹配
  const exactMatch = similarSkills.find(s => s.overlapType === 'exact');
  if (exactMatch) {
    return {
      isDuplicate: true,
      similarSkills,
      reason: `存在完全匹配的技能: ${exactMatch.displayName} (${exactMatch.skillName})`,
    };
  }
  
  // 检查是否有高相似度
  const highSimilarity = similarSkills.filter(s => s.similarity >= 0.85);
  if (highSimilarity.length > 0) {
    return {
      isDuplicate: true,
      similarSkills,
      reason: `存在高相似度技能: ${highSimilarity.map(s => s.displayName).join(', ')}`,
    };
  }
  
  return {
    isDuplicate: false,
    similarSkills,
    reason: similarSkills.length > 0 
      ? `发现 ${similarSkills.length} 个相似技能，但相似度未达到重复阈值`
      : '未发现相似技能',
  };
}