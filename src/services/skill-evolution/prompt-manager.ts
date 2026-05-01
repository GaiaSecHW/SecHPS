// src/services/skill-evolution/prompt-manager.ts
/**
 * Skill 进化提示词管理服务
 * 
 * 功能：
 * 1. 获取提示词（从数据库或使用默认值）
 * 2. 更新提示词
 * 3. 初始化默认提示词
 */

import { prisma } from '@/lib/prisma';
import { generateId } from '@/lib/id-generator';

// ============================================================================
// Types
// ============================================================================

export type PromptKey = 
  | 'balance_analysis_system'
  | 'balance_analysis_user_template'
  | 'improvement_generation_system'
  | 'improvement_generation_user_template';

export interface EvolutionPrompt {
  id: string;
  promptKey: PromptKey;
  displayName: string;
  description: string | null;
  content: string;
  isActive: boolean;
}

// ============================================================================
// 默认提示词（硬编码备份，数据库无数据时使用）
// ============================================================================

const DEFAULT_PROMPTS: Record<PromptKey, { displayName: string; description: string; content: string }> = {
  balance_analysis_system: {
    displayName: '平衡分析 - 系统提示词（方案A：只分析误报）',
    description: '只分析误报案例，正确案例用于回测验证而非分析',
    content: `你是一个安全检测专家，负责分析 Skill 的误报案例，给出排除规则建议。

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
JSON 必须包含以下字段：falsePositivePatterns, falsePositiveCauses, recommendations, warnings。
confirmedPatterns 和 confirmedStrengths 返回空数组。`,
  },

  balance_analysis_user_template: {
    displayName: '平衡分析 - 用户提示词模板（方案A）',
    description: '只分析误报案例的模板，正确案例用于回测',
    content: `请分析以下 Skill 的误报案例：

## Skill 定义
\`\`\`
{{SKILL_CONTENT}}
\`\`\`

## 误报案例（需要排除）
{{FALSE_POSITIVE_CASES}}
→ 这些被误判为漏洞，实际上不是漏洞

请分析：
1. 这些误报案例的共同特点是什么？
2. 为什么 Skill 会误判这些案例？
3. 如何添加排除规则来避免这些误报？
4. 添加排除规则可能带来什么风险？

## 输出格式

**重要**: 只输出 JSON 对象，不要输出任何其他内容。不要使用 markdown 代码块标记。

示例输出格式:
{"falsePositivePatterns":["模式1","模式2"],"falsePositiveCauses":["原因1","原因2"],"confirmedPatterns":[],"confirmedStrengths":[],"recommendations":[{"type":"add_exception","description":"添加排除规则：XXX","impact":"reduce_false_positive"}],"warnings":["排除规则可能影响对YYY场景的检测"]}

请输出你的分析结果 JSON:`,
  },

  improvement_generation_system: {
    displayName: '改进生成 - 系统提示词（方案A）',
    description: '只根据误报分析改进 Skill，正确案例用于回测验证',
    content: `你是一个安全检测专家，负责根据误报分析结果改进 Skill 定义。

**重要概念**:
- **Skill**: AI 助手使用的技能定义，包含触发条件、执行规则、参考知识、示例等
- **改进目标**: 根据误报分析，添加排除规则来减少误报

**改进原则**:
1. **添加排除规则**: 在"陷阱与边缘情况"或"常见误报排除"章节添加新的排除条件
2. **保持格式**: 改进后的内容必须保持原有 Markdown 格式和章节结构
3. **具体明确**: 排除规则要具体，能准确识别误报模式
4. **不破坏核心**: 不要删除原有的检测规则，只添加更精确的条件

**输出格式要求**:
你必须只输出一个有效的 JSON 对象，不要输出任何其他文字、解释或 markdown 标记。
JSON 必须包含以下字段：improvedContent, changeSummary, warnings。

improvedContent 必须是完整的 Skill Markdown 内容，保持原有格式。`,
  },

  improvement_generation_user_template: {
    displayName: '改进生成 - 用户提示词模板（方案A）',
    description: '只根据误报分析生成改进，正确案例用于回测',
    content: `请根据以下误报分析结果改进 Skill 内容：

## 原始 Skill 定义
\`\`\`markdown
{{SKILL_CONTENT}}
\`\`\`

## 误报分析结果

### 误报模式（需要排除）
{{FALSE_POSITIVE_PATTERNS}}

### 误报原因
{{FALSE_POSITIVE_CAUSES}}

### 排除规则建议
{{RECOMMENDATIONS}}

### 已有警告
{{WARNINGS}}

## 误报案例示例（前3个）
{{FALSE_POSITIVE_CASES_PREVIEW}}

## 改进要求

1. **保持原有格式**: 改进后的内容必须是完整的 Markdown 格式，包含所有原有章节
2. **添加排除规则**: 在"常见误报排除"或"陷阱与边缘情况"章节添加新的排除条件
3. **不删除核心规则**: 不要删除原有的检测规则，只添加更精确的排除条件
4. **变更说明**: 在 changeSummary 中列出所有变更点
5. **警告提示**: 如果改进可能影响对某些场景的检测，在 warnings 中说明

## 输出格式

**重要**: 只输出 JSON 对象，不要输出任何其他内容。不要使用 markdown 代码块标记。

示例输出格式:
{"improvedContent":"完整的改进后 Skill Markdown 内容...","changeSummary":["添加了 XX 排除规则","细化了 YY 排除条件"],"warnings":["此排除规则可能影响对 ZZ 场景的检测"]}

请输出你的改进结果 JSON:`,
  },
};

