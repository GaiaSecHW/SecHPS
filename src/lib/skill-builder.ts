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
  return `你是一个专业的 AI Skill 专家，专门为代码安全审计 Agent 编写高质量 Skill 定义。

## ⛔ 禁止生成的内容（系统会自动添加）

**以下内容绝对不要生成，否则会导致重复：**

1. ❌ **YAML frontmatter**（--- name: xxx description: xxx ---）
   - 系统会自动添加

2. ❌ **一级标题**（# 漏洞名称 / # Skill 名称）
   - 系统会自动添加 Skill 标题

3. ❌ **## 输出格式** 或 **## 输出要求** 章节
   - 系统会自动添加标准输出格式

**你的输出应该直接从角色定位开始：**
> 你是一个资深安全工程师，专注于 [漏洞类型] 分析...

---

## 角色定位（Role Framing）

生成的 Skill 正文开头必须包含角色定位，让 Agent 知道自己是哪个领域的专家。

格式：
> 你是一个资深安全工程师，专注于 [漏洞类型] 分析...

示例：
> 你是一个资深安全工程师，专注于 SQL 注入漏洞分析。你擅长识别用户输入与 SQL 语句拼接的风险点，并对 ORM 框架的潜在漏洞有深入理解。

## 输入格式定义（Input Format）

必须明确告诉 Agent 将接收什么输入，避免 Agent 不确定要处理什么。

格式：
## 输入格式
你将接收：
- 源代码文件（[语言列表]）
- 文件路径和上下文
- 可选：特定函数或端点

示例：
## 输入格式
你将接收：
- 源代码文件（Java, Python, PHP, Node.js）
- 文件路径和函数名
- 可选：用户指定的重点审查区域

## 必须包含的章节

生成的 Skill 必须包含以下章节：

### 1. ## 检测目标
明确列出要检测的具体风险类型（3-5条）。

### 2. ## 检查要点
按优先级列出检查步骤，用指令风格：
- "查找..." 而非 "你应该查找..."
- "检查..." 而非 "接下来检查..."

### 3. ## 示例（最重要！）
必须包含至少 **2 个示例**：
- 示例 1：基础漏洞场景
- 示例 2：复杂/隐蔽漏洞场景

每个示例格式：
**输入代码：**
[漏洞代码片段]

**检测结果：**
❌ [漏洞类型] 风险：[具体描述]
位置：[文件名:行号]
风险等级：[高危/中危/低危]

### 4. ## 陷阱与边缘情况（Gotchas）
列出容易被忽略或误判的情况：
- ORM 框架的隐藏漏洞
- 看似安全但实际危险的代码模式
- 常见的误报场景

示例：
## 陷阱与边缘情况
- ORM 框架的 raw() 方法仍可能存在注入风险
- 使用预处理语句但动态拼接列名仍然危险
- 某些框架的 query builder 在特定用法下不安全

### 5. ## CWE 编号
列出相关 CWE，如有多个用逗号分隔。

### 6. ## 工具要求
列出 Agent 需要使用的工具名称。

## 简洁原则

- 总行数 < 500 行
- 只添加 Agent 不知道的内容
- 用指令而非散文："Always use X" 不是 "The X API is recommended"
- 描述目标，不预设步骤

## 输出格式示例

正确输出示例（直接从角色定位开始，无 YAML、无一级标题、无输出格式章节）：

> 你是一个资深安全工程师，专注于 SQL 注入漏洞分析...

## 输入格式
你将接收：
- 源代码文件（Java, Python, PHP）

## 检测目标
识别用户输入拼接 SQL 语句的风险点...

## 检查要点
1. 查找字符串拼接 SQL 的模式
...

## 示例（重要！）
### 示例 1：基础注入
...

### 示例 2：ORM 隐蔽注入
...

## 陷阱与边缘情况
- ORM raw() 方法仍可能存在注入风险
...

## CWE 编号
CWE-89

## 工具要求
- read_file
- search_pattern`;
}

