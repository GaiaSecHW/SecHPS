/**
 * Skill 平衡分析服务
 * 使用 LLM 同时分析误报和正确发现，给出平衡改进建议
 */

import { routeRequestWithDefaultModel } from '@/lib/model-client';
import { logger, LOG_MODULES } from '@/lib/logger';
import type { TokenUsageContext } from '@/types/call-scene';
import type { CompactCase } from './case-extractor';
import { DEFAULT_EVOLUTION_CONFIG } from './evolution-scheduler';
import { getEvolutionPrompt } from './prompt-manager';

// ============================================================================
// Types
// ============================================================================

/**
 * 平衡分析结果
 */
export interface BalanceAnalysisResult {
  // 误报分析
  falsePositivePatterns: string[];      // 误报的共同模式
  falsePositiveCauses: string[];        // 误判原因
  
  // 正确发现分析
  confirmedPatterns: string[];          // 正确发现的共同模式
  confirmedStrengths: string[];         // 必须保留的规则
  
  // 平衡建议
  recommendations: Array<{
    type: 'add_rule' | 'modify_rule' | 'add_exception' | 'refine_pattern';
    description: string;
    impact: 'reduce_false_positive' | 'maintain_detection' | 'both';
  }>;
  
  // 警告
  warnings: string[];                   // 如"此改进可能影响召回率"
}

/**
 * 平衡分析选项
 */
export interface BalanceAnalysisOptions {
  context?: TokenUsageContext;
  maxTokens?: number;
  temperature?: number;
  previousFailure?: string;
  missedCases?: CompactCase[];
  remainingFalsePositives?: CompactCase[];
}

/**
 * LLM 响应格式（支持多种模型）
 */
interface LlmResponse {
  content?: Array<{ text: string }>;
  choices?: Array<{ message: { content: string } }>;
  text?: string;
  result?: string | object;
  output?: string | object;
}

/**
 * LLM 解析后的分析结果
 */
interface ParsedAnalysisResult {
  falsePositivePatterns?: string[];
  falsePositiveCauses?: string[];
  confirmedPatterns?: string[];
  confirmedStrengths?: string[];
  recommendations?: Array<{
    type?: string;
    description?: string;
    impact?: string;
  }>;
  warnings?: string[];
  finalRecommendations?: Array<{
    type?: string;
    description?: string;
    impact?: string;
  }>;
  additionalWarnings?: string[];
}

// ============================================================================
// Prompt 模板
// ============================================================================

const BALANCE_ANALYSIS_SYSTEM_PROMPT = `你是一个安全检测专家，负责分析 Skill 的误报案例，给出排除规则建议。

**重要概念**:
- **Skill**: AI 助手使用的技能定义，包含触发条件、执行规则、参考知识等
- **误报 (False Positive)**: Skill 判断为漏洞，但实际不是漏洞的案例
- **改进目标**: 找出误报的共同特点，生成排除规则，减少误报

**分析目标**:
1. 找出误报的共同特点，理解为什么误判
2. 分析这些误报案例的共性模式
3. 给出具体的排除规则建议
4. 指出改进可能带来的风险

**输出格式要求**:
你必须只输出一个有效的 JSON 对象，不要输出任何其他文字、解释或 markdown 标记。
JSON 必须包含以下字段：falsePositivePatterns, falsePositiveCauses, confirmedPatterns, confirmedStrengths, recommendations, warnings。
confirmedPatterns 和 confirmedStrengths 返回空数组。`;

/**
 * 构建分析 Prompt（方案A：只分析误报）
 */
