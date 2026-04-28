/**
 * Skill 平衡分析服务
 * 使用 LLM 同时分析误报和正确发现，给出平衡改进建议
 */

import { routeRequestWithDefaultModel } from '@/lib/model-client';
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
  context?: TokenUsageContext;          // Token 使用上下文
  maxTokens?: number;                   // 最大 token 数
  temperature?: number;                 // 温度参数
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
}

// ============================================================================
// Prompt 模板
// ============================================================================

const BALANCE_ANALYSIS_SYSTEM_PROMPT = `你是一个安全检测专家，负责分析 Skill 的误报和正确发现案例，给出平衡改进建议。

**重要概念**:
- **Skill**: AI 助手使用的技能定义，包含触发条件、执行规则、参考知识等
- **误报 (False Positive)**: Skill 判断为漏洞，但实际不是漏洞的案例
- **正确发现 (Confirmed)**: Skill 判断为漏洞，且确实是漏洞的案例
- **平衡改进**: 既要减少误报，又要保持对真正漏洞的检测能力

**分析目标**:
1. 找出误报的共同特点，理解为什么误判
2. 找出正确发现的共同特点，确认 Skill 哪些规则是正确的
3. 给出改进建议，既能减少误报，又不影响正确发现
4. 指出可能影响召回率的改进，需要特别注意

**输出格式要求**:
你必须只输出一个有效的 JSON 对象，不要输出任何其他文字、解释或 markdown 标记。
JSON 必须包含以下字段：falsePositivePatterns, falsePositiveCauses, confirmedPatterns, confirmedStrengths, recommendations, warnings。`;

/**
 * 构建分析 Prompt
 */
function buildBalanceAnalysisPrompt(
  skillContent: string,
  falsePositives: CompactCase[],
  confirmedCases: CompactCase[]
): string {
  const truncateContent = (content: string, maxLen: number = DEFAULT_EVOLUTION_CONFIG.MAX_CONTENT_LENGTH): string => {
    if (content.length <= maxLen) return content;
    return content.substring(0, maxLen) + '\n... (已截断)';
  };

  const formatCases = (cases: CompactCase[], label: string): string => {
    if (cases.length === 0) {
      return `无 ${label} 案例`;
    }
    
    return cases.map((c, i) => {
      const parts = [
        `### 案例 ${i + 1}: ${c.title}`,
        `- **状态**: ${c.status === 'false-positive' ? '误报' : '正确发现'}`,
        `- **描述**: ${c.description}`,
      ];
      
      if (c.location) {
        parts.push(`- **问题代码位置**: ${c.location}`);
      }
      
      if (c.POCPreview) {
        parts.push(`- **POC 预览**:`);
        parts.push('```');
        parts.push(c.POCPreview);
        parts.push('```');
      }
      
      return parts.join('\n');
    }).join('\n\n');
  };

  return `请分析以下 Skill 的误报和正确发现案例：

## Skill 定义
\`\`\`
${truncateContent(skillContent)}
\`\`\`

## 误报案例（要避免的）
${formatCases(falsePositives, '误报')}
→ 这些被误判为漏洞，实际上不是

## 正确发现案例（要保留的）
${formatCases(confirmedCases, '正确发现')}
→ 这些是真正的漏洞，必须能继续发现

请分析：
1. 误报的共同特点是什么？为什么误判？
2. 正确发现的共同特点是什么？Skill 哪些规则是正确的？
3. 如何改进 Skill，既能减少误报，又不影响正确发现？
4. 有哪些改进可能影响召回率？需要特别注意什么？

## 输出格式

**重要**: 只输出 JSON 对象，不要输出任何其他内容。不要使用 markdown 代码块标记。

示例输出格式:
{"falsePositivePatterns":["模式1","模式2"],"falsePositiveCauses":["原因1","原因2"],"confirmedPatterns":["模式1","模式2"],"confirmedStrengths":["规则1","规则2"],"recommendations":[{"type":"modify_rule","description":"...","impact":"reduce_false_positive"}],"warnings":["警告1"]}

请输出你的分析结果 JSON:`;
}

/**
 * 从模板构建分析 Prompt（替换占位符）
 */
