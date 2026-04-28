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
- **漏洞代码**：[漏洞点到攻击入口的所有源代码]
- **描述**：[具体漏洞描述]`;

/**
 * 构建 Skill 系统提示词（给大模型的指令）
 * 基于计划文件的标准模板结构
 */
export function buildSystemPrompt(): string {
  return `你是一个专业的 AI Skill 专家，专门为代码安全审计 Agent 编写高质量 Skill 定义。

## ⛔ 禁止生成的内容（系统会自动添加）

**以下内容绝对不要生成，否则会导致重复：**

1. ❌ **YAML frontmatter**（--- name: xxx description: xxx ---）
   - 系统会自动添加

2. ❌ **一级标题**（# 漏洞名称 / # Skill 名称）
   - 系统会自动添加 Skill 标题

3. ❌ **## 输出格式** 或 **## 输出要求** 或 **## 工具要求** 章节
   - 系统会自动添加标准输出格式

**你的输出应该直接从 ## 0. 角色定位 开始**

---

## 必须包含的章节（按顺序）

### 1. ## 0. 角色定位（章节格式，而非 blockquote）
使用章节标题定义专家角色：

格式：
## 0. 角色定位
- 你是专门检测 [漏洞类型] 的安全专家
- 你的核心职责是...
- 你不负责...（明确边界）

示例：
## 0. 角色定位
- 你是专门检测 SQL 注入漏洞的安全专家
- 你的核心职责是识别代码中 SQL 注入相关的风险点
- 你不负责 NoSQL 注入的检测

### 2. ## 1. 漏洞概述（新增）
包含三要素：

格式：
## 1. 漏洞概述
- [漏洞类型] 的定义：[简要描述]
- 常见危害：[真实案例]

### 3. ## 输入格式
明确 Agent 接收什么输入：

格式：
## 输入格式
你将接收：
- 源代码文件（[语言列表]）
- 文件路径和函数上下文
- 可选：用户指定的重点审查区域

### 4. ## 2. 检测目标
列出要检测的具体风险类型（3-5条）。

### 5. ## 3. 检测步骤（细分结构，重要！）
分为三个子步骤：

格式：
## 3. 检测步骤

### 3.1 入口识别
- 如何找到检测入口
- 哪些模式值得深入

### 3.2 数据流追踪
- 用户输入 → 数据处理 → 输出/存储
- 关键变量命名模式

### 3.3 漏洞确认
- 如何验证漏洞存在
- 哪些是误报需要排除

### 6. ## 4. 漏洞示例（至少 2 个）
必须包含基础漏洞 + 隐蔽漏洞两个示例：

格式：
### 4.1 基础示例
**有漏洞的代码：**
[代码片段]

**检测结果：**
❌ [漏洞类型] 风险：[描述]
漏洞代码：[漏洞点到攻击入口的所有源代码]

### 4.2 隐蔽示例
**看似安全的代码：**
[隐蔽漏洞代码]

**检测结果：**
[检测结果]

### 7. ## 5. 陷阱与边缘情况（最重要）
列出误报陷阱、漏报陷阱、边界情况：

格式：
## 5. 陷阱与边缘情况（最重要）
- **误报陷阱 1**：[描述]
- **漏报陷阱**：[描述]
- **边界情况**：[描述]

## 输出格式示例

正确输出示例（直接从 ## 0. 角色定位 开始，无 YAML、无一级标题、无输出格式章节）：

## 0. 角色定位
- 你是专门检测 SQL 注入漏洞的安全专家
- 你的核心职责是识别用户输入与 SQL 语句拼接的风险点
- 你不负责 NoSQL 注入的检测

## 1. 漏洞概述
- SQL 注入的定义：用户输入直接拼接 SQL 语句...
- 常见危害：数据泄露、权限绕过
- CWE/CVE 参考：CWE-89

## 输入格式
你将接收：
- 源代码文件（Java, Python, PHP, jar ,war）

## 2. 检测目标
识别用户输入拼接 SQL 语句的风险点...

## 3. 检测步骤
### 3.1 入口识别
- 搜索关键词：executeQuery, query, raw
...

### 3.2 数据流追踪
- 用户输入 → SQL 拼接 → 数据库执行
...

### 3.3 漏洞确认
- 检查是否使用参数化查询
...

## 4. 漏洞示例
### 4.1 基础示例
**有漏洞的代码：**
query = "SELECT * FROM users WHERE id = " + userId
...

### 4.2 隐蔽示例
...