function buildBalanceAnalysisPrompt(
  skillContent: string,
  falsePositives: CompactCase[]
): string {
  const truncateContent = (content: string, maxLen: number = DEFAULT_EVOLUTION_CONFIG.MAX_CONTENT_LENGTH): string => {
    if (content.length <= maxLen) return content;
    return content.substring(0, maxLen) + '\n... (已截断)';
  };

  const formatCases = (cases: CompactCase[]): string => {
    if (cases.length === 0) {
      return '无误报案例';
    }
    
    return cases.map((c, i) => {
      const parts = [
        `### 案例 ${i + 1}: ${c.title}`,
        `- **描述**: ${c.description}`,
      ];
      
      if (c.falsePositiveReason) {
        parts.push(`- **误报原因**: ${c.falsePositiveReason}`);
      }
      
      if (c.location) {
        parts.push(`- **源代码**:`);
        parts.push('```');
        parts.push(c.location);
        parts.push('```');
      }
      
      return parts.join('\n');
    }).join('\n\n');
  };

  return `请分析以下 Skill 的误报案例：

## Skill 定义
\`\`\`
${truncateContent(skillContent)}
\`\`\`

## 误报案例（需要排除）
${formatCases(falsePositives)}
→ 这些被误判为漏洞，实际上不是漏洞

请分析：
1. 这些误报案例的共同特点是什么？
2. 为什么 Skill 会误判这些案例？
3. 如何添加排除规则来避免这些误报？
4. 添加排除规则可能带来什么风险？

## 输出格式

**重要**: 只输出 JSON 对象，不要输出任何其他内容。不要使用 markdown 代码块标记。

示例输出格式:
{"falsePositivePatterns":["模式1","模式2"],"falsePositiveCauses":["原因1","原因2"],"confirmedPatterns":[],"confirmedStrengths":[],"recommendations":[{"type":"add_exception","description":"添加排除规则","impact":"reduce_false_positive"}],"warnings":["可能的风险"]}

请输出你的分析结果 JSON:`;
}

/**
 * 从模板构建分析 Prompt（替换占位符，方案A：只分析误报）
 */
function buildBalanceAnalysisPromptFromTemplate(
  template: string,
  skillContent: string,
  falsePositives: CompactCase[],
  options?: BalanceAnalysisOptions
): string {
  const truncateContent = (content: string, maxLen: number = DEFAULT_EVOLUTION_CONFIG.MAX_CONTENT_LENGTH): string => {
    if (content.length <= maxLen) return content;
    return content.substring(0, maxLen) + '\n... (已截断)';
  };

  const formatCases = (cases: CompactCase[]): string => {
    if (cases.length === 0) {
      return '无误报案例';
    }
    
    return cases.map((c, i) => {
      const parts = [
        `### 案例 ${i + 1}: ${c.title}`,
        `- **描述**: ${c.description}`,
      ];
      
      if (c.falsePositiveReason) {
        parts.push(`- **误报原因**: ${c.falsePositiveReason}`);
      }
      
      if (c.location) {
        parts.push(`- **源代码**:`);
        parts.push('```');
        parts.push(c.location);
        parts.push('```');
      }
      
      return parts.join('\n');
    }).join('\n\n');
  };

  // 构建失败信息部分（用于反馈驱动）
  const buildFailureContext = (): string => {
    if (!options?.previousFailure && 
        (!options?.missedCases || options.missedCases.length === 0) &&
        (!options?.remainingFalsePositives || options.remainingFalsePositives.length === 0)) {
      return '';
    }

    const parts = ['## 上次尝试失败信息（重要！）'];
    
    if (options.previousFailure) {
      parts.push(`\n### 失败原因\n${options.previousFailure}`);
    }
    
    if (options.missedCases && options.missedCases.length > 0) {
      parts.push('\n### 漏检问题（必须修复）');
      parts.push('以下确认的漏洞案例未被检出，这是硬性要求：');
      options.missedCases.forEach((c, i) => {
        parts.push(`${i + 1}. ${c.title}: ${c.description}`);
      });
      parts.push('\n**请分析为什么这些案例未被检出，确保改进后能够检出。**');
    }
    
    if (options.remainingFalsePositives && options.remainingFalsePositives.length > 0) {
      parts.push('\n### 误报排除问题');
      parts.push('以下案例仍被误报，需要加强排除规则：');
      options.remainingFalsePositives.forEach((c, i) => {
        parts.push(`${i + 1}. ${c.title}: ${c.description}`);
      });
    }
    
    return parts.join('\n');
  };

  const failureContext = buildFailureContext();

  // 如果模板为空，使用硬编码构建函数
  if (!template || template.trim() === '') {
    const basePrompt = buildBalanceAnalysisPrompt(skillContent, falsePositives);
    if (failureContext) {
      return failureContext + '\n\n' + basePrompt;
    }
    return basePrompt;
  }

  // 替换占位符（只替换误报相关）
  let prompt = template
    .replace('{{SKILL_CONTENT}}', truncateContent(skillContent))
    .replace('{{FALSE_POSITIVE_CASES}}', formatCases(falsePositives));

  // 添加失败信息（如果有）
  if (failureContext) {
    prompt = failureContext + '\n\n' + prompt;
  }

  return prompt;
}

