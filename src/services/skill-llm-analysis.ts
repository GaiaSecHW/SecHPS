/**
 * Skill LLM 深度分析服务
 * 使用 LLM 判断两个 Skill 是否真正功能重复
 */

import { routeRequestWithDefaultModel } from '@/lib/model-client';
import type { TokenUsageContext } from '@/types/call-scene';

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
  techStackId?: string | null;
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
  entryPointComparison?: {        // 入口点比较（可选）
    sameEntryPoint: boolean;
    skillAEntryPoint?: string;
    skillBEntryPoint?: string;
    details?: string;
  };
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

/**
 * 清理 JSON 字符串中的控制字符
 * 解决 LLM 返回的 JSON 中字符串值包含未转义换行符的问题
 */
function cleanJsonString(jsonStr: string): string {
  let result = '';
  let inString = false;
  let i = 0;
  
  while (i < jsonStr.length) {
    const char = jsonStr[i];
    
    // 检查是否进入或退出字串模式
    if (char === '"' && (i === 0 || jsonStr[i - 1] !== '\\')) {
      inString = !inString;
      result += char;
    } else if (inString) {
      // 字串内，转义未转义的控制字符
      if (char === '\n') {
        result += '\\n';
      } else if (char === '\r') {
        result += '\\r';
      } else if (char === '\t') {
        result += '\\t';
      } else {
        result += char;
      }
    } else {
      result += char;
    }
    i++;
  }
  
  return result;
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

**输出格式要求**:
你必须只输出一个有效的 JSON 对象，不要输出任何其他文字、解释或 markdown 标记。
JSON 必须包含以下字段：isDuplicate, overlapType, confidence, recommendation, reason, keyDifferences, sharedFunctionality。`;

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
- **CWE**: ${skillB.cwe || '无'}
- **触发词**: ${skillB.triggers?.join(', ') || '无'}
- **内容摘要**:
\`\`\`
${truncateContent(skillB.content)}
\`\`\`

## 输出格式

**重要**: 只输出 JSON 对象，不要输出任何其他内容。不要使用 markdown 代码块标记。

示例输出格式:
{"isDuplicate":false,"overlapType":"related","confidence":0.7,"recommendation":"keep_separate","reason":"两个 Skill 针对不同编程语言，属于设计差异","keyDifferences":["技术栈不同","检测方法有差异"],"sharedFunctionality":["都是代码审计","都检查类似漏洞类型"]}

请输出你的分析结果 JSON:`;
}

// ============================================================================
// LLM 调用
// ============================================================================

/**
 * 调用 LLM 分析两个 Skill 是否重复
 */
