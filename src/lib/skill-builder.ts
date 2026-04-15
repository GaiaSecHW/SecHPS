/**
 * Skill 构建公共模块
 * 
 * 用于多个 Skill 管理界面：
 * - 快速创建 (create/page.tsx)
 * - 引导式创建 (create-wizard)
 * - 编辑详情 (skills/[id])
 * - 其他 Skill 相关页面
 */

import { prisma } from '@/lib/prisma';

/**
 * 用户意图数据
 */
export interface SkillIntent {
  name?: string;
  displayName?: string;
  description?: string;
  category?: string;
  whatDoesItDo?: string;
  whenShouldItTrigger?: string;
}

/**
 * Skill 构建选项
 */
export interface SkillBuildOptions {
  /** 是否添加 YAML frontmatter */
  addFrontmatter?: boolean;
  /** 是否添加标准输出格式 */
  addOutputFormat?: boolean;
  /** 是否添加 Skill 标题 */
  addTitle?: boolean;
  /** 自定义输出格式模板（优先级高于系统配置） */
  customOutputTemplate?: string;
}

/**
 * 默认构建选项
 */
const DEFAULT_OPTIONS: SkillBuildOptions = {
  addFrontmatter: true,
  addOutputFormat: true,
  addTitle: true,
};

/**
 * 获取系统配置的标准 Skill 输出格式
 */
export async function getStandardOutputTemplate(): Promise<string | null> {
  try {
    const config = await prisma.opencodeConfig.findFirst({
      where: { isActive: true },
      select: { skillOutputTemplate: true },
    });
    return config?.skillOutputTemplate || null;
  } catch (error) {
    console.error('[skill-builder] 获取标准输出格式失败:', error);
    return null;
  }
}

/**
 * 默认输出格式
 */
const DEFAULT_OUTPUT_FORMAT = `### 检测结果
- **漏洞类型**：[漏洞类型名称]
- **位置**：[文件名:行号]
- **描述**：[具体漏洞描述]
- **风险等级**：[高危/中危/低危]`;

/**
 * 构建 Skill 系统提示词（给大模型的指令）
 */
export function buildSystemPrompt(): string {
  return `你是一个专业的 AI Skill 专家。请根据用户意图生成优秀的 Skill 定义。

## 优秀 Skill 的关键原则

1. **Description 是触发机制（最重要）**
   - 决定 Agent 是否调用此 Skill
   - 必须包含：做什么 + 何时触发 + 关键触发词
   - 用第三人称写，可适当"pushy"明确列出触发场景
   - ❌ 错误："Helps with security"
   - ✅ 正确："检测 SQL 注入漏洞。当审计 SQL、数据库注入时触发，即使未明确提及漏洞名也应激活"

2. **简洁至上（<500行）**
   - 只添加 Agent 不知道的内容
   - 用指令而非散文："Always use X" 不是 "The X API is recommended"

3. **提供示例（重要！）**
   - 展示输入（漏洞代码）+ 输出（检测结果）的范例
   - Agent 从示例学习格式比长段落解释更有效

4. **描述目标，不预设步骤**
   - 让 Agent 决定执行路径
   - ❌ 错误："Step 1: Read file. Step 2: Parse."
   - ✅ 正确："Extract and validate user data"

## 输出要求

直接返回 Markdown 格式的 Skill 正文内容（不要包含 YAML frontmatter，系统会自动添加）。

必须包含以下章节：
- ## 检测目标
- ## 检查要点
- ## 示例（重要！展示漏洞代码和检测结果）
- ## CWE 编号（如有）
- ## 工具要求

注意：不要写"输出格式"章节，系统会自动添加标准输出格式。`;
}

/**
 * 构建 Skill 用户提示词（用户意图）
 */
export function buildUserPrompt(intent: SkillIntent): string {
  return `请生成一个完整的 Skill 定义：

- **名称**：${intent.name || '未提供'}
- **分类**：${intent.category || 'code-audit'}
- **功能**：${intent.whatDoesItDo || intent.description || '检测安全漏洞'}
- **触发条件**：${intent.whenShouldItTrigger || '用户要求审计相关漏洞'}

请生成包含检测目标、检查要点、示例、CWE编号、工具要求的完整 Skill Markdown 内容。`;
}

/**
 * 构建完整的 Skill 内容
 * 
 * @param intent 用户意图
 * @param generatedContent 大模型生成的 Markdown 内容
 * @param outputTemplate 标准输出格式模板（可选）
 * @param options 构建选项
 */
