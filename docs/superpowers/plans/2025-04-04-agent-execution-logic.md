# Agent 执行逻辑实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现真实的 Agent 执行引擎，将 ScanExecutor 中的模拟执行替换为实际的 AI 调用，支持工具调用和漏洞检测。

**Architecture:** 创建 AgentExecutor 类，集成现有的 EvaluationCaller 和 AI 服务，实现 Skill 的真实执行。支持工具调用、结果解析、漏洞报告生成。

**Tech Stack:** Next.js 16, TypeScript, Prisma ORM, AI Services (Claude)

---

## 现状分析

当前实现：
- `src/lib/scan-executor.ts` - 扫描执行引擎，使用模拟执行（`simulateExecution`）
- `src/services/evaluation/caller.ts` - AI 调用器，支持流式响应
- `src/services/ai/` - AI 提供商抽象层
- `src/app/api/agent/execute/route.ts` - Agent 执行 API，已有基础实现

需要实现：
1. 真实的 Skill 执行逻辑（替换模拟）
2. 工具调用支持（read_file, search_pattern 等）
3. 执行结果解析和漏洞检测
4. 执行上下文管理

---

## 文件结构

```
src/lib/
├── scan-executor.ts          # 修改：集成真实执行
├── agent-executor.ts         # 新增：Agent 执行引擎
├── tool-executor.ts          # 已有：工具执行器
├── result-parser.ts          # 新增：结果解析器
└── prompt-templates/         # 新增：Prompt 模板
    ├── index.ts
    └── skill-prompts.ts

src/app/api/agent/
├── execute/route.ts          # 修改：使用 AgentExecutor
└── chat/route.ts             # 修改：支持工具调用
```

---

## Task 1: 创建结果解析器

**Files:**
- Create: `src/lib/result-parser.ts`

**说明:** 解析 AI 响应，提取漏洞信息、工具调用请求等结构化数据。

- [ ] **Step 1: 创建结果解析器**