## 5. 陷阱与边缘情况（最重要）
- **误报陷阱 1**：ORM raw() 方法仍可能存在注入风险
`;
}

/**
 * 构建 Skill 用户提示词（用户意图）
 * 基于计划文件的标准模板结构
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
3. ❌ ## 输出格式 或 ## 输出要求 或 ## 工具要求 章节

**直接从 ## 0. 角色定位 开始输出**

## 必须包含的章节（按顺序）

1. **## 0. 角色定位**（章节标题格式）
   - 你是专门检测 [漏洞类型] 的安全专家
   - 你的核心职责是...
   - 你不负责...（明确边界）

2. **## 1. 漏洞概述**
   - 漏洞定义
   - 常见危害

3. **## 2. 输入格式**
   - 源代码文件（[语言列表]）
   - 文件路径和上下文

4. **## 3. 检测目标**
   - 具体风险类型（3-5条）

5. **## 4. 检测步骤**（细分结构）
   - ### 4.1 入口识别
   - ### 4.2 数据流追踪
   - ### 4.3 漏洞确认

6. **## 5. 漏洞示例**（至少 2 个）
   - ### 5.1 基础示例
   - ### 5.2 隐蔽示例

7. **## 6. 陷阱与边缘情况**
   - 误报陷阱
   - 漏报陷阱
   - 边界情况`;
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
	lines.push('allowed-tools: mcp__ai4java__decompileProject mcp__ai4java__scanClassMethodSource mcp__ai4java__scanClassMethodAllPathSources');
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
  
  // 使用正则移除所有 "## 输出格式" 或 "## 输出要求" 或 "## 工具要求"  章节
  // 正则说明：
  // - ##\s*输出格式 - 匹配章节标题
  // - [\s\S]*? - 非贪婪匹配任意内容（包括换行）
  // - (?=\n##|$) - 向前断言：遇到下一个 ## 章节或文件结束
  
  // 先处理开头的情况（前面没有换行）
  content = content.replace(/^##\s*输出格式[\s\S]*?(?=\n##|$)/gi, '');
  content = content.replace(/^##\s*输出要求[\s\S]*?(?=\n##|$)/gi, '');
  content = content.replace(/^##\s*工具要求[\s\S]*?(?=\n##|$)/gi, '');
  
  // 再处理中间的情况（前面有换行）
  content = content.replace(/\n##\s*输出格式[\s\S]*?(?=\n##|$)/gi, '');
  content = content.replace(/\n##\s*输出要求[\s\S]*?(?=\n##|$)/gi, '');
  content = content.replace(/\n##\s*工具要求[\s\S]*?(?=\n##|$)/gi, '');
  
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
 * 基于计划文件的标准模板结构
 */
export function getSkillDefaultTemplate(): string {
  return `---
name: skill-name
description: |
  [角色定位] [漏洞类型] 检测专家
  适用技术栈：[语言/框架]
  触发条件：[关键词/场景]
  不适用场景：[明确排除，指引用户使用其他 Skill]
---

# [漏洞类型] 安全检测 Skill

## 0. 角色定位

- 你是专门检测 [漏洞类型] 的安全专家
- 你的核心职责是识别代码中 [漏洞类型] 相关的风险点
- 你不负责 [其他漏洞类型] 的检测（如需检测其他漏洞，请使用对应的 Skill）

## 1. 漏洞概述

- [漏洞类型] 的定义：[简要描述漏洞本质]
- 常见危害：[真实案例简述，如数据泄露、权限绕过等]

## 输入格式

你将接收：
- 源代码文件（[语言列表]）
- 文件路径和函数上下文
- 可选：用户指定的重点审查区域

## 2. 检测目标

识别代码中 [漏洞类型] 的风险点，重点关注：
- [风险点1]：[具体描述]
- [风险点2]：[具体描述]
- [风险点3]：[具体描述]

## 3. 检测步骤

### 3.1 入口识别

- 如何找到检测入口：[搜索关键词、特定函数名、配置文件等]
- 哪些模式值得深入：[如用户输入接收点、数据处理函数等]

### 3.2 数据流追踪

- 用户输入 → 数据处理 → 输出/存储 的完整路径
- 关键变量命名模式：[如 userId, password, query 等]
- 关注数据是否经过验证/过滤/转换

### 3.3 漏洞确认

- 如何验证漏洞存在：[如构造测试输入、检查输出结果]
- 哪些是误报需要排除：[如已使用安全措施、上下文证明安全]

## 4. 漏洞示例

### 4.1 基础示例

**有漏洞的代码：**
\`\`\`[语言]
// [具体漏洞代码]
\`\`\`

**检测结果：**
❌ [漏洞类型] 风险：[具体描述]
漏洞代码：[漏洞点到攻击入口的所有源代码]

### 4.2 隐蔽示例

**看似安全的代码：**
\`\`\`[语言]
// [隐蔽漏洞代码 - 看似使用了安全措施但实际仍有风险]
\`\`\`

**检测结果：**
❌ [漏洞类型] 风险：[隐蔽原因描述]
漏洞代码：[漏洞点到攻击入口的所有源代码]

## 5. 陷阱与边缘情况（最重要）

- **误报陷阱 1**：[看似漏洞但实际安全的代码模式]
- **误报陷阱 2**：[需要上下文才能判断的情况]
- **漏报陷阱**：[容易遗漏的漏洞变体]
- **边界情况**：[特殊情况的处理建议]

`;
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
 * 基于计划文件的标准模板结构
 */
export function getFormatGuideData(): FormatGuideData {
  return {
    example: {
      yaml: `---
name: sql-injection-detection
description: |
  SQL 注入检测专家
  适用技术栈：Java, Python, PHP, Node.js
  触发条件：用户要求审计 SQL 注入、数据库注入、查询拼接风险
  不适用场景：NoSQL 注入请使用 nosql-injection-detection Skill
---`,
      content: `# SQL 注入安全检测 Skill

## 0. 角色定位

- 你是专门检测 SQL 注入漏洞的安全专家
- 你的核心职责是识别代码中 SQL 注入相关的风险点
- 你不负责 NoSQL 注入的检测（如需检测请使用 nosql-injection Skill）

## 1. 漏洞概述

- SQL 注入的定义：用户输入直接拼接 SQL 语句导致恶意查询执行
- 常见危害：数据泄露、权限绕过、数据库破坏
- CWE/CVE 参考：CWE-89

## 输入格式

你将接收：
- 源代码文件（Java, Python, PHP, Node.js）
- 文件路径和函数上下文

## 2. 检测目标

识别代码中 SQL 注入的风险点...

## 3. 检测步骤

### 3.1 入口识别
- 搜索关键词：executeQuery, query, raw
- 关注用户输入接收点

### 3.2 数据流追踪
- 用户输入 → SQL 拼接 → 数据库执行

### 3.3 漏洞确认
- 检查是否使用参数化查询

## 4. 漏洞示例

### 4.1 基础示例
**有漏洞的代码：**
query = "SELECT * FROM users WHERE id = " + userId

**检测结果：**
❌ SQL 注入风险：用户输入 userId 直接拼接
漏洞代码：[漏洞点到攻击入口的所有源代码]

### 4.2 隐蔽示例
**看似安全的代码：**
User.where("name = '" + name + "'")

**检测结果：**
❌ SQL 注入风险：ORM raw 条件拼接
漏洞代码：[漏洞点到攻击入口的所有源代码]


## 5. 陷阱与边缘情况（最重要）

- **误报陷阱 1**：ORM 的 raw() 方法仍可能存在注入风险
- **漏报陷阱**：使用预处理语句但动态拼接列名仍然危险
- **边界情况**：某些 query builder 在特定用法下不安全`,
    },
    principles: [
      {
        title: '✅ 角色定位（章节格式）',
        description: '使用 ## 0. 角色定位 章节标题定义专家角色，而非 blockquote。明确职责边界。',
      },
      {
        title: '✅ 漏洞概述',
        description: '包含漏洞定义、常见危害、CWE/CVE 参考三要素，帮助 Agent 理解漏洞本质。',
      },
      {
        title: '✅ 输入格式',
        description: '明确告诉 Agent 将接收什么输入（代码语言、文件路径、可选参数）。',
      },
      {
        title: '✅ 检测步骤（细分结构）',
        description: '分为 入口识别、数据流追踪、漏洞确认 三个子步骤，提供清晰的检测流程。',
      },
      {
        title: '✅ 漏洞示例（至少 2 个）',
        description: '基础漏洞 + 隐蔽漏洞两个示例，展示有漏洞的代码和检测结果格式。',
      },
      {
        title: '✅ 陷阱与边缘情况',
        description: '列出误报陷阱、漏报陷阱、边界情况，帮助 Agent 避免常见错误判断。',
      },
    ],
    mistakes: [
      {
        wrong: '角色定位用 blockquote',
        wrongCode: '> 你是一个资深安全工程师...',
        right: '使用章节标题',
        rightCode: '## 0. 角色定位\n- 你是专门检测 [漏洞] 的安全专家',
      },
      {
        wrong: '缺少漏洞概述',
        wrongCode: '直接开始 ## 检测目标',
        right: '添加漏洞概述章节',
        rightCode: '## 1. 漏洞概述\n- 定义、危害、CWE 参考',
      },
      {
        wrong: '检测步骤无细分',
        wrongCode: '## 检查要点\n1. 查找...\n2. 检查...',
        right: '分为三个子步骤',
        rightCode: '## 3. 检测步骤\n### 3.1 入口识别\n### 3.2 数据流追踪\n### 3.3 漏洞确认',
      },
    ],
    sections: [
      { name: '## 0. 角色定位', highlight: true },
      { name: '## 1. 漏洞概述' },
      { name: '## 输入格式' },
      { name: '## 2. 检测目标' },
      { name: '## 3. 检测步骤', highlight: true },
      { name: '## 4. 漏洞示例', highlight: true },
      { name: '## 5. 陷阱与边缘情况', highlight: true },
    ],
  };
}