export function buildFullSkill(
  intent: SkillIntent,
  generatedContent: string,
  outputTemplate?: string | null,
  options: SkillBuildOptions = DEFAULT_OPTIONS
): string {
  const lines: string[] = [];
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // 1. YAML frontmatter
  if (opts.addFrontmatter) {
    const skillName = intent.name || extractSkillName(generatedContent) || 'generated-skill';
    const description = buildDescription(intent);
    
    lines.push('---');
    lines.push(`name: ${skillName}`);
    lines.push(`description: ${description}`);
    lines.push('---');
    lines.push('');
  }

  // 2. Skill 标题
  if (opts.addTitle) {
    const title = intent.displayName || intent.name || 'Generated Skill';
    lines.push(`# ${title}`);
    lines.push('');
  }

  // 3. 大模型生成的内容（清理）
  const cleanedContent = cleanMarkdownContent(generatedContent);
  lines.push(cleanedContent);
  if (!cleanedContent.endsWith('\n')) {
    lines.push('');
  }

  // 4. 标准输出格式
  if (opts.addOutputFormat) {
    const outputFormat = outputTemplate || DEFAULT_OUTPUT_FORMAT;
    lines.push('## 输出格式');
    lines.push('');
    lines.push(outputFormat);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 构建 Description（触发机制描述）
 */
export function buildDescription(intent: SkillIntent): string {
  if (intent.description && intent.whenShouldItTrigger) {
    // 用户提供了完整的描述和触发条件
    return `${intent.description}。${intent.whenShouldItTrigger}`;
  }
  
  if (intent.description) {
    return intent.description;
  }
  
  const name = intent.name || '安全漏洞';
  const trigger = intent.whenShouldItTrigger || `当用户要求审计${name}时触发`;
  
  return `检测${name}相关的安全漏洞。${trigger}`;
}

/**
 * 清理 Markdown 内容
 */
function cleanMarkdownContent(content: string): string {
  content = content.trim();
  
  // 移除代码块包装
  const markdownBlockMatch = content.match(/^```markdown\s*([\s\S]*?)\s*```$/s);
  if (markdownBlockMatch) {
    return markdownBlockMatch[1].trim();
  }
  
  const codeBlockMatch = content.match(/^```\s*([\s\S]*?)\s*```$/s);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  
  // 移除可能存在的 YAML frontmatter（如果大模型误生成）
  const yamlMatch = content.match(/^---[\s\S]*?---\s*/);
  if (yamlMatch) {
    content = content.substring(yamlMatch[0].length);
  }
  
  // 移除可能存在的标题（如果大模型误生成）
  const titleMatch = content.match(/^#\s+.+\n/);
  if (titleMatch && !content.includes('## 检测目标')) {
    // 只移除开头的标题
    content = content.substring(titleMatch[0].length);
  }
  
  // 移除可能误生成的"## 输出格式"章节（系统会自动添加）
  // 匹配 "## 输出格式" 或 "## 输出要求" 等类似章节
  const outputFormatMatch = content.match(/\n##\s*输出格式[\s\S]*$/i);
  if (outputFormatMatch) {
    content = content.substring(0, content.length - outputFormatMatch[0].length);
  }
  
  const outputRequirementMatch = content.match(/\n##\s*输出要求[\s\S]*$/i);
  if (outputRequirementMatch) {
    content = content.substring(0, content.length - outputRequirementMatch[0].length);
  }
  
  return content.trim();
}

/**
 * 从内容中提取 Skill 名称
 */
function extractSkillName(content: string): string {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    return titleMatch[1]
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);
  }
  return 'generated-skill';
}

/**
 * 从内容中提取 CWE
 */
export function extractCwe(content: string): string | null {
  const cweMatch = content.match(/CWE-(\d+)/i);
  return cweMatch ? `CWE-${cweMatch[1]}` : null;
}

/**
 * 提取大模型响应内容（支持多种 API 格式）
 */
export function extractModelResponse(response: any): string {
  // Claude API 格式
  if (response.content && Array.isArray(response.content)) {
    const textBlock = response.content.find((block: any) => block.type === 'text');
    return textBlock?.text || '';
  }
  
  // OpenAI API 格式
  if (response.choices?.[0]?.message?.content) {
    return response.choices[0].message.content;
  }
  
  // 直接字符串
  if (typeof response === 'string') {
    return response;
  }
  
  // 其他格式
  if (response.content) {
    return typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
  }
  
  return '';
}

/**
 * 获取 Skill 默认模板（用于快速创建页面）
 */
export function getSkillDefaultTemplate(): string {
  return `---
name: skill-name
description: 检测 [漏洞类型] 相关的安全问题。当用户要求审计 [关键词1]、[关键词2] 时触发，
  即使未明确提及漏洞名称也应激活。
---

# [漏洞名称] 检测

## 检测目标
识别代码中 [具体漏洞类型] 的风险点，重点关注：
- [风险点1]
- [风险点2]
- [风险点3]

## 检查要点
1. 查找 [危险模式/函数]
2. 检查 [安全措施] 的使用情况
3. 分析 [输入来源] 的验证逻辑

## 示例（重要！）

**输入代码（存在漏洞）：**
\`\`\`
// 危险代码示例
\`\`\`

**检测结果：**
❌ [漏洞类型] 风险：[具体描述]
位置：[文件名:行号]

## CWE 编号
CWE-XXX（可选）

## 工具要求
- read_file
- search_pattern
- [其他必要工具]`;
}

/**
 * 获取 Skill 格式建议（用于快速创建页面提示）
 */
export function getSkillFormatGuide(): string {
  return `## 优秀 Skill 的关键原则

1. **Description 是触发机制（最重要）**
   - 必须包含：做什么 + 何时触发 + 关键触发词
   - 用第三人称写，明确列出触发场景

2. **简洁至上（<500行）**
   - 只添加 Agent 不知道的内容
   - 用指令而非散文

3. **提供示例（重要！）**
   - 展示漏洞代码 + 检测结果范例

4. **描述目标，不预设步骤**
   - 让 Agent 决定执行路径

## 推荐章节
- ## 检测目标
- ## 检查要点
- ## 示例 ⭐重要
- ## CWE 编号
- ## 工具要求

注意：输出格式由系统自动添加，无需手动编写。`;
}

/**
 * 格式建议详细数据（用于 UI 组件）
 */
export interface FormatGuideData {
  example: {
    yaml: string;
    content: string;
  };
  principles: Array<{
    title: string;
    description: string;
  }>;
  mistakes: Array<{
    wrong: string;
    wrongCode: string;
    right: string;
    rightCode: string;
  }>;
  sections: Array<{
    name: string;
    highlight?: boolean;
  }>;
}

/**
 * 获取格式建议详细数据（用于 UI 渲染）
 */
export function getFormatGuideData(): FormatGuideData {
  return {
    example: {
      yaml: `---
name: sql-injection-detection
description: 检测 SQL 注入漏洞，分析用户输入拼接 SQL 语句的风险点。
  当用户要求审计 SQL 注入、数据库注入、查询拼接时触发，
  即使未明确提及 'SQL' 也应激活。
---`,
      content: `# SQL 注入检测

## 检测目标
识别代码中用户输入直接拼接 SQL 语句的漏洞点...

## 检查要点
1. 查找字符串拼接 SQL 的模式
2. 检查参数化查询的使用情况
3. 分析输入验证和过滤逻辑

## 示例（重要！）

**输入代码：**
query = "SELECT * FROM users WHERE id = " + userId

**检测结果：**
❌ SQL 注入风险：用户输入 userId 直接拼接
位置：[文件名:行号]

## CWE 编号
CWE-89

## 工具要求
- read_file
- search_pattern`,
    },
    principles: [
      {
        title: '✅ Description 是触发机制',
        description: '必须包含"做什么 + 何时触发"，用第三人称写。Agent 根据此字段判断是否加载 Skill。',
      },
      {
        title: '✅ 简洁至上（<500行）',
        description: '只添加 Agent 不知道的内容。用指令而非散文："Always use X" 不是 "The X API is recommended."',
      },
      {
        title: '✅ 提供具体示例',
        description: '展示输入/输出范例，Agent 能从示例中学习预期格式比长段落解释更有效。',
      },
      {
        title: '✅ 描述目标，不预设步骤',
        description: '易出错操作要具体步骤；多种方法有效时可给出目标而非路径。',
      },
    ],
    mistakes: [
      {
        wrong: 'Description 太模糊',
        wrongCode: '"Helps with security"',
        right: '具体明确，包含触发条件',
        rightCode: '"检测 SQL 注入漏洞。当审计 SQL、数据库注入时触发"',
      },
      {
        wrong: '过度预设步骤',
        wrongCode: '"Step 1: Read file. Step 2: Parse JSON."',
        right: '描述目标，让 Agent 决定路径',
        rightCode: '"Extract and validate user data from JSON"',
      },
    ],
    sections: [
      { name: '# Skill 名称' },
      { name: '## 检测目标' },
      { name: '## 检查要点' },
      { name: '## 示例', highlight: true },
      { name: '## CWE 编号' },
      { name: '## 工具要求' },
    ],
  };
}