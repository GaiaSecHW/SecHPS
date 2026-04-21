/**
 * Skill 改进内容生成服务
 * 基于平衡分析结果生成改进后的 Skill 内容，保存到 SkillImprovement 表
 */

import { routeRequestWithDefaultModel } from '@/lib/model-client';
import { prisma } from '@/lib/prisma';
import type { TokenUsageContext } from '@/types/call-scene';
import type { BalanceAnalysisResult } from './balance-analyzer';
import type { CompactCase } from './case-extractor';
import { DEFAULT_EVOLUTION_CONFIG } from './evolution-scheduler';

// ============================================================================
// Types
// ============================================================================

/**
 * 改进生成选项
 */
export interface ImprovementGenerationOptions {
  context?: TokenUsageContext;          // Token 使用上下文
  maxTokens?: number;                   // 最大 token 数
  temperature?: number;                 // 温度参数
  taskId?: string;                      // 关联的 SkillEvolutionTask ID
}

/**
 * 生成的改进结果
 */
export interface GeneratedImprovement {
  improvementId: string;                // SkillImprovement 记录 ID
  improvedContent: string;              // 改进后的 Skill 内容
  changeSummary: string[];              // 变更摘要列表
  warnings: string[];                   // 警告信息
}

/**
 * LLM 返回的改进内容结构
 */