```typescript
// src/lib/result-parser.ts

/**
 * 解析 AI 响应中的结构化信息
 */

export interface ParsedVulnerability {
  title: string;
  description: string;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  codeSnippet?: string;
  recommendation?: string;
  cwe?: string;
  cve?: string;
  confidence: number; // 0-100
}

export interface ParsedToolCall {
  tool: string;
  parameters: Record<string, unknown>;
  callId?: string;
}

export interface ParsedResult {
  vulnerabilities: ParsedVulnerability[];
  toolCalls: ParsedToolCall[];
  summary: string;
  rawResponse: string;
  needsToolCall: boolean;
}

// 工具调用正则表达式模式
const TOOL_CALL_PATTERN = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
const TOOL_NAME_PATTERN = /"tool"\s*:\s*"([^"]+)"/;
const TOOL_PARAMS_PATTERN = /"parameters"\s*:\s*(\{[\s\S]*?\})/;

// 漏洞报告正则表达式模式
const VULNERABILITY_PATTERN = /<vulnerability>\s*([\s\S]*?)\s*<\/vulnerability>/gi;
const SEVERITY_PATTERN = /"severity"\s*:\s*"(critical|high|medium|low|info)"/i;
const TITLE_PATTERN = /"title"\s*:\s*"([^"]+)"/;
const DESCRIPTION_PATTERN = /"description"\s*:\s*"([^"]+)"/;
const FILE_PATH_PATTERN = /"filePath"\s*:\s*"([^"]+)"/;
const LINE_PATTERN = /"line(?:Start|End)"\s*:\s*(\d+)/g;
const CWE_PATTERN = /"cwe"\s*:\s*"([^"]+)"/;
const CONFIDENCE_PATTERN = /"confidence"\s*:\s*(\d+)/;

// 摘要提取模式
const SUMMARY_PATTERN = /<summary>\s*([\s\S]*?)\s*<\/summary>/i;

/**
 * 解析 AI 响应
 */
export function parseAIResponse(response: string): ParsedResult {
  const vulnerabilities: ParsedVulnerability[] = [];
  const toolCalls: ParsedToolCall[] = [];
  let summary = '';

  // 解析工具调用
  let toolMatch;
  while ((toolMatch = TOOL_CALL_PATTERN.exec(response)) !== null) {
    const toolBlock = toolMatch[1];
    const toolCall = parseToolCall(toolBlock);
    if (toolCall) {
      toolCalls.push(toolCall);
    }
  }

  // 解析漏洞报告
  let vulnMatch;
  while ((vulnMatch = VULNERABILITY_PATTERN.exec(response)) !== null) {
    const vulnBlock = vulnMatch[1];
    const vulnerability = parseVulnerability(vulnBlock);
    if (vulnerability) {
      vulnerabilities.push(vulnerability);
    }
  }

  // 解析摘要
  const summaryMatch = SUMMARY_PATTERN.exec(response);
  if (summaryMatch) {
    summary = summaryMatch[1].trim();
  } else {
    // 如果没有明确的摘要，取前500字符
    summary = response.slice(0, 500).replace(/<[^>]+>/g, '').trim();
    if (summary.length === 0) {
      summary = '分析完成';
    }
  }

  return {
    vulnerabilities,
    toolCalls,
    summary,
    rawResponse: response,
    needsToolCall: toolCalls.length > 0,
  };
}

/**
 * 解析工具调用
 */
function parseToolCall(block: string): ParsedToolCall | null {
  try {
    // 尝试 JSON 解析
    const jsonMatch = block.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        tool: parsed.tool || parsed.name || '',
        parameters: parsed.parameters || parsed.args || {},
        callId: parsed.callId || parsed.id,
      };
    }

    // 使用正则表达式解析
    const toolMatch = block.match(TOOL_NAME_PATTERN);
    if (!toolMatch) return null;

    const paramsMatch = block.match(TOOL_PARAMS_PATTERN);
    const parameters = paramsMatch ? JSON.parse(paramsMatch[1]) : {};

    return {
      tool: toolMatch[1],
      parameters,
    };
  } catch (error) {
    console.error('[ResultParser] 解析工具调用失败:', error);
    return null;
  }
}

/**
 * 解析漏洞信息
 */
function parseVulnerability(block: string): ParsedVulnerability | null {
  try {
    // 尝试 JSON 解析
    const jsonMatch = block.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        title: parsed.title || '未命名漏洞',
        description: parsed.description || '',
        type: parsed.type || 'unknown',
        severity: parseSeverity(parsed.severity),
        filePath: parsed.filePath || parsed.file,
        lineStart: parsed.lineStart || parsed.line,
        lineEnd: parsed.lineEnd || parsed.line,
        codeSnippet: parsed.codeSnippet || parsed.code,
        recommendation: parsed.recommendation || parsed.fix,
        cwe: parsed.cwe,
        cve: parsed.cve,
        confidence: parsed.confidence || 80,
      };
    }

    // 使用正则表达式解析
    const titleMatch = block.match(TITLE_PATTERN);
    if (!titleMatch) return null;

    const severityMatch = block.match(SEVERITY_PATTERN);
    const descriptionMatch = block.match(DESCRIPTION_PATTERN);
    const filePathMatch = block.match(FILE_PATH_PATTERN);
    const cweMatch = block.match(CWE_PATTERN);
    const confidenceMatch = block.match(CONFIDENCE_PATTERN);

    // 解析行号
    let lineStart: number | undefined;
    let lineEnd: number | undefined;
    let lineMatch;
    while ((lineMatch = LINE_PATTERN.exec(block)) !== null) {
      const num = parseInt(lineMatch[1], 10);
      if (lineStart === undefined) {
        lineStart = num;
      }
      lineEnd = num;
    }

    return {
      title: titleMatch[1],
      description: descriptionMatch?.[1] || '',
      type: 'unknown',
      severity: severityMatch ? parseSeverity(severityMatch[1]) : 'medium',
      filePath: filePathMatch?.[1],
      lineStart,
      lineEnd,
      cwe: cweMatch?.[1],
      confidence: confidenceMatch ? parseInt(confidenceMatch[1], 10) : 80,
    };
  } catch (error) {
    console.error('[ResultParser] 解析漏洞失败:', error);
    return null;
  }
}

/**
 * 解析严重程度
 */
function parseSeverity(severity: string | undefined): 'critical' | 'high' | 'medium' | 'low' | 'info' {
  if (!severity) return 'medium';
  
  const normalized = severity.toLowerCase();
  if (normalized === 'critical' || normalized === '严重') return 'critical';
  if (normalized === 'high' || normalized === '高危') return 'high';
  if (normalized === 'medium' || normalized === '中危') return 'medium';
  if (normalized === 'low' || normalized === '低危') return 'low';
  if (normalized === 'info' || normalized === '信息') return 'info';
  
  return 'medium';
}

/**
 * 从响应中提取 JSON 内容
 */
export function extractJSON(response: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  const jsonPattern = /```json\s*([\s\S]*?)\s*```/gi;
  
  let match;
  while ((match = jsonPattern.exec(response)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      results.push(parsed);
    } catch {
      // 忽略解析错误
    }
  }
  
  // 尝试直接解析 JSON 对象
  const jsonObjectPattern = /\{[\s\S]*?\}/g;
  while ((match = jsonObjectPattern.exec(response)) !== null) {
    try {
      const parsed = JSON.parse(match[0]);
      if (typeof parsed === 'object' && parsed !== null) {
        results.push(parsed);
      }
    } catch {
      // 忽略解析错误
    }
  }
  
  return results;
}

---

## Task 2: 创建 AgentExecutor 类

**Files:**
- Create: `src/lib/agent-executor.ts`

**说明:** 创建 Agent 执行引擎，集成 AI 调用、工具执行和结果解析。

- [ ] **Step 1: 创建 AgentExecutor 类**

实现以下核心功能：
- 执行 Skill 并调用 AI
- 处理工具调用循环
- 解析 AI 响应并提取漏洞
- 保存漏洞到数据库
- 支持 SSE 回调

- [ ] **Step 2: 提交**

```bash
git add src/lib/agent-executor.ts
git commit -m "feat(lib): add AgentExecutor for real AI-powered skill execution"
```

---

## Task 3: 更新 ScanExecutor 集成 AgentExecutor

**Files:**
- Modify: `src/lib/scan-executor.ts`

- [ ] **Step 1: 添加导入和成员变量**

导入 AgentExecutor 并添加 activeExecutors Map。

- [ ] **Step 2: 添加模型配置获取方法**

从环境变量或数据库获取模型配置。

- [ ] **Step 3: 修改 executeSkill 方法**

使用 AgentExecutor 替代模拟执行，无模型配置时回退到模拟。

- [ ] **Step 4: 提交**

```bash
git add src/lib/scan-executor.ts
git commit -m "feat(scan): integrate AgentExecutor for real AI-powered scanning"
```

---

## Task 4: 更新 Agent 执行 API

**Files:**
- Modify: `src/app/api/agent/execute/route.ts`

- [ ] **Step 1: 更新 API 使用 AgentExecutor**

实现 SSE 流式输出，支持实时反馈。

- [ ] **Step 2: 提交**

```bash
git add src/app/api/agent/execute/route.ts
git commit -m "feat(api): update agent execute API with real AI execution"
```

---

## Task 5: 验证和最终提交

- [ ] **Step 1: 运行构建**

```bash
cd D:/claude-web-platform && npm run build
```

- [ ] **Step 2: 最终提交**

```bash
git add -A
git commit -m "feat(agent): implement real AI-powered skill execution

- Add result parser for AI responses
- Add AgentExecutor for skill execution with tool support
- Update ScanExecutor to use AgentExecutor
- Update agent execute API with SSE progress

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## 完成检查清单

- [ ] 结果解析器创建完成
- [ ] AgentExecutor 类实现完成
- [ ] ScanExecutor 集成 AgentExecutor
- [ ] Agent 执行 API 更新完成
- [ ] TypeScript 类型检查通过
- [ ] 构建成功
- [ ] 所有更改已提交

---

## 配置说明

要使 Agent 执行正常工作，需要配置 AI 模型：

1. **环境变量配置**（推荐）:
```env
ANTHROPIC_API_KEY=your-api-key
ANTHROPIC_BASE_URL=https://api.anthropic.com/v1/messages
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

2. **数据库配置**:
在 ModelConfig 表中添加默认模型配置

---

## 测试说明

1. 配置 AI 模型（设置环境变量或在管理页面配置）
2. 创建测试 Skill
3. 创建扫描任务并执行
4. 验证漏洞报告是否正确生成