// ============================================================================
// 主函数
// ============================================================================

/**
 * 获取提示词内容
 * 
 * @param promptKey 提示词标识
 * @returns 提示词内容（优先从数据库获取，无数据则使用默认值）
 */
export async function getEvolutionPrompt(promptKey: PromptKey): Promise<string> {
  try {
    const prompt = await prisma.skillEvolutionPrompt.findUnique({
      where: { promptKey },
    });

    // 如果数据库有激活的提示词，使用它
    if (prompt && prompt.isActive) {
      console.log(`[PromptManager] 使用数据库提示词: ${promptKey}`);
      return prompt.content;
    }

    // 否则使用默认值
    console.log(`[PromptManager] 使用默认提示词: ${promptKey}`);
    return DEFAULT_PROMPTS[promptKey]?.content || '';
  } catch (error) {
    console.error(`[PromptManager] 获取提示词失败: ${promptKey}`, error);
    return DEFAULT_PROMPTS[promptKey]?.content || '';
  }
}

/**
 * 获取所有提示词（用于管理界面）
 */
export async function getAllEvolutionPrompts(): Promise<EvolutionPrompt[]> {
  try {
    const prompts = await prisma.skillEvolutionPrompt.findMany({
      orderBy: { promptKey: 'asc' },
    });

    // 如果数据库没有数据，返回默认值
    if (prompts.length === 0) {
      return Object.entries(DEFAULT_PROMPTS).map(([key, value]) => ({
        id: '',
        promptKey: key as PromptKey,
        displayName: value.displayName,
        description: value.description,
        content: value.content,
        isActive: false,
      }));
    }

    return prompts.map(p => ({
      id: p.id,
      promptKey: p.promptKey as PromptKey,
      displayName: p.displayName,
      description: p.description,
      content: p.content,
      isActive: p.isActive,
    }));
  } catch (error) {
    console.error('[PromptManager] 获取所有提示词失败', error);
    return Object.entries(DEFAULT_PROMPTS).map(([key, value]) => ({
      id: '',
      promptKey: key as PromptKey,
      displayName: value.displayName,
      description: value.description,
      content: value.content,
      isActive: false,
    }));
  }
}

/**
 * 更新提示词
 */
export async function updateEvolutionPrompt(
  promptKey: PromptKey,
  content: string,
  isActive: boolean = true
): Promise<EvolutionPrompt> {
  const defaultInfo = DEFAULT_PROMPTS[promptKey];
  
  if (!defaultInfo) {
    throw new Error(`未知的提示词标识: ${promptKey}`);
  }

  const existing = await prisma.skillEvolutionPrompt.findUnique({
    where: { promptKey },
  });

  if (existing) {
    const updated = await prisma.skillEvolutionPrompt.update({
      where: { promptKey },
      data: {
        content,
        isActive,
        updatedAt: new Date(),
      },
    });

    console.log(`[PromptManager] 已更新提示词: ${promptKey}`);
    return {
      id: updated.id,
      promptKey: updated.promptKey as PromptKey,
      displayName: updated.displayName,
      description: updated.description,
      content: updated.content,
      isActive: updated.isActive,
    };
  } else {
    const created = await prisma.skillEvolutionPrompt.create({
      data: {
        id: generateId('prompt'),
        promptKey,
        displayName: defaultInfo.displayName,
        description: defaultInfo.description,
        content,
        isActive,
        updatedAt: new Date(),
      },
    });

    console.log(`[PromptManager] 已创建提示词: ${promptKey}`);
    return {
      id: created.id,
      promptKey: created.promptKey as PromptKey,
      displayName: created.displayName,
      description: created.description,
      content: created.content,
      isActive: created.isActive,
    };
  }
}

/**
 * 初始化默认提示词（用于 seed）
 */
export async function seedEvolutionPrompts(): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  for (const [key, value] of Object.entries(DEFAULT_PROMPTS)) {
    const promptKey = key as PromptKey;
    
    const existing = await prisma.skillEvolutionPrompt.findUnique({
      where: { promptKey },
    });

    if (existing) {
      skipped++;
      console.log(`[PromptManager] 提示词已存在，跳过: ${promptKey}`);
      continue;
    }

    await prisma.skillEvolutionPrompt.create({
      data: {
        id: generateId('prompt'),
        promptKey,
        displayName: value.displayName,
        description: value.description,
        content: value.content,
        isActive: false, // 默认不激活，使用代码硬编码值
        updatedAt: new Date(),
      },
    });

    created++;
    console.log(`[PromptManager] 已创建提示词: ${promptKey}`);
  }

  console.log(`[PromptManager] Seed 完成: 创建 ${created}, 跳过 ${skipped}`);
  return { created, skipped };
}

/**
 * 重置提示词为默认值
 */
export async function resetEvolutionPrompt(promptKey: PromptKey): Promise<EvolutionPrompt> {
  const defaultContent = DEFAULT_PROMPTS[promptKey]?.content;
  
  if (!defaultContent) {
    throw new Error(`未知的提示词标识: ${promptKey}`);
  }

  return updateEvolutionPrompt(promptKey, defaultContent, false);
}

// ============================================================================
// 导出
// ============================================================================

export default {
  getEvolutionPrompt,
  getAllEvolutionPrompts,
  updateEvolutionPrompt,
  seedEvolutionPrompts,
  resetEvolutionPrompt,
};