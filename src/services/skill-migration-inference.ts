/**
 * Skill 存量数据 LLM 推断服务
 * 使用 LLM 分析 Skill 内容，推断正确的语言和漏洞类型
 */

import { routeRequest } from '@/lib/claude-router/router';
import { prisma } from '@/lib/prisma';

// ============================================================================
// Types
// ============================================================================

/**
 * 用于推断的 Skill 数据
 */
export interface SkillForInference {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  techStack?: string | null;        // 原始技术栈（可能不准）
  content?: string | null;
  cwe?: string | null;
}

/**
 * 推断结果
 */
export interface InferenceResult {
  skillId: string;
  language: string | null;           // 推断的语言名称
  languageId: string | null;         // TechStackOption ID
  vulnerabilityPatternId: string | null;  // VulnerabilityPattern ID
  vulnerabilityPatternName: string | null;
  confidence: number;                // 置信度 0-1
  reason: string;                    // LLM 给出的推断理由
  error?: string;                    // 错误信息（如果失败）
}

/**
 * 批量推断选项
 */
export interface BatchInferenceOptions {
  concurrency?: number;             // 并发数，默认 3
  skipAnalyzed?: boolean;           // 跳过已分析的，默认 true
  onProgress?: (current: number, total: number, result: InferenceResult) => void;
  onSkillStart?: (skillId: string, skillName: string) => void;
}

/**
 * 批量推断结果
 */
export interface BatchInferenceResult {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: InferenceResult[];
}

/**
 * LLM 返回的推断结果
 */
interface LLMInferenceResponse {
  language: string | null;
  vulnerabilityPatternId: string | null;
  confidence: number;
  reason: string;
}

// ============================================================================
// Prompt 模板
// ============================================================================

const INFERENCE_SYSTEM_PROMPT = `你是一个代码安全审计专家，负责分析 AI Skill 的内容，推断其主要编程语言和漏洞类型。

**重要概念**:
- **Skill**: AI 助手使用的技能定义，用于代码审计、漏洞检测等
- **编程语言**: Skill 主要针对的编程语言（如 Python, Java, JavaScript 等）
- **漏洞类型**: Skill 主要检测的安全漏洞类型（如 SQL Injection, XSS 等）

**判断标准**:
1. **语言推断**: 根据 Skill 内容中的代码示例、检测规则、目标框架等推断
2. **漏洞类型**: 根据 Skill 描述、检测规则、CWE 编号等推断
3. **置信度**: 
   - 0.9+: 非常确定（内容明确提到语言/漏洞类型）
   - 0.7-0.9: 较为确定（有明确线索）
   - 0.5-0.7: 中等确定（有间接线索）
   - 0.3-0.5: 不太确定（仅有模糊线索）
   - <0.3: 无法确定

**注意事项**:
- 如果 Skill 是通用的（不针对特定语言），language 返回 null
- 如果 Skill 不针对特定漏洞类型，vulnerabilityPatternId 返回 null
- 必须从提供的选项列表中选择，不要返回列表之外的值

请用中文回答，给出清晰的推断理由。`;

/**
 * 构建推断 Prompt
 */
function buildInferencePrompt(
  skill: SkillForInference,
  languages: Array<{ id: string; name: string; category: string }>,
  vulnerabilityPatterns: Array<{ id: string; name: string; displayName: string; category: string }>
): string {
  const truncateContent = (content: string | null | undefined, maxLen: number = 3000): string => {
    if (!content) return '无';
    if (content.length <= maxLen) return content;
    return content.substring(0, maxLen) + '\n... (已截断)';
  };

  const languageList = languages
    .map(l => `- ${l.name} (ID: ${l.id}, 类别: ${l.category})`)
    .join('\n');

  const vulnList = vulnerabilityPatterns
    .map(v => `- ${v.displayName} (ID: ${v.id}, 类别: ${v.category})`)
    .join('\n');

  return `请分析以下 Skill 内容，推断其主要编程语言和漏洞类型：

## Skill 信息
- **名称**: ${skill.name}
- **显示名**: ${skill.displayName}
- **描述**: ${skill.description}
- **类别**: ${skill.category}
- **原始技术栈**: ${skill.techStack || '无'}
- **CWE**: ${skill.cwe || '无'}

## Skill 内容摘要
\`\`\`
${truncateContent(skill.content)}
\`\`\`

## 可选语言列表
${languageList}

## 可选漏洞类型列表
${vulnList}

## 请回答

1. **主要语言**: 从可选语言列表中选择最匹配的一个，如果无法确定或不针对特定语言，返回 null
2. **漏洞类型**: 从可选漏洞类型列表中选择最匹配的一个，如果无法确定或不针对特定漏洞，返回 null
3. **置信度**: 0.0-1.0 之间的数值
4. **推断理由**: 简要说明为什么这样推断

请以 JSON 格式输出：
\`\`\`json
{
  "language": "语言名称或null",
  "vulnerabilityPatternId": "漏洞类型ID或null",
  "confidence": 0.85,
  "reason": "推断理由..."
}
\`\`\`

注意：
- language 字段返回语言名称（如 "Python"），不是 ID
- vulnerabilityPatternId 字段返回漏洞类型的 ID
- 如果不确定，宁可返回 null 也不要猜测`;
}

