/**
 * Skill LLM 深度分析服务
 * 使用 LLM 判断两个 Skill 是否真正功能重复
 */

import { routeRequest } from '@/lib/claude-router/router';

// ============================================================================
// Types
// ============================================================================

/**
 * 用于 LLM 分析的技能数据
 */
export interface SkillForLLMAnalysis {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  techStack: string[];
  cwe?: string | null;
  content?: string;
  triggers?: string[];
}

/**
 * LLM 分析结果
 */
export interface LLMAnalysisResult {
  isDuplicate: boolean;           // 是否真正的重复
  confidence: number;             // 置信度 0-1
  overlapType: 'exact' | 'subset' | 'related' | 'distinct';
  reason: string;                 // LLM 给出的判断理由
  recommendation: 'merge' | 'keep_separate' | 'review';
  keyDifferences?: string[];      // 主要差异点
  sharedFunctionality?: string[]; // 共享功能
}

/**
 * 批量分析结果
 */
export interface BatchAnalysisResult {
  total: number;
  duplicates: number;
  related: number;
  distinct: number;
  results: Array<{
    skillA: string;
    skillB: string;
    analysis: LLMAnalysisResult;
  }>;
}

// ============================================================================
// Prompt 模板
// ============================================================================

const ANALYSIS_SYSTEM_PROMPT = `你是一个 Skill 治理专家，负责判断两个 AI Skill 是否真正功能重复。

**重要概念**:
- **Skill**: AI 助手使用的技能定义，包含触发条件、执行规则、参考知识等
- **功能重复**: 两个 Skill 在相同场景下会产生相同的分析结果或行为
- **设计差异**: 同一系列但针对不同语言/框架的 Skill（如 Java 审计 vs Python 审计）

**判断标准**:
1. **exact (完全重复)**: 名称、描述、内容都高度相似，功能完全重叠
2. **subset (子集关系)**: 一个 Skill 的功能是另一个的子集
3. **related (相关但独立)**: 同类别但针对不同目标（如不同语言/框架）
4. **distinct (完全不同)**: 功能不重叠或重叠极少

**关键考虑**:
- 多语言模板系列（如 checklists-java, checklists-python）是**设计差异**，不是重复
- 通用审计 vs 特定漏洞深度检测是**功能互补**，不是重复
- 同语言同框架的多个审计 Skill 可能是**重复**
- 内容相似但触发条件不同的 Skill 可能是**互补**

请用中文回答，给出清晰的判断理由。`;

function buildAnalysisPrompt(skillA: SkillForLLMAnalysis, skillB: SkillForLLMAnalysis): string {
  const truncateContent = (content: string | undefined, maxLen: number = 2000): string => {
    if (!content) return '无';
    if (content.length <= maxLen) return content;
    return content.substring(0, maxLen) + '\n... (已截断)';
  };

  return `请分析以下两个 Skill 是否真正功能重复：

## Skill A
- **名称**: ${skillA.name}
- **显示名**: ${skillA.displayName}
- **描述**: ${skillA.description}
- **类别**: ${skillA.category}
- **技术栈**: ${skillA.techStack.join(', ') || '无'}
- **CWE**: ${skillA.cwe || '无'}
- **触发词**: ${skillA.triggers?.join(', ') || '无'}
- **内容摘要**:
\`\`\`
${truncateContent(skillA.content)}
\`\`\`

## Skill B
- **名称**: ${skillB.name}
- **显示名**: ${skillB.displayName}
- **描述**: ${skillB.description}
- **类别**: ${skillB.category}
- **技术栈**: ${skillB.techStack.join(', ') || '无'}
- **CWE**: ${skillB.cwe || '无'}
- **触发词**: ${skillB.triggers?.join(', ') || '无'}
- **内容摘要**:
\`\`\`
${truncateContent(skillB.content)}
\`\`\`

## 请回答

1. **是否重复**: [是/否]
2. **重叠类型**: [exact/subset/related/distinct]
3. **置信度**: [0.0-1.0]
4. **建议操作**: [merge/keep_separate/review]
5. **判断理由**: [简要说明为什么这样判断]
6. **主要差异**: [列出2-3个关键差异点，如果有的话]
7. **共享功能**: [列出重叠的功能点，如果有的话]

请以 JSON 格式输出：
\`\`\`json
{
  "isDuplicate": boolean,
  "overlapType": "exact" | "subset" | "related" | "distinct",
  "confidence": number,
  "recommendation": "merge" | "keep_separate" | "review",
  "reason": "string",
  "keyDifferences": ["string"],
  "sharedFunctionality": ["string"]
}
\`\`\``;
}

// ============================================================================
// LLM 调用
// ============================================================================

/**
 * 调用 LLM 分析两个 Skill 是否重复
 */