// ============================================================================
// JSON 解析辅助函数
// ============================================================================

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

/**
 * 从 LLM 响应中提取内容
 */
function extractContent(response: LlmResponse): string {
  // Claude 格式: response.content[0].text
  if (response?.content?.[0]?.text) {
    return response.content[0].text;
  }
  // OpenAI 格式: response.choices[0].message.content
  if (response?.choices?.[0]?.message?.content) {
    return response.choices[0].message.content;
  }
  // 某些模型可能直接在 response.text 返回
  if (response?.text) {
    return response.text;
  }
  // 某些模型可能在 response.result 返回
  if (response?.result) {
    return typeof response.result === 'string' ? response.result : JSON.stringify(response.result);
  }
  // 某些模型可能在 response.output 返回
  if (response?.output) {
    return typeof response.output === 'string' ? response.output : JSON.stringify(response.output);
  }
  // 最后尝试：直接 JSON 序列化整个响应
  return JSON.stringify(response);
}

/**
 * 从内容中解析 JSON
 */
function parseJsonFromContent(content: string): ParsedAnalysisResult | null {
  // 方式1: 从 ```json 代码块提取
  const jsonBlockMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1].trim());
    } catch {
      // 继续尝试其他方式
    }
  }
  
  // 方式2: 从 ``` 代码块提取（无 json 标记）
  const codeBlockMatch = content.match(/```\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // 继续尝试其他方式
    }
  }
  
  // 方式3: 查找独立的 JSON 对象
  const jsonStart = content.indexOf('{');
  const jsonEnd = content.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    const jsonStr = content.substring(jsonStart, jsonEnd + 1);
    try {
      // 清理 JSON 中的控制字符
      const cleanedJson = cleanJsonString(jsonStr);
      return JSON.parse(cleanedJson);
    } catch {
      // 继续尝试其他方式
    }
  }
  
  // 方式4: 逐行查找 JSON
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // 继续尝试下一行
      }
    }
  }
  
  return null;
}

/**
 * 创建默认结果（LLM 调用失败时）
 */
function createDefaultResult(): BalanceAnalysisResult {
  return {
    falsePositivePatterns: [],
    falsePositiveCauses: ['LLM 分析失败，无法获取误报原因'],
    confirmedPatterns: [],
    confirmedStrengths: [],
    recommendations: [],
    warnings: ['建议人工审核误报案例'],
  };
}

// ============================================================================
// 主函数
// ============================================================================

/**
 * 分析 Skill 的误报案例，给出排除规则建议（方案A）
 *
 * @param skillContent Skill 定义内容
 * @param falsePositives 误报案例列表
 * @param options 分析选项
 * @returns 平衡分析结果
 */
export async function analyzeBalance(
  skillContent: string,
  falsePositives: CompactCase[],
  options?: BalanceAnalysisOptions
): Promise<BalanceAnalysisResult> {
  try {
    // 从数据库获取提示词（优先使用数据库配置）
    const systemPrompt = await getEvolutionPrompt('balance_analysis_system');
    const userPromptTemplate = await getEvolutionPrompt('balance_analysis_user_template');
    
    // 构建用户提示词
    const prompt = buildBalanceAnalysisPromptFromTemplate(
      userPromptTemplate,
      skillContent,
      falsePositives,
      options
    );
    
    logger.info(LOG_MODULES.SKILL_EVOLUTION, `开始分析: ${falsePositives.length} 误报案例`);
    
    const response = await routeRequestWithDefaultModel(
      [{ role: 'user', content: prompt }],
      {
        system: systemPrompt || BALANCE_ANALYSIS_SYSTEM_PROMPT,
        ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        context: options?.context ?? {
          userId: 'system',
          scene: 'skill-optimize',
          description: 'Skill 误报分析',
        },
      }
    );
    
    // 提取内容
    const content = extractContent(response);
    
    logger.debug(LOG_MODULES.SKILL_EVOLUTION, `LLM 原始响应 (前${DEFAULT_EVOLUTION_CONFIG.LOG_PREVIEW_LENGTH}字符): ${content.substring(0, DEFAULT_EVOLUTION_CONFIG.LOG_PREVIEW_LENGTH)}`);
    
    // 解析 JSON
    const parsed = parseJsonFromContent(content);
    
    if (!parsed) {
      logger.warn(LOG_MODULES.SKILL_EVOLUTION, '无法从 LLM 响应解析 JSON，使用默认值');
      logger.warn(LOG_MODULES.SKILL_EVOLUTION, `完整响应内容: ${content}`);
      return createDefaultResult();
    }
    
    // 构建结果（confirmedPatterns 和 confirmedStrengths 返回空数组）
    const result: BalanceAnalysisResult = {
      falsePositivePatterns: parsed.falsePositivePatterns ?? [],
      falsePositiveCauses: parsed.falsePositiveCauses ?? [],
      confirmedPatterns: [],
      confirmedStrengths: [],
      recommendations: (parsed.recommendations ?? []).map((r) => ({
        type: (r.type as BalanceAnalysisResult['recommendations'][0]['type']) ?? 'add_exception',
        description: r.description ?? '',
        impact: (r.impact as BalanceAnalysisResult['recommendations'][0]['impact']) ?? 'reduce_false_positive',
      })),
      warnings: parsed.warnings ?? [],
    };
    
    logger.info(LOG_MODULES.SKILL_EVOLUTION, `分析完成: ${result.recommendations.length} 条排除规则建议`);
    
    return result;
    
  } catch (error) {
    logger.error(LOG_MODULES.SKILL_EVOLUTION, 'LLM 分析失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return createDefaultResult();
  }
}

/**
 * 分批分析 Skill 的误报案例（方案A）
 * 正确案例仍传入用于回测，但分析阶段只分析误报
 *
 * @param skillContent Skill 定义内容
 * @param falsePositives 误报案例列表
 * @param confirmedCases 正确发现案例列表（用于回测验证，不参与分析）
 * @param options 分析选项（包含 batchSize）
 * @returns 平衡分析结果
 */
export async function analyzeInBatches(
  skillContent: string,
  falsePositives: CompactCase[],
  confirmedCases: CompactCase[],
  options?: BalanceAnalysisOptions & { batchSize?: number }
): Promise<BalanceAnalysisResult> {
  const batchSize = options?.batchSize ?? 2;
  const batchResults: BalanceAnalysisResult[] = [];

  // 只对误报案例分批，正确案例不参与分析
  const fpBatches: CompactCase[][] = [];

  if (falsePositives.length <= batchSize) {
    fpBatches.push(falsePositives);
  } else {
    for (let i = 0; i < falsePositives.length; i += batchSize) {
      fpBatches.push(falsePositives.slice(i, i + batchSize));
    }
  }

  const totalBatches = fpBatches.length;

  logger.info(LOG_MODULES.SKILL_EVOLUTION, `分批分析: ${falsePositives.length}个误报案例, 共${totalBatches}批次`);
  logger.info(LOG_MODULES.SKILL_EVOLUTION, `正确发现案例: ${confirmedCases.length}个（用于回测验证，不参与分析）`);

  for (let i = 0; i < totalBatches; i++) {
    const fpBatch = fpBatches[i];

    if (fpBatch.length === 0) continue;

    logger.info(LOG_MODULES.SKILL_EVOLUTION, `分析批次 ${i + 1}/${totalBatches}: ${fpBatch.length}个误报案例`);

    // 只传递误报案例进行分析（方案A）
    const batchResult = await analyzeBalance(skillContent, fpBatch, {
      ...options,
      previousFailure: i === 0 ? options?.previousFailure : undefined,
      missedCases: i === 0 ? options?.missedCases : undefined,
      remainingFalsePositives: i === 0 ? options?.remainingFalsePositives : undefined,
    });

    batchResults.push(batchResult);
  }

  const mergedResult = mergeBatchResults(batchResults);

  if (batchResults.length > 1) {
    logger.info(LOG_MODULES.SKILL_EVOLUTION, `综合 ${batchResults.length} 批次结果，生成最终建议`);
    const synthesisResult = await synthesizeResults(skillContent, mergedResult);
    return synthesisResult;
  }

  return mergedResult;
}

function mergeBatchResults(results: BalanceAnalysisResult[]): BalanceAnalysisResult {
  const allFpPatterns: string[] = [];
  const allFpCauses: string[] = [];
  const allCcPatterns: string[] = [];
  const allCcStrengths: string[] = [];
  const allRecommendations: BalanceAnalysisResult['recommendations'] = [];
  const allWarnings: string[] = [];

  for (const r of results) {
    allFpPatterns.push(...r.falsePositivePatterns);
    allFpCauses.push(...r.falsePositiveCauses);
    allCcPatterns.push(...r.confirmedPatterns);
    allCcStrengths.push(...r.confirmedStrengths);
    allRecommendations.push(...r.recommendations);
    allWarnings.push(...r.warnings);
  }

  const uniqueFpPatterns = [...new Set(allFpPatterns)];
  const uniqueFpCauses = [...new Set(allFpCauses)];
  const uniqueCcPatterns = [...new Set(allCcPatterns)];
  const uniqueCcStrengths = [...new Set(allCcStrengths)];
  const uniqueWarnings = [...new Set(allWarnings)];

  const recommendationMap = new Map<string, BalanceAnalysisResult['recommendations'][0]>();
  for (const rec of allRecommendations) {
    const key = `${rec.type}:${rec.description}`;
    if (!recommendationMap.has(key)) {
      recommendationMap.set(key, rec);
    }
  }

  return {
    falsePositivePatterns: uniqueFpPatterns,
    falsePositiveCauses: uniqueFpCauses,
    confirmedPatterns: uniqueCcPatterns,
    confirmedStrengths: uniqueCcStrengths,
    recommendations: [...recommendationMap.values()],
    warnings: uniqueWarnings,
  };
}

async function synthesizeResults(
  skillContent: string,
  mergedResult: BalanceAnalysisResult
): Promise<BalanceAnalysisResult> {
  const SYNTHESIS_PROMPT = `请根据以下多批次误报分析结果，综合生成最终的排除规则建议。

## Skill 定义
\`\`\`
${skillContent.substring(0, 2000)}
\`\`\`

## 多批次误报分析汇总

### 误报模式（去重后）
${mergedResult.falsePositivePatterns.map((p, i) => `${i + 1}. ${p}`).join('\n') || '无'}

### 误报原因（去重后）
${mergedResult.falsePositiveCauses.map((p, i) => `${i + 1}. ${p}`).join('\n') || '无'}

### 已有排除规则建议（去重后）
${mergedResult.recommendations.map((r, i) => `${i + 1}. ${r.description}`).join('\n') || '无'}

请综合以上信息，生成最终排除规则建议。只输出 JSON，格式：
{"finalRecommendations":[{"type":"add_exception","description":"...","impact":"reduce_false_positive"}],"additionalWarnings":["..."]}`;

  try {
    const response = await routeRequestWithDefaultModel(
      [{ role: 'user', content: SYNTHESIS_PROMPT }],
      {
        context: {
          userId: 'system',
          scene: 'skill-optimize',
          description: '分批误报分析结果综合',
        },
      }
    );

    let content = '';
    if (response?.content?.[0]?.text) {
      content = response.content[0].text;
    } else if (response?.choices?.[0]?.message?.content) {
      content = response.choices[0].message.content;
    }

    const parsed = parseJsonFromContent(content);

    if (parsed?.finalRecommendations) {
      const finalRecs = parsed.finalRecommendations.map((r: { type?: string; description?: string; impact?: string }) => ({
        type: (r.type as BalanceAnalysisResult['recommendations'][0]['type']) ?? 'add_exception',
        description: r.description ?? '',
        impact: (r.impact as BalanceAnalysisResult['recommendations'][0]['impact']) ?? 'reduce_false_positive',
      }));

      return {
        ...mergedResult,
        recommendations: finalRecs.length > 0 ? finalRecs : mergedResult.recommendations,
        warnings: [...mergedResult.warnings, ...(parsed.additionalWarnings ?? [])],
      };
    }
  } catch (error) {
    logger.warn(LOG_MODULES.SKILL_EVOLUTION, '综合分析失败，使用合并结果', { details: { error: error instanceof Error ? error.message : String(error) } });
  }

  return mergedResult;
}

export default {
  analyzeBalance,
  analyzeInBatches,
};