// ============================================================================
// 数据获取
// ============================================================================

/**
 * 获取所有活跃的技术栈选项
 */
export async function getActiveTechStackOptions(): Promise<Array<{ id: string; name: string; category: string }>> {
  return prisma.techStackOption.findMany({
    where: { isActive: true },
    select: { id: true, name: true, category: true },
    orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  });
}

/**
 * 获取所有活跃的漏洞模式
 */
export async function getActiveVulnerabilityPatterns(): Promise<Array<{ id: string; name: string; displayName: string; category: string }>> {
  return prisma.vulnerabilityPattern.findMany({
    where: { isActive: true },
    select: { id: true, name: true, displayName: true, category: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });
}

// ============================================================================
// LLM 推断
// ============================================================================

/**
 * 调用 LLM 推断 Skill 元数据
 */
export async function inferSkillMetadata(
  skill: SkillForInference,
  options?: {
    languages?: Array<{ id: string; name: string; category: string }>;
    vulnerabilityPatterns?: Array<{ id: string; name: string; displayName: string; category: string }>;
  }
): Promise<InferenceResult> {
  try {
    // 获取选项列表
    const languages = options?.languages ?? await getActiveTechStackOptions();
    const vulnerabilityPatterns = options?.vulnerabilityPatterns ?? await getActiveVulnerabilityPatterns();

    // 构建请求
    const prompt = buildInferencePrompt(skill, languages, vulnerabilityPatterns);
    
    const request = {
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: 1024,
      temperature: 0.2, // 低温度以保证稳定性
    };

    console.log(`[SkillMigrationInference] 推断 Skill: ${skill.name}`);

    const response = await routeRequest(request);

    // 解析 LLM 响应
    const content = response.content?.[0]?.text || response.choices?.[0]?.message?.content || '';

    // 提取 JSON
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || 
                      content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      console.warn('[SkillMigrationInference] 无法解析 LLM 响应');
      return createDefaultResult(skill, '无法解析 LLM 响应');
    }

    const parsed: LLMInferenceResponse = JSON.parse(jsonMatch[1] || jsonMatch[0]);

    // 查找匹配的语言 ID
    let languageId: string | null = null;
    let languageName: string | null = parsed.language;
    
    if (parsed.language) {
      const matchedLang = languages.find(
        l => l.name.toLowerCase() === parsed.language!.toLowerCase()
      );
      if (matchedLang) {
        languageId = matchedLang.id;
        languageName = matchedLang.name;
      } else {
        // 尝试模糊匹配
        const fuzzyMatch = languages.find(
          l => l.name.toLowerCase().includes(parsed.language!.toLowerCase()) ||
              parsed.language!.toLowerCase().includes(l.name.toLowerCase())
        );
        if (fuzzyMatch) {
          languageId = fuzzyMatch.id;
          languageName = fuzzyMatch.name;
        }
      }
    }

    // 验证漏洞类型 ID
    let vulnPatternId: string | null = parsed.vulnerabilityPatternId;
    let vulnPatternName: string | null = null;
    
    if (vulnPatternId) {
      const matchedVuln = vulnerabilityPatterns.find(v => v.id === vulnPatternId);
      if (matchedVuln) {
        vulnPatternName = matchedVuln.displayName;
      } else {
        // ID 无效，清空
        vulnPatternId = null;
      }
    }

    return {
      skillId: skill.id,
      language: languageName,
      languageId,
      vulnerabilityPatternId: vulnPatternId,
      vulnerabilityPatternName: vulnPatternName,
      confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.5)),
      reason: parsed.reason || 'LLM 未给出理由',
    };

  } catch (error) {
    console.error('[SkillMigrationInference] LLM 推断失败:', error);
    return createDefaultResult(skill, error instanceof Error ? error.message : '未知错误');
  }
}

/**
 * 创建默认结果（LLM 调用失败时）
 */