/**
 * 构建 Skill 用户提示词（用户意图）
 * 针对缺陷发现 Skill 的意图描述
 */
export function buildUserPrompt(intent: SkillIntent): string {
  return `请生成一个完整的缺陷检测 Skill 定义：

## 用户意图
- **名称**：${intent.name || '未提供'}
- **分类**：${intent.category || 'vulnerability-detection'}
- **功能**：${intent.whatDoesItDo || intent.description || '检测安全漏洞'}
- **触发条件**：${intent.whenShouldItTrigger || '用户要求审计相关漏洞'}

## ⛔ 禁止生成（系统会自动添加）

**以下内容绝对不要生成：**
1. ❌ YAML frontmatter（--- name: xxx ---）
2. ❌ 一级标题（# 漏洞名称）
3. ❌ ## 输出格式 或 ## 输出要求 章节

**直接从角色定位开始输出：**
> 你是一个资深安全工程师，专注于 [漏洞类型] 分析...

## 必须包含的章节

1. **> Role Framing**（开头角色定位）
2. **## 输入格式**（Agent 接收什么）
3. **## 检测目标**（具体风险类型）
4. **## 检查要点**（按优先级的检查步骤）
5. **## 示例**（至少 2 个：基础漏洞 + 隐蔽漏洞）
6. **## 陷阱与边缘情况**（容易忽略/误判的情况）
7. **## CWE 编号**（相关漏洞编号）
8. **## 工具要求**（Agent 需要的工具）`;
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
 * 清理 Markdown 内容（导出版本）
 * 移除系统自动添加的章节，用于传给大模型优化时去除重复内容
 */
export function cleanSkillContentForOptimization(content: string): string {
  return cleanMarkdownContent(content);
}

/**
 * 清理 Markdown 内容
 * 移除大模型可能误生成的章节（系统会自动添加）
 */
function cleanMarkdownContent(content: string): string {
  content = content.trim();
  
  // 移除代码块包装
  const markdownBlockMatch = content.match(/^```markdown\s*([\s\S]*?)\s*```$/s);
  if (markdownBlockMatch) {
    content = markdownBlockMatch[1].trim();
  }
  
  const codeBlockMatch = content.match(/^```\s*([\s\S]*?)\s*```$/s);
  if (codeBlockMatch) {
    content = codeBlockMatch[1].trim();
  }
  
  // 移除可能存在的 YAML frontmatter（如果大模型误生成）
  const yamlMatch = content.match(/^---[\s\S]*?---\s*/);
  if (yamlMatch) {
    content = content.substring(yamlMatch[0].length);
  }
  
  // 移除开头的一级标题（# 标题）
  const titleMatch = content.match(/^#\s+[^\n]+\n?/);
  if (titleMatch) {
    content = content.substring(titleMatch[0].length);
  }
  
  // 使用正则移除所有 "## 输出格式" 或 "## 输出要求" 章节
  // 正则说明：
  // - ##\s*输出格式 - 匹配章节标题
  // - [\s\S]*? - 非贪婪匹配任意内容（包括换行）
  // - (?=\n##|$) - 向前断言：遇到下一个 ## 章节或文件结束
  
  // 先处理开头的情况（前面没有换行）
  content = content.replace(/^##\s*输出格式[\s\S]*?(?=\n##|$)/gi, '');
  content = content.replace(/^##\s*输出要求[\s\S]*?(?=\n##|$)/gi, '');
  
  // 再处理中间的情况（前面有换行）
  content = content.replace(/\n##\s*输出格式[\s\S]*?(?=\n##|$)/gi, '');
  content = content.replace(/\n##\s*输出要求[\s\S]*?(?=\n##|$)/gi, '');
  
  // 清理多余的空行
  content = content.replace(/\n{3,}/g, '\n\n');
  
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
 * 针对缺陷发现 Skill 的标准模板
 */
export function getSkillDefaultTemplate(): string {
  return `---
name: skill-name
description: 检测 [漏洞类型] 相关的安全问题。Use when 用户要求审计 [关键词1]、[关键词2]，
  当提及 '[隐式触发词1]'、'[隐式触发词2]' 等关键词时也应激活，即使未明确提及漏洞名称。
---

# [漏洞名称] 检测

> 你是一个资深安全工程师，专注于 [漏洞类型] 分析。你擅长识别 [核心风险点]，并对 [相关框架/技术] 的潜在漏洞有深入理解。

## 输入格式

你将接收：
- 源代码文件（[语言列表]）
- 文件路径和函数上下文
- 可选：用户指定的重点审查区域

## 检测目标

识别代码中 [具体漏洞类型] 的风险点，重点关注：
- [风险点1]
- [风险点2]
- [风险点3]

## 检查要点

1. 查找 [危险模式/函数/方法]
2. 检查 [安全措施] 的使用情况
3. 分析 [输入来源] 的验证逻辑
4. 审查 [边界条件] 的处理方式

## 示例（重要！）

### 示例 1：基础漏洞

**输入代码：**
\`\`\`
// 危险代码示例
\`\`\`

**检测结果：**
❌ [漏洞类型] 风险：[具体描述]
位置：[文件名:行号]
风险等级：[高危/中危/低危]

### 示例 2：隐蔽漏洞

**输入代码：**
\`\`\`
// 看似安全但实际危险的代码
\`\`\`

**检测结果：**
❌ [漏洞类型] 风险：[隐蔽原因描述]
位置：[文件名:行号]
风险等级：[高危/中危/低危]

## 陷阱与边缘情况

- [ORM/框架] 的 [方法] 仍可能存在风险
- 看似使用安全措施但实际无效的模式
- [常见误报场景]

## CWE 编号

CWE-XXX

## 工具要求

- read_file
- search_pattern
- [其他必要工具]`;
}

/**
 * 获取 Skill 格式建议（用于快速创建页面提示）
 */
export function getSkillFormatGuide(): string {
  return `## 缺陷发现 Skill 的关键原则

1. **Role Framing（角色定位）** - 开头定义 Agent 是哪个领域的专家
   - 格式：> 你是一个资深安全工程师，专注于 [漏洞类型] 分析...

2. **Input Format（输入格式）** - 明确 Agent 接收什么输入
   - 源代码语言、文件路径、可选参数

3. **Description Use when 模式** - 触发机制
   - 做什么 + 何时触发 + 隐式触发词
   - 即使未明确提及漏洞名也应激活

4. **多示例（至少 2 个）** - 基础漏洞 + 隐蔽漏洞
   - 展示输入代码 + 检测结果格式

5. **Gotchas（陷阱与边缘情况）** - 容易忽略/误判的情况
   - ORM 框架隐藏漏洞、看似安全的危险模式

6. **简洁至上（<500行）** - 用指令而非散文

## 推荐章节
- > Role Framing（角色定位） ⭐
- ## 输入格式
- ## 检测目标
- ## 检查要点
- ## 示例（至少 2 个） ⭐重要
- ## 陷阱与边缘情况 ⭐
- ## CWE 编号
- ## 工具要求

注意：YAML frontmatter 和输出格式由系统自动添加，无需手动编写。`;
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
 * 针对缺陷发现 Skill 的格式指导
 */
export function getFormatGuideData(): FormatGuideData {
  return {
    example: {
      yaml: `---
name: sql-injection-detection
description: 检测 SQL 注入漏洞。Use when 用户要求审计 SQL 注入、数据库注入、查询拼接风险。
  当提及 'database query'、'user input'、'sanitize' 等关键词时也应激活，即使未明确提及 'SQL'。
---`,
      content: `# SQL 注入检测

> 你是一个资深安全工程师，专注于 SQL 注入漏洞分析。你擅长识别用户输入与 SQL 语句拼接的风险点，并对 ORM 框架的潜在漏洞有深入理解。

## 输入格式

你将接收：
- 源代码文件（Java, Python, PHP, Node.js）
- 文件路径和函数上下文
- 可选：用户指定的重点审查区域

## 检测目标

识别代码中 SQL 注入的风险点...

## 检查要点

1. 查找字符串拼接 SQL 的模式
2. 检查参数化查询的使用情况
3. 分析输入验证和过滤逻辑

## 示例（重要！）

### 示例 1：基础注入
**输入代码：**
query = "SELECT * FROM users WHERE id = " + userId

**检测结果：**
❌ SQL 注入风险：用户输入 userId 直接拼接
位置：[文件名:行号]
风险等级：高危

### 示例 2：ORM 隐蔽注入
**输入代码：**
User.where("name = '" + name + "'")

**检测结果：**
❌ SQL 注入风险：ORM raw 条件拼接
位置：[文件名:行号]
风险等级：高危

## 陷阱与边缘情况

- ORM 的 raw() 方法仍可能存在注入风险
- 使用预处理语句但动态拼接列名仍然危险
- 某些 query builder 在特定用法下不安全

## CWE 编号

CWE-89

## 工具要求

- read_file
- search_pattern`,
    },
    principles: [
      {
        title: '✅ Role Framing（角色定位）',
        description: 'Skill 开头必须定义 Agent 是哪个领域的专家，增强专业性。格式：> 你是一个资深安全工程师，专注于 [漏洞类型] 分析...',
      },
      {
        title: '✅ Input Format（输入格式）',
        description: '明确告诉 Agent 将接收什么输入（代码语言、文件路径、可选参数），避免不确定性。',
      },
      {
        title: '✅ Description Use when 模式',
        description: 'Description 必须包含"做什么 + 何时触发 + 隐式触发词"。即使未明确提及漏洞名也应激活。',
      },
      {
        title: '✅ 多示例（至少 2 个）',
        description: '基础漏洞 + 隐蔽/复杂漏洞两个示例，展示输入代码和检测结果格式。',
      },
      {
        title: '✅ Gotchas（陷阱与边缘情况）',
        description: '列出容易被忽略或误判的情况：框架隐藏漏洞、看似安全的危险模式、常见误报。',
      },
      {
        title: '✅ 简洁至上（<500行）',
        description: '只添加 Agent 不知道的内容。用指令而非散文："Always use X" 不是 "The X API is recommended."',
      },
    ],
    mistakes: [
      {
        wrong: '缺少角色定位',
        wrongCode: '直接开始 ## 检测目标',
        right: '开头定义专家角色',
        rightCode: '> 你是一个资深安全工程师，专注于 SQL 注入分析...',
      },
      {
        wrong: 'Description 太模糊',
        wrongCode: '"Helps with security"',
        right: 'Use when 模式 + 隐式触发',
        rightCode: '"检测 SQL 注入。Use when 审计 SQL、数据库注入。提及 query、input 也激活"',
      },
      {
        wrong: '只有一个示例',
        wrongCode: '只展示基础拼接注入',
        right: '基础 + 隐蔽两个示例',
        rightCode: '示例 1：基础注入 + 示例 2：ORM raw 方法注入',
      },
      {
        wrong: '缺少陷阱章节',
        wrongCode: '不列出边缘情况',
        right: 'Gotchas 章节',
        rightCode: '## 陷阱与边缘情况：ORM raw 风险、预处理语句动态列名...',
      },
    ],
    sections: [
      { name: '> Role Framing（角色定位）', highlight: true },
      { name: '## 输入格式' },
      { name: '## 检测目标' },
      { name: '## 检查要点' },
      { name: '## 示例（重要！）', highlight: true },
      { name: '## 陷阱与边缘情况', highlight: true },
      { name: '## CWE 编号' },
      { name: '## 工具要求' },
    ],
  };
}