function buildBalanceAnalysisPromptFromTemplate(
  template: string,
  skillContent: string,
  falsePositives: CompactCase[],
  confirmedCases: CompactCase[]
): string {
  const truncateContent = (content: string, maxLen: number = DEFAULT_EVOLUTION_CONFIG.MAX_CONTENT_LENGTH): string => {
    if (content.length <= maxLen) return content;
    return content.substring(0, maxLen) + '\n... (已截断)';
  };

  const formatCases = (cases: CompactCase[], label: string): string => {
    if (cases.length === 0) {
      return `无 ${label} 案例`;
    }
    
    return cases.map((c, i) => {
      const parts = [
        `### 案例 ${i + 1}: ${c.title}`,
        `- **状态**: ${c.status === 'false_positive' ? '误报' : '正确发现'}`,
        `- **描述**: ${c.description}`,
      ];
      
      if (c.location) {
        parts.push(`- **问题代码位置**: ${c.location}`);
      }
      
      if (c.POCPreview) {
        parts.push(`- **POC 预览**:`);
        parts.push('```');
        parts.push(c.POCPreview);
        parts.push('```');
      }
      
      return parts.join('\n');
    }).join('\n\n');
  };

  // 如果模板为空，使用硬编码构建函数
  if (!template || template.trim() === '') {
    return buildBalanceAnalysisPrompt(skillContent, falsePositives, confirmedCases);
  }

  // 替换占位符
  return template
    .replace('{{SKILL_CONTENT}}', truncateContent(skillContent))
    .replace('{{FALSE_POSITIVE_CASES}}', formatCases(falsePositives, '误报'))
    .replace('{{CONFIRMED_CASES}}', formatCases(confirmedCases, '正确发现'));
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
 * 分析 Skill 的误报和正确发现，给出平衡改进建议
 *
 * @param skillContent Skill 定义内容
 * @param falsePositives 误报案例列表
 * @param confirmedCases 正确发现案例列表
 * @param options 分析选项
 * @returns 平衡分析结果
 */
export async function analyzeBalance(
  skillContent: string,
  falsePositives: CompactCase[],
  confirmedCases: CompactCase[],
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
      confirmedCases
    );
    
    console.log(`[BalanceAnalyzer] 开始分析: ${falsePositives.length} 误报, ${confirmedCases.length} 正确发现`);
    
    const response = await routeRequestWithDefaultModel(
      [{ role: 'user', content: prompt }],
      {
        system: systemPrompt || BALANCE_ANALYSIS_SYSTEM_PROMPT, // fallback to hardcoded
        // max_tokens 和 temperature 从模型配置自动获取，除非明确指定
        ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        context: options?.context ?? {
          userId: 'system',
          scene: 'skill-optimize',
          description: 'Skill 平衡分析',
        },
      }
    );
    
    // 提取内容
    const content = extractContent(response);
    
    console.log(`[BalanceAnalyzer] LLM 原始响应 (前${DEFAULT_EVOLUTION_CONFIG.LOG_PREVIEW_LENGTH}字符): ${content.substring(0, DEFAULT_EVOLUTION_CONFIG.LOG_PREVIEW_LENGTH)}`);
    
    // 解析 JSON
    const parsed = parseJsonFromContent(content);
    
    if (!parsed) {
      console.warn('[BalanceAnalyzer] 无法从 LLM 响应解析 JSON，使用默认值');
      console.warn('[BalanceAnalyzer] 完整响应内容:', content);
      return createDefaultResult();
    }
    
    // 构建结果
    const result: BalanceAnalysisResult = {
      falsePositivePatterns: parsed.falsePositivePatterns ?? [],
      falsePositiveCauses: parsed.falsePositiveCauses ?? [],
      confirmedPatterns: parsed.confirmedPatterns ?? [],
      confirmedStrengths: parsed.confirmedStrengths ?? [],
      recommendations: (parsed.recommendations ?? []).map((r) => ({
        type: (r.type as BalanceAnalysisResult['recommendations'][0]['type']) ?? 'modify_rule',
        description: r.description ?? '',
        impact: (r.impact as BalanceAnalysisResult['recommendations'][0]['impact']) ?? 'both',
      })),
      warnings: parsed.warnings ?? [],
    };
    
    console.log(`[BalanceAnalyzer] 分析完成: ${result.recommendations.length} 条建议`);
    
    return result;
    
  } catch (error) {
    console.error('[BalanceAnalyzer] LLM 分析失败:', error);
    return createDefaultResult();
  }
}

// ============================================================================
// 导出
// ============================================================================

export default {
  analyzeBalance,
};