interface LlmImprovementResponse {
  improvedContent: string;              // 改进后的完整 Skill 内容
  changeSummary: string[];              // 变更说明列表
  warnings: string[];                   // 需要注意的警告
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

// ============================================================================
// Prompt 模板
// ============================================================================

const IMPROVEMENT_GENERATION_SYSTEM_PROMPT = `你是一个安全检测专家，负责根据分析结果改进 Skill 定义。

**重要概念**:
- **Skill**: AI 助手使用的技能定义，包含触发条件、执行规则、参考知识、示例等
- **改进目标**: 根据误报分析和正确发现分析，改进 Skill 内容，减少误报同时保持检测能力

**改进原则**:
1. **保守改进**: 优先添加排除规则，而非删除检测规则
2. **保持格式**: 改进后的内容必须保持原有 Markdown 格式和章节结构
3. **明确变更**: 在"陷阱与边缘情况"或"常见误报排除"章节添加新的排除规则
4. **不破坏核心**: 不要删除核心检测规则，只添加更精确的条件

**输出格式要求**:
你必须只输出一个有效的 JSON 对象，不要输出任何其他文字、解释或 markdown 标记。
JSON 必须包含以下字段：improvedContent, changeSummary, warnings。

improvedContent 必须是完整的 Skill Markdown 内容，保持原有格式。`;

/**
 * 构建改进生成 Prompt
 */
function buildImprovementPrompt(
  skillContent: string,
  analysisResult: BalanceAnalysisResult,
  falsePositiveCases: CompactCase[],
  confirmedCases: CompactCase[]
): string {
  const truncateContent = (content: string, maxLen: number = DEFAULT_EVOLUTION_CONFIG.MAX_SKILL_CONTENT_LENGTH): string => {
    if (content.length <= maxLen) return content;
    return content.substring(0, maxLen) + '\n... (已截断)';
  };

  const formatRecommendations = (recommendations: BalanceAnalysisResult['recommendations']): string => {
    if (recommendations.length === 0) {
      return '无具体改进建议';
    }
    
    return recommendations.map((r, i) => {
      const typeMap: Record<string, string> = {
        'add_rule': '添加规则',
        'modify_rule': '修改规则',
        'add_exception': '添加排除条件',
        'refine_pattern': '细化模式',
      };
      const impactMap: Record<string, string> = {
        'reduce_false_positive': '减少误报',
        'maintain_detection': '保持检测',
        'both': '平衡改进',
      };
      
      return `${i + 1}. **${typeMap[r.type] || r.type}**: ${r.description} (影响: ${impactMap[r.impact] || r.impact})`;
    }).join('\n');
  };

  const formatPatterns = (patterns: string[], label: string): string => {
    if (patterns.length === 0) {
      return `无 ${label}`;
    }
    return patterns.map((p, i) => `${i + 1}. ${p}`).join('\n');
  };

  return `请根据以下分析结果改进 Skill 内容：

## 原始 Skill 定义
\`\`\`markdown
${truncateContent(skillContent)}
\`\`\`

## 分析结果

### 误报模式（需要排除）
${formatPatterns(analysisResult.falsePositivePatterns, '误报模式')}

### 误报原因
${formatPatterns(analysisResult.falsePositiveCauses, '误报原因')}

### 正确发现模式（需要保留）
${formatPatterns(analysisResult.confirmedPatterns, '正确发现模式')}

### 必须保留的规则
${formatPatterns(analysisResult.confirmedStrengths, '必须保留的规则')}

### 改进建议
${formatRecommendations(analysisResult.recommendations)}

### 已有警告
${analysisResult.warnings.length > 0 ? analysisResult.warnings.map((w, i) => `${i + 1}. ${w}`).join('\n') : '无'}

## 参考案例（可选）

### 误报案例示例（前3个）
${falsePositiveCases.slice(0, 3).map((c, i) => 
  `案例 ${i + 1}: ${c.title}\n描述: ${c.description}`
).join('\n\n') || '无误报案例'}

### 正确发现案例示例（前3个）
${confirmedCases.slice(0, 3).map((c, i) => 
  `案例 ${i + 1}: ${c.title}\n描述: ${c.description}`
).join('\n\n') || '无正确发现案例'}

## 改进要求

1. **保持原有格式**: 改进后的内容必须是完整的 Markdown 格式，包含所有原有章节
2. **添加排除规则**: 在"常见误报排除"或"陷阱与边缘情况"章节添加新的排除条件
3. **不删除核心规则**: 不要删除原有的检测规则，只添加更精确的条件
4. **变更说明**: 在 changeSummary 中列出所有变更点
5. **警告提示**: 如果改进可能影响召回率，在 warnings 中说明

## 输出格式

**重要**: 只输出 JSON 对象，不要输出任何其他内容。不要使用 markdown 代码块标记。

示例输出格式:
{"improvedContent":"完整的改进后 Skill Markdown 内容...","changeSummary":["添加了 XX 排除规则","细化了 YY 检测条件"],"warnings":["此改进可能影响对 ZZ 场景的检测"]}

请输出你的改进结果 JSON:`;
}

// ============================================================================
// JSON 解析辅助函数（复用 balance-analyzer 的逻辑）
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
function parseJsonFromContent(content: string): LlmImprovementResponse | null {
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
 * 创建默认改进结果（LLM 调用失败时）
 */
function createDefaultImprovement(skillContent: string): LlmImprovementResponse {
  return {
    improvedContent: skillContent, // 保持原内容不变
    changeSummary: ['LLM 生成失败，未进行改进'],
    warnings: ['建议人工审核并手动改进 Skill 内容'],
  };
}

// ============================================================================
// 主函数
// ============================================================================

/**
 * 基于平衡分析结果生成改进后的 Skill 内容
 *
 * @param skillId Skill ID
 * @param skillContent 原始 Skill 内容
 * @param analysisResult 平衡分析结果
 * @param falsePositiveCases 误报案例列表
 * @param confirmedCases 正确发现案例列表
 * @param options 生成选项
 * @returns 生成的改进结果
 */
export async function generateImprovement(
  skillId: string,
  skillContent: string,
  analysisResult: BalanceAnalysisResult,
  falsePositiveCases: CompactCase[],
  confirmedCases: CompactCase[],
  options?: ImprovementGenerationOptions
): Promise<GeneratedImprovement> {
  try {
    const prompt = buildImprovementPrompt(skillContent, analysisResult, falsePositiveCases, confirmedCases);
    
    console.log(`[ImprovementGenerator] 开始生成改进: skillId=${skillId}`);
    console.log(`[ImprovementGenerator] 分析结果: ${analysisResult.recommendations.length} 条建议`);
    
    const response = await routeRequestWithDefaultModel(
      [{ role: 'user', content: prompt }],
      {
        system: IMPROVEMENT_GENERATION_SYSTEM_PROMPT,
        // max_tokens 和 temperature 从模型配置自动获取，除非明确指定
        ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        context: options?.context ?? {
          userId: 'system',
          scene: 'skill-evolution',
          description: 'Skill 改进内容生成',
        },
      }
    );
    
    // 提取内容
    const content = extractContent(response);
    
    console.log(`[ImprovementGenerator] LLM 原始响应 (前${DEFAULT_EVOLUTION_CONFIG.LOG_PREVIEW_LENGTH}字符): ${content.substring(0, DEFAULT_EVOLUTION_CONFIG.LOG_PREVIEW_LENGTH)}`);
    
    // 解析 JSON
    const parsed = parseJsonFromContent(content);
    
    let improvementData: LlmImprovementResponse;
    
    if (!parsed) {
      console.warn('[ImprovementGenerator] 无法从 LLM 响应解析 JSON，使用默认值');
      console.warn('[ImprovementGenerator] 完整响应内容:', content);
      improvementData = createDefaultImprovement(skillContent);
    } else {
      improvementData = {
        improvedContent: parsed.improvedContent ?? skillContent,
        changeSummary: parsed.changeSummary ?? [],
        warnings: parsed.warnings ?? [],
      };
    }
    
    // 保存到 SkillImprovement 表
    const improvement = await prisma.skillImprovement.create({
      data: {
        skillId,
        taskId: options?.taskId,
        falsePositiveCases: JSON.stringify(falsePositiveCases),
        confirmedCases: JSON.stringify(confirmedCases),
        analysis: JSON.stringify(analysisResult),
        suggestions: JSON.stringify(analysisResult.recommendations),
        improvedContent: improvementData.improvedContent,
        status: 'pending', // 等待人工审批
      },
    });
    
    console.log(`[ImprovementGenerator] 改进记录已保存: improvementId=${improvement.id}`);
    console.log(`[ImprovementGenerator] 变更摘要: ${improvementData.changeSummary.length} 条`);
    
    return {
      improvementId: improvement.id,
      improvedContent: improvementData.improvedContent,
      changeSummary: improvementData.changeSummary,
      warnings: improvementData.warnings,
    };
    
  } catch (error) {
    console.error('[ImprovementGenerator] LLM 生成失败:', error);
    
    // 即使失败，也创建一条记录（保持原内容）
    const improvement = await prisma.skillImprovement.create({
      data: {
        skillId,
        taskId: options?.taskId,
        falsePositiveCases: JSON.stringify(falsePositiveCases),
        confirmedCases: JSON.stringify(confirmedCases),
        analysis: JSON.stringify(analysisResult),
        suggestions: JSON.stringify(analysisResult.recommendations),
        improvedContent: skillContent, // 保持原内容
        status: 'pending',
      },
    });
    
    return {
      improvementId: improvement.id,
      improvedContent: skillContent,
      changeSummary: ['LLM 生成失败，保持原内容'],
      warnings: [`错误: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

/**
 * 获取待审批的改进记录
 *
 * @param skillId Skill ID（可选，不传则获取所有）
 * @returns 待审批的改进记录列表
 */
export async function getPendingImprovements(skillId?: string): Promise<Array<{
  id: string;
  skillId: string;
  skillName: string;
  createdAt: Date;
  changeSummary: string[];
  warnings: string[];
}>> {
  const improvements = await prisma.skillImprovement.findMany({
    where: {
      status: 'pending',
      ...(skillId ? { skillId } : {}),
    },
    include: {
      Skill: {
        select: {
          name: true,
          displayName: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
  
  return improvements.map((imp) => {
    let changeSummary: string[] = [];
    let warnings: string[] = [];
    
    try {
      const suggestions = JSON.parse(imp.suggestions || '[]');
      changeSummary = suggestions.map((s: { description?: string } | string) => 
        typeof s === 'string' ? s : (s.description || '')
      );
    } catch {
      changeSummary = [];
    }
    
    try {
      const analysis = JSON.parse(imp.analysis || '{}');
      warnings = analysis.warnings || [];
    } catch {
      warnings = [];
    }
    
    return {
      id: imp.id,
      skillId: imp.skillId,
      skillName: imp.Skill?.displayName || imp.Skill?.name || 'Unknown',
      createdAt: imp.createdAt,
      changeSummary,
      warnings,
    };
  });
}

/**
 * 获取改进记录详情
 *
 * @param improvementId 改进记录 ID
 * @returns 改进记录详情
 */
export async function getImprovementDetail(improvementId: string): Promise<{
  id: string;
  skillId: string;
  skillName: string;
  originalContent: string;
  improvedContent: string;
  analysis: BalanceAnalysisResult;
  falsePositiveCases: CompactCase[];
  confirmedCases: CompactCase[];
  createdAt: Date;
  status: string;
} | null> {
  const improvement = await prisma.skillImprovement.findUnique({
    where: { id: improvementId },
    include: {
      Skill: {
        select: {
          name: true,
          displayName: true,
          content: true,
        },
      },
    },
  });
  
  if (!improvement) {
    return null;
  }
  
  let analysis: BalanceAnalysisResult;
  try {
    analysis = JSON.parse(improvement.analysis || '{}');
  } catch {
    analysis = {
      falsePositivePatterns: [],
      falsePositiveCauses: [],
      confirmedPatterns: [],
      confirmedStrengths: [],
      recommendations: [],
      warnings: [],
    };
  }
  
  let falsePositiveCases: CompactCase[];
  try {
    falsePositiveCases = JSON.parse(improvement.falsePositiveCases || '[]');
  } catch {
    falsePositiveCases = [];
  }
  
  let confirmedCases: CompactCase[];
  try {
    confirmedCases = JSON.parse(improvement.confirmedCases || '[]');
  } catch {
    confirmedCases = [];
  }
  
  return {
    id: improvement.id,
    skillId: improvement.skillId,
    skillName: improvement.Skill?.displayName || improvement.Skill?.name || 'Unknown',
    originalContent: improvement.Skill?.content || '',
    improvedContent: improvement.improvedContent || '',
    analysis,
    falsePositiveCases,
    confirmedCases,
    createdAt: improvement.createdAt,
    status: improvement.status,
  };
}

// ============================================================================
// 导出
// ============================================================================

export default {
  generateImprovement,
  getPendingImprovements,
  getImprovementDetail,
};