function createDefaultResult(skill: SkillForInference, error: string): InferenceResult {
  return {
    skillId: skill.id,
    language: null,
    languageId: null,
    vulnerabilityPatternId: null,
    vulnerabilityPatternName: null,
    confidence: 0,
    reason: `推断失败: ${error}`,
    error,
  };
}

// ============================================================================
// 批量推断
// ============================================================================

/**
 * 批量推断 Skill 元数据
 * 
 * @param skills 技能列表
 * @param options 选项
 * @returns 批量推断结果
 */
export async function batchInferSkills(
  skills: SkillForInference[],
  options: BatchInferenceOptions = {}
): Promise<BatchInferenceResult> {
  const { 
    concurrency = 3, 
    skipAnalyzed = true,
    onProgress,
    onSkillStart 
  } = options;

  const results: InferenceResult[] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  // 预加载选项列表（避免每次调用都查询数据库）
  const languages = await getActiveTechStackOptions();
  const vulnerabilityPatterns = await getActiveVulnerabilityPatterns();

  // 过滤已分析的 Skill
  let skillsToAnalyze = skills;
  if (skipAnalyzed) {
    const existingSkills = await prisma.skill.findMany({
      where: {
        id: { in: skills.map(s => s.id) },
        migrationStatus: { in: ['migrated', 'analyzing'] },
      },
      select: { id: true },
    });
    const analyzedIds = new Set(existingSkills.map(s => s.id));
    skillsToAnalyze = skills.filter(s => !analyzedIds.has(s.id));
    skipped = skills.length - skillsToAnalyze.length;
  }

  // 分批处理
  for (let i = 0; i < skillsToAnalyze.length; i += concurrency) {
    const batch = skillsToAnalyze.slice(i, i + concurrency);

    // 并发执行
    const batchResults = await Promise.all(
      batch.map(async (skill) => {
        if (onSkillStart) {
          onSkillStart(skill.id, skill.name);
        }

        const result = await inferSkillMetadata(skill, { languages, vulnerabilityPatterns });
        
        // 更新数据库
        if (!result.error) {
          try {
            await prisma.skill.update({
              where: { id: skill.id },
              data: {
                techStackId: result.languageId,
                vulnerabilityPatternId: result.vulnerabilityPatternId,
                migrationConfidence: result.confidence,
                migrationNotes: result.reason,
                migrationStatus: 'analyzing',
                updatedAt: new Date(),
              },
            });
          } catch (dbError) {
            console.error(`[SkillMigrationInference] 更新数据库失败: ${skill.id}`, dbError);
            result.error = `数据库更新失败: ${dbError instanceof Error ? dbError.message : '未知错误'}`;
          }
        }

        return result;
      })
    );

    // 统计
    for (const result of batchResults) {
      results.push(result);
      
      if (result.error) {
        failed++;
      } else {
        succeeded++;
      }

      // 进度回调
      if (onProgress) {
        onProgress(results.length + skipped, skills.length, result);
      }
    }

    // 避免 API 限流
    if (i + concurrency < skillsToAnalyze.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return {
    total: skills.length,
    succeeded,
    failed,
    skipped,
    results,
  };
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 从数据库获取待推断的 Skill 列表
 */
export async function getSkillsForInference(options?: {
  limit?: number;
  category?: string;
  status?: string;
}): Promise<SkillForInference[]> {
  const { limit, category, status = 'pending' } = options || {};

  const where: Record<string, unknown> = {
    migrationStatus: status,
  };

  if (category) {
    where.category = category;
  }

  return prisma.skill.findMany({
    where,
    take: limit,
    select: {
      id: true,
      name: true,
      displayName: true,
      description: true,
      category: true,
      techStack: true,
      content: true,
      cwe: true,
    },
  });
}

/**
 * 应用推断结果到 Skill
 */
export async function applyInferenceResult(
  skillId: string,
  result: InferenceResult,
  status: 'migrated' | 'pending_review' = 'migrated'
): Promise<void> {
  await prisma.skill.update({
    where: { id: skillId },
    data: {
      techStackId: result.languageId,
      vulnerabilityPatternId: result.vulnerabilityPatternId,
      migrationConfidence: result.confidence,
      migrationNotes: result.reason,
      migrationStatus: status,
      updatedAt: new Date(),
    },
  });
}

// ============================================================================
// 导出
// ============================================================================

export default {
  inferSkillMetadata,
  batchInferSkills,
  getActiveTechStackOptions,
  getActiveVulnerabilityPatterns,
  getSkillsForInference,
  applyInferenceResult,
};