export async function analyzeSkillDuplication(
  skillA: SkillForLLMAnalysis,
  skillB: SkillForLLMAnalysis,
  context?: TokenUsageContext
): Promise<LLMAnalysisResult> {
  try {
    const prompt = buildAnalysisPrompt(skillA, skillB);
    
    console.log(`[SkillLLMAnalysis] 分析: ${skillA.name} vs ${skillB.name}`);
    
    const response = await routeRequestWithDefaultModel(
      [{ role: 'user', content: prompt }],
      {
        max_tokens: 1024,
        temperature: 0.3, // 低温度以保证稳定性
        context: context || {
          userId: 'system',
          scene: 'other',
          description: `Skill分析: ${skillA.name} vs ${skillB.name}`,
        },
      }
    );
    
    // 解析 LLM 响应 - 支持 OpenAI 和 Claude 格式
    let content = '';
    
    // 调试：打印完整响应结构
    try {
      console.log('[SkillLLMAnalysis] response type:', typeof response);
      console.log('[SkillLLMAnalysis] response is null:', response === null);
      console.log('[SkillLLMAnalysis] response is undefined:', response === undefined);
      if (response) {
        console.log('[SkillLLMAnalysis] response keys:', Object.keys(response));
        console.log('[SkillLLMAnalysis] response JSON:', JSON.stringify(response).substring(0, 2000));
      }
    } catch (e) {
      console.error('[SkillLLMAnalysis] 无法序列化 response:', e);
    }
    
    // Claude 格式: response.content[0].text
    if (response?.content?.[0]?.text) {
      content = response.content[0].text;
      console.log('[SkillLLMAnalysis] 使用 Claude 格式解析');
    }
    // OpenAI 格式: response.choices[0].message.content
    else if (response?.choices?.[0]?.message?.content) {
      content = response.choices[0].message.content;
      console.log('[SkillLLMAnalysis] 使用 OpenAI 格式解析');
    }
    // 某些模型可能直接在 response.text 返回
    else if (response?.text) {
      content = response.text;
      console.log('[SkillLLMAnalysis] 使用 response.text 解析');
    }
    // 某些模型可能在 response.result 返回
    else if (response?.result) {
      content = typeof response.result === 'string' ? response.result : JSON.stringify(response.result);
      console.log('[SkillLLMAnalysis] 使用 response.result 解析');
    }
    // 某些模型可能在 response.output 返回
    else if (response?.output) {
      content = typeof response.output === 'string' ? response.output : JSON.stringify(response.output);
      console.log('[SkillLLMAnalysis] 使用 response.output 解析');
    }
    // 兜底
    else if (typeof response === 'string') {
      content = response;
      console.log('[SkillLLMAnalysis] 使用字符串格式解析');
    }
    // 最后尝试：直接 JSON 序列化整个响应
    else {
      content = JSON.stringify(response);
      console.log('[SkillLLMAnalysis] 使用 JSON.stringify 兜底解析');
    }
    
    console.log(`[SkillLLMAnalysis] LLM 原始响应 (前500字符): ${content.substring(0, 500)}`);
    
    // 多种方式提取 JSON
    let parsed: any = null;
    
    // 方式1: 从 ```json 代码块提取
    const jsonBlockMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonBlockMatch) {
      try {
        parsed = JSON.parse(jsonBlockMatch[1].trim());
        console.log('[SkillLLMAnalysis] 从 ```json 代码块解析成功');
      } catch (e) {
        console.warn('[SkillLLMAnalysis] ```json 代码块解析失败:', e);
      }
    }
    
    // 方式2: 从 ``` 代码块提取（无 json 标记）
    if (!parsed) {
      const codeBlockMatch = content.match(/```\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        try {
          parsed = JSON.parse(codeBlockMatch[1].trim());
          console.log('[SkillLLMAnalysis] 从 ``` 代码块解析成功');
        } catch (e) {
          // 忽略，继续尝试其他方式
        }
      }
    }
    
    // 方式3: 查找独立的 JSON 对象
    if (!parsed) {
      // 查找以 { 开头的 JSON
      const jsonStart = content.indexOf('{');
      const jsonEnd = content.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        const jsonStr = content.substring(jsonStart, jsonEnd + 1);
        try {
          // 清理 JSON 中的控制字符
          const cleanedJson = cleanJsonString(jsonStr);
          parsed = JSON.parse(cleanedJson);
          console.log('[SkillLLMAnalysis] 从独立 JSON 对象解析成功');
        } catch (e) {
          console.warn('[SkillLLMAnalysis] 独立 JSON 解析失败:', e);
          // 打印有问题的 JSON 片段帮助调试
          console.warn('[SkillLLMAnalysis] JSON 内容 (前200字符):', jsonStr.substring(0, 200));
        }
      }
    }
    
    // 方式4: 逐行查找 JSON
    if (!parsed) {
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
          try {
            parsed = JSON.parse(trimmed);
            console.log('[SkillLLMAnalysis] 从单行 JSON 解析成功');
            break;
          } catch (e) {
            // 继续尝试下一行
          }
        }
      }
    }
    
    if (!parsed) {
      console.warn('[SkillLLMAnalysis] 无法从 LLM 响应解析 JSON，使用默认值');
      console.warn('[SkillLLMAnalysis] 完整响应内容:', content);
      return createDefaultResult(skillA, skillB);
    }
    
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
  const sameCWE = skillA.cwe && skillB.cwe && skillA.cwe === skillB.cwe;

  let overlapType: LLMAnalysisResult['overlapType'] = 'distinct';
  let recommendation: LLMAnalysisResult['recommendation'] = 'keep_separate';

  if (sameCWE) {
    overlapType = 'related';
    recommendation = 'review';
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
    onResult?: (result: { skillA: string; skillB: string; analysis: LLMAnalysisResult }) => void;
  } = {}
): Promise<BatchAnalysisResult> {
  const { concurrency = 3, onProgress, onResult } = options;
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
    
    // 统计并回调
    for (const result of batchResults) {
      results.push(result);
      
      if (result.analysis.isDuplicate) {
        duplicates++;
      } else if (result.analysis.overlapType === 'related') {
        related++;
      } else {
        distinct++;
      }
      
      // 每个结果完成后的回调
      if (onResult) {
        onResult(result);
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
      minPreliminarySimilarity?: number;
    } = {}
  ): Array<{ skillA: SkillForLLMAnalysis; skillB: SkillForLLMAnalysis; preliminarySimilarity?: number }> {
    const { minPreliminarySimilarity = 0.2 } = options;
    
    return pairs.filter(pair => {
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