export async function analyzeSkillDuplication(
  skillA: SkillForLLMAnalysis,
  skillB: SkillForLLMAnalysis
): Promise<LLMAnalysisResult> {
  try {
    const prompt = buildAnalysisPrompt(skillA, skillB);
    
    const request = {
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: 1024,
      temperature: 0.3, // 低温度以保证稳定性
    };

    console.log(`[SkillLLMAnalysis] 分析: ${skillA.name} vs ${skillB.name}`);
    
    const response = await routeRequest(request);
    
    // 解析 LLM 响应
    const content = response.content?.[0]?.text || response.choices?.[0]?.message?.content || '';
    
    // 提取 JSON
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || 
                      content.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      console.warn('[SkillLLMAnalysis] 无法解析 LLM 响应，使用默认值');
      return createDefaultResult(skillA, skillB);
    }
    
    const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    
    return {
      isDuplicate: parsed.isDuplicate ?? false,
      confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.5)),
      overlapType: parsed.overlapType || 'related',
      reason: parsed.reason || 'LLM 未给出理由',
      recommendation: parsed.recommendation || 'review',
      keyDifferences: parsed.keyDifferences || [],
      sharedFunctionality: parsed.sharedFunctionality || [],
    };
    
  } catch (error) {
    console.error('[SkillLLMAnalysis] LLM 分析失败:', error);
    return createDefaultResult(skillA, skillB);
  }
}

/**
 * 创建默认结果（LLM 调用失败时）
 */
function createDefaultResult(
  skillA: SkillForLLMAnalysis,
  skillB: SkillForLLMAnalysis
): LLMAnalysisResult {
  // 简单启发式判断
  const sameCategory = skillA.category === skillB.category;
  const sameTechStack = skillA.techStack.some(t => skillB.techStack.includes(t));
  const sameCWE = skillA.cwe && skillB.cwe && skillA.cwe === skillB.cwe;
  
  let overlapType: LLMAnalysisResult['overlapType'] = 'distinct';
  let recommendation: LLMAnalysisResult['recommendation'] = 'keep_separate';
  
  if (sameCWE) {
    overlapType = 'related';
    recommendation = 'review';
  } else if (sameCategory && sameTechStack) {
    overlapType = 'related';
    recommendation = 'review';
  } else if (sameCategory) {
    overlapType = 'related';
  }
  
  return {
    isDuplicate: false,
    confidence: 0.3,
    overlapType,
    reason: 'LLM 分析失败，使用启发式判断',
    recommendation,
    keyDifferences: ['无法获取详细信息'],
    sharedFunctionality: [],
  };
}

// ============================================================================
// 批量分析
// ============================================================================

/**
 * 批量分析技能对
 * 
 * @param pairs 技能对列表
 * @param options 选项
 * @returns 批量分析结果
 */
export async function batchAnalyzeSkills(
  pairs: Array<{ skillA: SkillForLLMAnalysis; skillB: SkillForLLMAnalysis }>,
  options: {
    concurrency?: number;      // 并发数，默认 3
    skipCache?: boolean;       // 是否跳过缓存
    onProgress?: (current: number, total: number) => void;
  } = {}
): Promise<BatchAnalysisResult> {
  const { concurrency = 3, onProgress } = options;
  const results: BatchAnalysisResult['results'] = [];
  
  let duplicates = 0;
  let related = 0;
  let distinct = 0;
  
  // 分批处理
  for (let i = 0; i < pairs.length; i += concurrency) {
    const batch = pairs.slice(i, i + concurrency);
    
    // 并发执行
    const batchResults = await Promise.all(
      batch.map(async (pair) => {
        const analysis = await analyzeSkillDuplication(pair.skillA, pair.skillB);
        return {
          skillA: pair.skillA.id,
          skillB: pair.skillB.id,
          analysis,
        };
      })
    );
    
    // 统计
    for (const result of batchResults) {
      results.push(result);
      
      if (result.analysis.isDuplicate) {
        duplicates++;
      } else if (result.analysis.overlapType === 'related') {
        related++;
      } else {
        distinct++;
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
    related,
    distinct,
    results,
  };
}

// ============================================================================
// 智能过滤
// ============================================================================

/**
 * 过滤出真正需要 LLM 分析的技能对
 * 
 * 全量分析模式：只要同类别且预相似度达到最低阈值就保留
 * 让 LLM 来判断是否真正重复，而不是预先过滤
 */
export function filterPairsForLLMAnalysis(
    pairs: Array<{ 
      skillA: SkillForLLMAnalysis; 
      skillB: SkillForLLMAnalysis;
      preliminarySimilarity?: number;
    }>,
    options: {
      minPreliminarySimilarity?: number;  // 最小预相似度，默认 0.2
      skipDifferentCategory?: boolean;     // 跳过不同类别的，默认 true
    } = {}
  ): Array<{ skillA: SkillForLLMAnalysis; skillB: SkillForLLMAnalysis; preliminarySimilarity?: number }> {
    const { 
      minPreliminarySimilarity = 0.2,  // 降低到最低阈值
      skipDifferentCategory = true 
    } = options;
    
    return pairs.filter(pair => {
      // 跳过不同类别（可选）
      if (skipDifferentCategory && pair.skillA.category !== pair.skillB.category) {
        return false;
      }
      
      // 只检查预相似度是否达标
      const prelimSim = pair.preliminarySimilarity ?? 0;
      return prelimSim >= minPreliminarySimilarity;
    }).map(pair => ({
      skillA: pair.skillA,
      skillB: pair.skillB,
      preliminarySimilarity: pair.preliminarySimilarity,
    }));
  }

// ============================================================================
// 导出
// ============================================================================

export default {
  analyzeSkillDuplication,
  batchAnalyzeSkills,
  filterPairsForLLMAnalysis,
};
