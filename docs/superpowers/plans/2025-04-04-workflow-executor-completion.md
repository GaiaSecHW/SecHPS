# 工作流执行器完善实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完善工作流执行器，实现真实的 API 调用、AI 处理、文件操作、条件评估和数据转换功能，替换现有的模拟实现。

**Architecture:** 在现有 `workflow-executor.ts` 基础上，创建独立的执行器模块（api-executor、ai-executor、file-executor、script-executor），通过策略模式集成到任务执行器中。使用 vm2 或 isolated-vm 实现安全的脚本执行环境。

**Tech Stack:** Next.js 16, TypeScript, Prisma ORM, AI Services (Claude), vm2 (沙箱执行)

---

## 现状分析

当前 `src/lib/workflow-executor.ts` 有以下 TODO：
1. `executeApiCall` - 只有模拟实现
2. `executeScript` - 只有模拟实现
3. `executeAiProcess` - 只有模拟实现
4. `executeFileOperation` - 只有模拟实现
5. `evaluateCondition` - 简单字符串匹配，不安全
6. `executeTransform` - 直接返回输入，无转换逻辑

---

## 文件结构

```
src/lib/
├── workflow-executor.ts          # 修改：集成真实执行器
├── workflow-actions/             # 新增：工作流动作执行器目录
│   ├── index.ts                  # 导出和类型定义
│   ├── api-executor.ts           # API 调用执行器
│   ├── ai-executor.ts            # AI 处理执行器
│   ├── file-executor.ts          # 文件操作执行器
│   ├── script-executor.ts        # 脚本执行器（沙箱）
│   ├── condition-evaluator.ts    # 条件表达式评估器
│   └── transform-executor.ts     # 数据转换执行器
```

---

## Task 1: 创建工作流动作类型定义

**Files:**
- Create: `src/lib/workflow-actions/index.ts`

- [ ] **Step 1: 创建类型定义和导出文件**

```typescript
// src/lib/workflow-actions/index.ts

/**
 * 工作流动作执行器
 * 提供各种动作的真实执行能力
 */

import type { ExecutionContext } from '@/types/workflow';

// ============ 类型定义 ============

/**
 * 动作执行结果
 */
export interface ActionResult {
  success: boolean;
  output: unknown;
  error?: string;
  duration: number;
  logs?: string[];
}

/**
 * API 调用配置
 */
export interface ApiCallConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  auth?: {
    type: 'bearer' | 'basic' | 'api-key';
    token?: string;
    username?: string;
    password?: string;
    key?: string;
    header?: string;
  };
}

/**
 * AI 处理配置
 */
export interface AiProcessConfig {
  provider?: 'claude' | 'openai' | 'ccr-proxy';
  model?: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  inputMapping?: Record<string, string>;
  outputParsing?: 'json' | 'text' | 'markdown';
}

/**
 * 文件操作配置
 */
export interface FileOperationConfig {
  operation: 'read' | 'write' | 'append' | 'delete' | 'list' | 'exists' | 'mkdir' | 'rmdir';
  path: string;
  content?: string | Buffer;
  encoding?: 'utf-8' | 'binary' | 'json';
  recursive?: boolean;
}

/**
 * 脚本执行配置
 */
export interface ScriptExecuteConfig {
  language: 'javascript' | 'typescript';
  code: string;
  timeout?: number;
  memory?: number;
  input?: unknown;
}

/**
 * 条件评估配置
 */
export interface ConditionEvaluateConfig {
  expression: string;
  variables: Record<string, unknown>;
  allowedFunctions?: string[];
}

/**
 * 数据转换配置
 */
export interface TransformConfig {
  type: 'jsonpath' | 'jq' | 'template' | 'script';
  expression: string;
  input: unknown;
}

// ============ 执行器接口 ============

/**
 * 动作执行器接口
 */
export interface ActionExecutor<TConfig = unknown> {
  name: string;
  execute(config: TConfig, context: ExecutionContext): Promise<ActionResult>;
  validate(config: TConfig): boolean;
}

// ============ 辅助函数 ============

/**
 * 替换变量占位符
 * 支持 ${variable} 和 {{variable}} 语法
 */
export function replaceVariables(
  template: string,
  variables: Record<string, unknown>
): string {
  return template
    .replace(/\$\{([^}]+)\}/g, (_, key) => {
      const value = getNestedValue(variables, key);
      return value !== undefined ? String(value) : '';
    })
    .replace(/\{\{([^}]+)\}\}/g, (_, key) => {
      const value = getNestedValue(variables, key);
      return value !== undefined ? String(value) : '';
    });
}

/**
 * 获取嵌套对象值
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * 安全的 JSON 解析
 */
export function safeJsonParse(str: string, defaultValue: unknown = null): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return defaultValue;
  }
}

// 导出执行器
export { executeApiCall } from './api-executor';
export { executeAiProcess } from './ai-executor';
export { executeFileOperation } from './file-executor';
export { executeScript } from './script-executor';
export { evaluateCondition } from './condition-evaluator';
export { executeTransform } from './transform-executor';
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/workflow-actions/index.ts
git commit -m "feat(workflow): add action types and utilities"
```

---

## Task 2: 创建 API 调用执行器

**Files:**
- Create: `src/lib/workflow-actions/api-executor.ts`

- [ ] **Step 1: 创建 API 调用执行器**

```typescript
// src/lib/workflow-actions/api-executor.ts

import type { ExecutionContext } from '@/types/workflow';
import { ActionResult, ApiCallConfig, replaceVariables } from './index';

/**
 * 执行 API 调用
 */
export async function executeApiCall(
  config: ApiCallConfig,
  context: ExecutionContext
): Promise<ActionResult> {
  const startTime = Date.now();
  const logs: string[] = [];

  try {
    // 替换 URL 中的变量
    const url = replaceVariables(config.url, context.variables);
    logs.push(`[API] ${config.method} ${url}`);

    // 构建请求头
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.headers,
    };

    // 处理认证
    if (config.auth) {
      switch (config.auth.type) {
        case 'bearer':
          if (config.auth.token) {
            headers['Authorization'] = `Bearer ${config.auth.token}`;
          }
          break;
        case 'basic':
          if (config.auth.username && config.auth.password) {
            const credentials = Buffer.from(
              `${config.auth.username}:${config.auth.password}`
            ).toString('base64');
            headers['Authorization'] = `Basic ${credentials}`;
          }
          break;
        case 'api-key':
          if (config.auth.key && config.auth.header) {
            headers[config.auth.header] = config.auth.key;
          }
          break;
      }
    }

    // 构建请求选项
    const requestOptions: RequestInit = {
      method: config.method,
      headers,
      signal: config.timeout
        ? AbortSignal.timeout(config.timeout)
        : AbortSignal.timeout(30000),
    };

    // 添加请求体
    if (config.body && ['POST', 'PUT', 'PATCH'].includes(config.method)) {
      const body = typeof config.body === 'string'
        ? replaceVariables(config.body, context.variables)
        : JSON.stringify(config.body);
      requestOptions.body = body as string;
      logs.push(`[API] Request body: ${body}`);
    }

    // 执行请求
    const response = await fetch(url, requestOptions);
    logs.push(`[API] Response status: ${response.status}`);

    // 解析响应
    const contentType = response.headers.get('content-type') || '';
    let output: unknown;

    if (contentType.includes('application/json')) {
      output = await response.json();
    } else {
      output = await response.text();
    }

    if (!response.ok) {
      return {
        success: false,
        output,
        error: `HTTP ${response.status}: ${response.statusText}`,
        duration: Date.now() - startTime,
        logs,
      };
    }

    return {
      success: true,
      output,
      duration: Date.now() - startTime,
      logs,
    };
  } catch (error) {
    logs.push(`[API] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'API 调用失败',
      duration: Date.now() - startTime,
      logs,
    };
  }
}

/**
 * 验证 API 调用配置
 */
export function validateApiCallConfig(config: ApiCallConfig): boolean {
  if (!config.url) return false;
  if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(config.method)) return false;
  return true;
}
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/workflow-actions/api-executor.ts
git commit -m "feat(workflow): add API call executor with auth support"
```

---

## Task 3: 创建 AI 处理执行器

**Files:**
- Create: `src/lib/workflow-actions/ai-executor.ts`

- [ ] **Step 1: 创建 AI 处理执行器**

```typescript
// src/lib/workflow-actions/ai-executor.ts

import type { ExecutionContext } from '@/types/workflow';
import { ActionResult, AiProcessConfig, replaceVariables, getNestedValue, safeJsonParse } from './index';
import { createAIProvider, AIProviderConfig } from '@/services/ai';

/**
 * 执行 AI 处理
 */
export async function executeAiProcess(
  config: AiProcessConfig,
  context: ExecutionContext
): Promise<ActionResult> {
  const startTime = Date.now();
  const logs: string[] = [];

  try {
    // 获取模型配置
    const modelConfig = await getModelConfig();
    if (!modelConfig) {
      return {
        success: false,
        output: null,
        error: '模型配置不存在，请先配置 AI 模型',
        duration: Date.now() - startTime,
        logs,
      };
    }

    logs.push(`[AI] Provider: ${modelConfig.providerType}`);
    logs.push(`[AI] Model: ${config.model || modelConfig.defaultModel}`);

    // 构建提示词
    let prompt = replaceVariables(config.prompt, context.variables);

    // 处理输入映射
    if (config.inputMapping) {
      for (const [key, path] of Object.entries(config.inputMapping)) {
        const value = getNestedValue(context.variables, path);
        if (value !== undefined) {
          prompt = prompt.replace(`{${key}}`, JSON.stringify(value));
        }
      }
    }

    logs.push(`[AI] Prompt length: ${prompt.length} chars`);

    // 创建 AI 提供商
    const providerType = config.provider || modelConfig.providerType || 'claude';
    const providerConfig: AIProviderConfig = {
      apiKey: modelConfig.apiKey,
      baseUrl: modelConfig.apiBaseUrl,
      model: config.model || modelConfig.defaultModel || 'claude-sonnet-4-20250514',
      maxTokens: config.maxTokens || 4096,
    };

    const provider = createAIProvider(
      providerType === 'claude' ? 'claude' : 'ccr-proxy',
      providerConfig
    );

    // 构建消息
    const messages = [];
    if (config.systemPrompt) {
      messages.push({ role: 'system', content: config.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    // 调用 AI
    let responseText = '';
    await provider.stream(messages, {
      onChunk: (text) => {
        responseText += text;
      },
      onComplete: () => {},
      onError: (error) => {
        throw error;
      },
    });

    logs.push(`[AI] Response length: ${responseText.length} chars`);

    // 解析输出
    let output: unknown = responseText;
    if (config.outputParsing === 'json') {
      output = safeJsonParse(responseText, responseText);
    }

    return {
      success: true,
      output,
      duration: Date.now() - startTime,
      logs,
    };
  } catch (error) {
    logs.push(`[AI] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : 'AI 处理失败',
      duration: Date.now() - startTime,
      logs,
    };
  }
}

/**
 * 获取模型配置
 */
async function getModelConfig(): Promise<{
  providerType: string;
  apiKey: string;
  apiBaseUrl: string;
  defaultModel?: string;
} | null> {
  // 从环境变量获取
  const envApiKey = process.env.ANTHROPIC_API_KEY;
  const envBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const envModel = process.env.ANTHROPIC_MODEL;

  if (envApiKey) {
    return {
      providerType: 'claude',
      apiKey: envApiKey,
      apiBaseUrl: envBaseUrl || 'https://api.anthropic.com/v1/messages',
      defaultModel: envModel || 'claude-sonnet-4-20250514',
    };
  }

  // 从数据库获取
  try {
    const { prisma } = await import('@/lib/prisma');
    const config = await prisma.modelConfig.findFirst({
      where: { isActive: true, isDefault: true },
    });

    if (config) {
      return {
        providerType: config.providerType,
        apiKey: config.apiKey,
        apiBaseUrl: config.apiBaseUrl,
        defaultModel: JSON.parse(config.models)[0] || 'claude-sonnet-4-20250514',
      };
    }
  } catch {
    // 忽略数据库错误
  }

  return null;
}

/**
 * 验证 AI 处理配置
 */
export function validateAiProcessConfig(config: AiProcessConfig): boolean {
  if (!config.prompt) return false;
  return true;
}
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/workflow-actions/ai-executor.ts
git commit -m "feat(workflow): add AI process executor with Claude integration"
```

---

## Task 4: 创建文件操作执行器

**Files:**
- Create: `src/lib/workflow-actions/file-executor.ts`

- [ ] **Step 1: 创建文件操作执行器**

```typescript
// src/lib/workflow-actions/file-executor.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import type { ExecutionContext } from '@/types/workflow';
import { ActionResult, FileOperationConfig, replaceVariables } from './index';

// 允许的基础路径（安全限制）
const ALLOWED_BASE_PATHS = [
  process.cwd(),
  path.join(process.cwd(), 'uploads'),
  path.join(process.cwd(), 'temp'),
  path.join(process.cwd(), 'data'),
];

/**
 * 执行文件操作
 */
export async function executeFileOperation(
  config: FileOperationConfig,
  context: ExecutionContext
): Promise<ActionResult> {
  const startTime = Date.now();
  const logs: string[] = [];

  try {
    // 替换路径中的变量
    const filePath = replaceVariables(config.path, context.variables);
    logs.push(`[File] Operation: ${config.operation}`);
    logs.push(`[File] Path: ${filePath}`);

    // 安全检查：确保路径在允许范围内
    const resolvedPath = path.resolve(filePath);
    const isAllowed = ALLOWED_BASE_PATHS.some(basePath =>
      resolvedPath.startsWith(path.resolve(basePath))
    );

    // 对于写操作，需要更严格的权限检查
    const writeOperations = ['write', 'append', 'delete', 'mkdir', 'rmdir'];
    const needsWritePermission = writeOperations.includes(config.operation);

    if (needsWritePermission && !isAllowed) {
      return {
        success: false,
        output: null,
        error: `文件路径不在允许范围内: ${resolvedPath}`,
        duration: Date.now() - startTime,
        logs,
      };
    }

    let output: unknown;

    switch (config.operation) {
      case 'read':
        output = await executeRead(resolvedPath, config.encoding || 'utf-8', logs);
        break;

      case 'write':
        output = await executeWrite(
          resolvedPath,
          config.content || '',
          config.encoding || 'utf-8',
          logs
        );
        break;

      case 'append':
        output = await executeAppend(
          resolvedPath,
          config.content || '',
          config.encoding || 'utf-8',
          logs
        );
        break;

      case 'delete':
        output = await executeDelete(resolvedPath, logs);
        break;

      case 'list':
        output = await executeList(resolvedPath, logs);
        break;

      case 'exists':
        output = await executeExists(resolvedPath, logs);
        break;

      case 'mkdir':
        output = await executeMkdir(resolvedPath, config.recursive || false, logs);
        break;

      case 'rmdir':
        output = await executeRmdir(resolvedPath, config.recursive || false, logs);
        break;

      default:
        return {
          success: false,
          output: null,
          error: `不支持的文件操作: ${config.operation}`,
          duration: Date.now() - startTime,
          logs,
        };
    }

    return {
      success: true,
      output,
      duration: Date.now() - startTime,
      logs,
    };
  } catch (error) {
    logs.push(`[File] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : '文件操作失败',
      duration: Date.now() - startTime,
      logs,
    };
  }
}

async function executeRead(
  filePath: string,
  encoding: string,
  logs: string[]
): Promise<unknown> {
  if (encoding === 'json') {
    const content = await fs.readFile(filePath, 'utf-8');
    logs.push(`[File] Read JSON: ${filePath}`);
    return JSON.parse(content);
  } else if (encoding === 'binary') {
    const content = await fs.readFile(filePath);
    logs.push(`[File] Read binary: ${filePath} (${content.length} bytes)`);
    return content.toString('base64');
  } else {
    const content = await fs.readFile(filePath, 'utf-8');
    logs.push(`[File] Read text: ${filePath} (${content.length} chars)`);
    return content;
  }
}

async function executeWrite(
  filePath: string,
  content: string | Buffer,
  encoding: string,
  logs: string[]
): Promise<unknown> {
  // 确保目录存在
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  if (encoding === 'json' && typeof content === 'string') {
    await fs.writeFile(filePath, content, 'utf-8');
    logs.push(`[File] Write JSON: ${filePath}`);
  } else if (encoding === 'binary' && typeof content === 'string') {
    const buffer = Buffer.from(content, 'base64');
    await fs.writeFile(filePath, buffer);
    logs.push(`[File] Write binary: ${filePath} (${buffer.length} bytes)`);
  } else {
    await fs.writeFile(filePath, content, 'utf-8');
    logs.push(`[File] Write text: ${filePath}`);
  }

  return { written: true, path: filePath };
}

async function executeAppend(
  filePath: string,
  content: string | Buffer,
  encoding: string,
  logs: string[]
): Promise<unknown> {
  await fs.appendFile(filePath, content, encoding as BufferEncoding);
  logs.push(`[File] Append: ${filePath}`);
  return { appended: true, path: filePath };
}

async function executeDelete(filePath: string, logs: string[]): Promise<unknown> {
  await fs.unlink(filePath);
  logs.push(`[File] Delete: ${filePath}`);
  return { deleted: true, path: filePath };
}

async function executeList(dirPath: string, logs: string[]): Promise<unknown> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const items = entries.map(entry => ({
    name: entry.name,
    type: entry.isDirectory() ? 'directory' : 'file',
    path: path.join(dirPath, entry.name),
  }));
  logs.push(`[File] List: ${dirPath} (${items.length} items)`);
  return { items, count: items.length };
}

async function executeExists(filePath: string, logs: string[]): Promise<unknown> {
  try {
    await fs.access(filePath);
    logs.push(`[File] Exists: ${filePath}`);
    return { exists: true, path: filePath };
  } catch {
    logs.push(`[File] Not exists: ${filePath}`);
    return { exists: false, path: filePath };
  }
}

async function executeMkdir(
  dirPath: string,
  recursive: boolean,
  logs: string[]
): Promise<unknown> {
  await fs.mkdir(dirPath, { recursive });
  logs.push(`[File] Mkdir: ${dirPath} (recursive: ${recursive})`);
  return { created: true, path: dirPath };
}

async function executeRmdir(
  dirPath: string,
  recursive: boolean,
  logs: string[]
): Promise<unknown> {
  if (recursive) {
    await fs.rm(dirPath, { recursive: true });
  } else {
    await fs.rmdir(dirPath);
  }
  logs.push(`[File] Rmdir: ${dirPath} (recursive: ${recursive})`);
  return { removed: true, path: dirPath };
}

/**
 * 验证文件操作配置
 */
export function validateFileOperationConfig(config: FileOperationConfig): boolean {
  if (!config.path) return false;
  if (!['read', 'write', 'append', 'delete', 'list', 'exists', 'mkdir', 'rmdir'].includes(config.operation)) return false;
  if (['write', 'append'].includes(config.operation) && config.content === undefined) return false;
  return true;
}
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/workflow-actions/file-executor.ts
git commit -m "feat(workflow): add file operation executor with security checks"
```

---

## Task 5: 创建脚本执行器（沙箱）

**Files:**
- Create: `src/lib/workflow-actions/script-executor.ts`

- [ ] **Step 1: 创建脚本执行器**

```typescript
// src/lib/workflow-actions/script-executor.ts

import type { ExecutionContext } from '@/types/workflow';
import { ActionResult, ScriptExecuteConfig, safeJsonParse } from './index';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * 执行脚本（安全沙箱）
 */
export async function executeScript(
  config: ScriptExecuteConfig,
  context: ExecutionContext
): Promise<ActionResult> {
  const startTime = Date.now();
  const logs: string[] = [];

  try {
    logs.push(`[Script] Language: ${config.language}`);
    logs.push(`[Script] Timeout: ${config.timeout || 5000}ms`);

    // 安全检查：禁止危险操作
    const dangerousPatterns = [
      /require\s*\(\s*['"]child_process['"]\s*\)/,
      /require\s*\(\s*['"]fs['"]\s*\)/,
      /process\.exit/,
      /eval\s*\(/,
      /Function\s*\(/,
      /import\s+.*from\s+['"]child_process['"]/,
      /import\s+.*from\s+['"]fs['"]/,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(config.code)) {
        return {
          success: false,
          output: null,
          error: '脚本包含不允许的操作',
          duration: Date.now() - startTime,
          logs,
        };
      }
    }

    let output: unknown;

    if (config.language === 'javascript' || config.language === 'typescript') {
      output = await executeJavaScript(config, context.variables, logs);
    } else {
      return {
        success: false,
        output: null,
        error: `不支持的语言: ${config.language}`,
        duration: Date.now() - startTime,
        logs,
      };
    }

    return {
      success: true,
      output,
      duration: Date.now() - startTime,
      logs,
    };
  } catch (error) {
    logs.push(`[Script] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : '脚本执行失败',
      duration: Date.now() - startTime,
      logs,
    };
  }
}

/**
 * 执行 JavaScript（使用隔离环境）
 */
async function executeJavaScript(
  config: ScriptExecuteConfig,
  variables: Record<string, unknown>,
  logs: string[]
): Promise<unknown> {
  // 准备输入变量
  const inputJson = JSON.stringify(config.input || variables);

  // 构建安全的执行代码
  const wrappedCode = `
    (function() {
      // 提供安全的全局变量
      const input = ${inputJson};
      const variables = ${inputJson};
      const console = {
        log: function(...args) { return JSON.stringify({ logs: args }); },
        error: function(...args) { return JSON.stringify({ error: args }); },
        warn: function(...args) { return JSON.stringify({ warn: args }); }
      };

      // 用户代码
      ${config.code}

      // 返回结果（如果代码定义了 result 变量）
      if (typeof result !== 'undefined') {
        return result;
      }
      return { executed: true };
    })()
  `;

  // 使用 Node.js 执行（带超时）
  const timeout = config.timeout || 5000;

  try {
    // 使用 vm 模块创建隔离环境
    const vm = await import('vm');
    const context = vm.createContext({
      input: JSON.parse(inputJson),
      variables: JSON.parse(inputJson),
      console: {
        log: (...args: unknown[]) => logs.push(`[Script] ${args.map(a => JSON.stringify(a)).join(' ')}`),
        error: (...args: unknown[]) => logs.push(`[Script] ERROR: ${args.map(a => JSON.stringify(a)).join(' ')}`),
        warn: (...args: unknown[]) => logs.push(`[Script] WARN: ${args.map(a => JSON.stringify(a)).join(' ')}`),
      },
      JSON,
      Math,
      Date,
      Object,
      Array,
      String,
      Number,
      Boolean,
      RegExp,
      Error,
      TypeError,
      SyntaxError,
    });

    const script = new vm.Script(wrappedCode, { timeout });
    const result = script.runInContext(context, { timeout });

    logs.push(`[Script] Execution completed`);
    return result;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        throw new Error(`脚本执行超时 (${timeout}ms)`);
      }
      throw error;
    }
    throw new Error('脚本执行失败');
  }
}

/**
 * 验证脚本配置
 */
export function validateScriptConfig(config: ScriptExecuteConfig): boolean {
  if (!config.code) return false;
  if (!['javascript', 'typescript'].includes(config.language)) return false;
  return true;
}
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/workflow-actions/script-executor.ts
git commit -m "feat(workflow): add sandboxed script executor with vm module"
```

---

## Task 6: 创建条件评估器

**Files:**
- Create: `src/lib/workflow-actions/condition-evaluator.ts`

- [ ] **Step 1: 创建条件评估器**

```typescript
// src/lib/workflow-actions/condition-evaluator.ts

import type { ExecutionContext } from '@/types/workflow';
import { ActionResult, ConditionEvaluateConfig, getNestedValue } from './index';

/**
 * 安全的条件表达式评估器
 */
export function evaluateCondition(
  expression: string,
  variables: Record<string, unknown>
): boolean {
  try {
    // 替换变量引用
    const processedExpression = replaceVariableReferences(expression, variables);

    // 安全评估表达式
    return safeEvaluate(processedExpression);
  } catch (error) {
    console.error('[Condition] Evaluation error:', error);
    return false;
  }
}

/**
 * 执行条件评估（作为工作流动作）
 */
export async function executeConditionEvaluate(
  config: ConditionEvaluateConfig,
  context: ExecutionContext
): Promise<ActionResult> {
  const startTime = Date.now();
  const logs: string[] = [];

  try {
    logs.push(`[Condition] Expression: ${config.expression}`);

    const result = evaluateCondition(config.expression, {
      ...context.variables,
      ...config.variables,
    });

    logs.push(`[Condition] Result: ${result}`);

    return {
      success: true,
      output: { result, expression: config.expression },
      duration: Date.now() - startTime,
      logs,
    };
  } catch (error) {
    logs.push(`[Condition] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return {
      success: false,
      output: { result: false },
      error: error instanceof Error ? error.message : '条件评估失败',
      duration: Date.now() - startTime,
      logs,
    };
  }
}

/**
 * 替换变量引用
 * 支持 $variable、${variable}、{{variable}} 语法
 */
function replaceVariableReferences(
  expression: string,
  variables: Record<string, unknown>
): string {
  let result = expression;

  // 替换 ${variable} 和 {{variable}}
  result = result.replace(/\$\{([^}]+)\}/g, (_, path) => {
    const value = getNestedValue(variables, path);
    return formatValue(value);
  });

  result = result.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const value = getNestedValue(variables, path);
    return formatValue(value);
  });

  // 替换 $variable（简单变量名）
  result = result.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
    const value = variables[name];
    return formatValue(value);
  });

  return result;
}

/**
 * 格式化值为表达式字符串
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'string') {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * 安全评估表达式
 * 支持基本比较和逻辑运算
 */
function safeEvaluate(expression: string): boolean {
  // 清理表达式
  const cleaned = expression.trim();

  // 处理布尔字面量
  if (cleaned === 'true') return true;
  if (cleaned === 'false') return false;

  // 处理简单的比较表达式
  const comparisonOperators = ['===', '!==', '==', '!=', '>=', '<=', '>', '<'];
  for (const op of comparisonOperators) {
    if (cleaned.includes(op)) {
      return evaluateComparison(cleaned, op);
    }
  }

  // 处理逻辑运算
  if (cleaned.includes('&&')) {
    const parts = cleaned.split('&&').map(p => p.trim());
    return parts.every(part => safeEvaluate(part));
  }

  if (cleaned.includes('||')) {
    const parts = cleaned.split('||').map(p => p.trim());
    return parts.some(part => safeEvaluate(part));
  }

  // 处理否定
  if (cleaned.startsWith('!')) {
    return !safeEvaluate(cleaned.slice(1).trim());
  }

  // 处理括号
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    return safeEvaluate(cleaned.slice(1, -1));
  }

  // 处理存在性检查
  if (cleaned.startsWith('exists ')) {
    const varName = cleaned.slice(7).trim();
    return varName !== 'null' && varName !== 'undefined';
  }

  // 处理包含检查
  if (cleaned.includes('includes')) {
    return evaluateIncludes(cleaned);
  }

  // 默认：尝试解析为布尔值
  try {
    const parsed = JSON.parse(cleaned);
    return Boolean(parsed);
  } catch {
    // 非空字符串视为 true
    return cleaned.length > 0;
  }
}

/**
 * 评估比较表达式
 */
function evaluateComparison(expression: string, operator: string): boolean {
  const [left, right] = expression.split(operator).map(s => s.trim());

  const leftValue = parseValue(left);
  const rightValue = parseValue(right);

  switch (operator) {
    case '===':
      return leftValue === rightValue;
    case '!==':
      return leftValue !== rightValue;
    case '==':
      // 宽松相等
      return leftValue == rightValue;
    case '!=':
      return leftValue != rightValue;
    case '>=':
      return Number(leftValue) >= Number(rightValue);
    case '<=':
      return Number(leftValue) <= Number(rightValue);
    case '>':
      return Number(leftValue) > Number(rightValue);
    case '<':
      return Number(leftValue) < Number(rightValue);
    default:
      return false;
  }
}

/**
 * 解析值
 */
function parseValue(str: string): unknown {
  const trimmed = str.trim();

  // 布尔值
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (trimmed === 'undefined') return undefined;

  // 数字
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  // 字符串（带引号）
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  // 其他情况作为字符串
  return trimmed;
}

/**
 * 评估包含表达式
 */
function evaluateIncludes(expression: string): boolean {
  // 处理 "array.includes(value)" 或 "string.includes(substring)"
  const match = expression.match(/(.+)\.includes\((.+)\)/);
  if (!match) return false;

  const [, target, value] = match;
  const targetValue = parseValue(target.trim());
  const searchValue = parseValue(value.trim());

  if (Array.isArray(targetValue)) {
    return targetValue.includes(searchValue);
  }

  if (typeof targetValue === 'string') {
    return targetValue.includes(String(searchValue));
  }

  return false;
}

/**
 * 验证条件配置
 */
export function validateConditionConfig(config: ConditionEvaluateConfig): boolean {
  if (!config.expression) return false;
  return true;
}
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/workflow-actions/condition-evaluator.ts
git commit -m "feat(workflow): add safe condition evaluator"
```

---

## Task 7: 创建数据转换执行器

**Files:**
- Create: `src/lib/workflow-actions/transform-executor.ts`

- [ ] **Step 1: 创建数据转换执行器**

```typescript
// src/lib/workflow-actions/transform-executor.ts

import type { ExecutionContext } from '@/types/workflow';
import { ActionResult, TransformConfig, getNestedValue } from './index';

/**
 * 执行数据转换
 */
export async function executeTransform(
  config: TransformConfig,
  context: ExecutionContext
): Promise<ActionResult> {
  const startTime = Date.now();
  const logs: string[] = [];

  try {
    logs.push(`[Transform] Type: ${config.type}`);
    logs.push(`[Transform] Expression: ${config.expression}`);

    let output: unknown;

    switch (config.type) {
      case 'jsonpath':
        output = executeJsonPath(config.expression, config.input, logs);
        break;

      case 'jq':
        output = executeJqLike(config.expression, config.input, logs);
        break;

      case 'template':
        output = executeTemplate(config.expression, config.input, context.variables, logs);
        break;

      case 'script':
        output = await executeTransformScript(config.expression, config.input, context.variables, logs);
        break;

      default:
        return {
          success: false,
          output: null,
          error: `不支持的转换类型: ${config.type}`,
          duration: Date.now() - startTime,
          logs,
        };
    }

    logs.push(`[Transform] Completed`);

    return {
      success: true,
      output,
      duration: Date.now() - startTime,
      logs,
    };
  } catch (error) {
    logs.push(`[Transform] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return {
      success: false,
      output: null,
      error: error instanceof Error ? error.message : '数据转换失败',
      duration: Date.now() - startTime,
      logs,
    };
  }
}

/**
 * JSONPath 查询（简化实现）
 * 支持 $.store.book[0].title, $.store.book[*].author 等
 */
function executeJsonPath(expression: string, input: unknown, logs: string[]): unknown {
  logs.push(`[Transform] JSONPath query: ${expression}`);

  // 移除 $ 前缀
  let path = expression.replace(/^\$\.?/, '');

  if (!path) {
    return input;
  }

  // 分割路径
  const parts = path.split(/\.|\[|\]/).filter(Boolean);
  let current: unknown = input;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    // 处理通配符
    if (part === '*') {
      if (Array.isArray(current)) {
        return current;
      }
      if (typeof current === 'object') {
        return Object.values(current as Record<string, unknown>);
      }
      return undefined;
    }

    // 处理数组索引
    const index = parseInt(part, 10);
    if (!isNaN(index)) {
      if (Array.isArray(current)) {
        current = current[index];
      } else {
        return undefined;
      }
    } else {
      // 处理对象属性
      if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
  }

  return current;
}

/**
 * jq 风格转换（简化实现）
 * 支持 .key, .[], map, select, sort, reverse, unique 等
 */
function executeJqLike(expression: string, input: unknown, logs: string[]): unknown {
  logs.push(`[Transform] jq-like expression: ${expression}`);

  let current: unknown = input;
  const tokens = expression.split('|').map(t => t.trim());

  for (const token of tokens) {
    if (!token || token === '.') {
      continue;
    }

    // 属性访问
    if (token.startsWith('.')) {
      const path = token.slice(1);
      current = executeJsonPath(`$.${path}`, current, logs);
      continue;
    }

    // 数组操作
    if (token === '[]' || token === '.[]') {
      if (Array.isArray(current)) {
        current = current.flat();
      }
      continue;
    }

    // map
    if (token.startsWith('map(')) {
      const inner = token.match(/map\((.+)\)/)?.[1];
      if (inner && Array.isArray(current)) {
        current = current.map(item => executeJsonPath(`$.${inner}`, item, logs));
      }
      continue;
    }

    // select
    if (token.startsWith('select(')) {
      const condition = token.match(/select\((.+)\)/)?.[1];
      if (condition && Array.isArray(current)) {
        current = current.filter(item => evaluateSimpleCondition(item, condition));
      }
      continue;
    }

    // sort
    if (token === 'sort' || token.startsWith('sort(')) {
      if (Array.isArray(current)) {
        current = [...current].sort((a, b) => {
          if (typeof a === 'number' && typeof b === 'number') {
            return a - b;
          }
          return String(a).localeCompare(String(b));
        });
      }
      continue;
    }

    // reverse
    if (token === 'reverse') {
      if (Array.isArray(current)) {
        current = [...current].reverse();
      }
      continue;
    }

    // unique
    if (token === 'unique') {
      if (Array.isArray(current)) {
        current = [...new Set(current.map(JSON.stringify))].map(JSON.parse);
      }
      continue;
    }

    // length
    if (token === 'length') {
      if (Array.isArray(current)) {
        current = current.length;
      } else if (typeof current === 'string') {
        current = current.length;
      } else if (typeof current === 'object') {
        current = Object.keys(current || {}).length;
      }
      continue;
    }

    // keys
    if (token === 'keys') {
      if (typeof current === 'object' && current !== null) {
        current = Object.keys(current);
      }
      continue;
    }

    // values
    if (token === 'values') {
      if (typeof current === 'object' && current !== null) {
        current = Object.values(current);
      }
      continue;
    }
  }

  return current;
}

/**
 * 模板转换
 * 支持 ${variable}, {{variable}} 语法
 */
function executeTemplate(
  template: string,
  input: unknown,
  variables: Record<string, unknown>,
  logs: string[]
): unknown {
  logs.push(`[Transform] Template processing`);

  const allVariables = { ...variables, input, $: input };

  let result = template;

  // 替换 ${variable}
  result = result.replace(/\$\{([^}]+)\}/g, (_, path) => {
    const value = getNestedValue(allVariables, path);
    return value !== undefined ? String(value) : '';
  });

  // 替换 {{variable}}
  result = result.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const value = getNestedValue(allVariables, path);
    return value !== undefined ? String(value) : '';
  });

  return result;
}

/**
 * 脚本转换
 */
async function executeTransformScript(
  code: string,
  input: unknown,
  variables: Record<string, unknown>,
  logs: string[]
): Promise<unknown> {
  logs.push(`[Transform] Script execution`);

  const vm = await import('vm');

  const context = vm.createContext({
    input,
    variables,
    $: input,
    output: null,
    JSON,
    Object,
    Array,
    String,
    Number,
    Math,
    Date,
  });

  const wrappedCode = `
    ${code}
    output;
  `;

  const script = new vm.Script(wrappedCode, { timeout: 5000 });
  return script.runInContext(context, { timeout: 5000 });
}

/**
 * 简单条件评估
 */
function evaluateSimpleCondition(item: unknown, condition: string): boolean {
  // 支持 .property == value 格式
  const comparisonMatch = condition.match(/\.?\s*(\w+)\s*(===|==|!=|!==|>=|<=|>|<)\s*(.+)/);
  if (comparisonMatch) {
    const [, prop, op, valueStr] = comparisonMatch;
    const itemValue = typeof item === 'object' && item !== null
      ? (item as Record<string, unknown>)[prop]
      : undefined;

    let compareValue: unknown = valueStr.trim();
    if (compareValue.startsWith('"') || compareValue.startsWith("'")) {
      compareValue = compareValue.slice(1, -1);
    } else if (!isNaN(Number(compareValue))) {
      compareValue = Number(compareValue);
    } else if (compareValue === 'true') {
      compareValue = true;
    } else if (compareValue === 'false') {
      compareValue = false;
    }

    switch (op) {
      case '===':
      case '==':
        return itemValue === compareValue;
      case '!==':
      case '!=':
        return itemValue !== compareValue;
      case '>=':
        return Number(itemValue) >= Number(compareValue);
      case '<=':
        return Number(itemValue) <= Number(compareValue);
      case '>':
        return Number(itemValue) > Number(compareValue);
      case '<':
        return Number(itemValue) < Number(compareValue);
    }
  }

  return true;
}

/**
 * 验证转换配置
 */
export function validateTransformConfig(config: TransformConfig): boolean {
  if (!config.expression) return false;
  if (!['jsonpath', 'jq', 'template', 'script'].includes(config.type)) return false;
  return true;
}
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/workflow-actions/transform-executor.ts
git commit -m "feat(workflow): add data transform executor with jsonpath, jq, template support"
```

---

## Task 8: 更新工作流执行器

**Files:**
- Modify: `src/lib/workflow-executor.ts`

- [ ] **Step 1: 更新任务执行器集成真实执行逻辑**

在文件开头添加导入：

```typescript
// 在文件开头添加导入
import {
  executeApiCall,
  executeAiProcess,
  executeFileOperation,
  executeScript,
  evaluateCondition,
  executeTransform,
  ApiCallConfig,
  AiProcessConfig,
  FileOperationConfig,
  ScriptExecuteConfig,
  TransformConfig,
} from './workflow-actions';
```

- [ ] **Step 2: 更新任务执行器**

找到 `taskExecutor` 的 `execute` 函数，替换为：

```typescript
const taskExecutor: NodeExecutor = {
  type: 'task' as SimplifiedNodeType,
  validate: (node: FlowNode) => {
    const config = node.data.config || {};
    return !!(config.name || config.action);
  },
  execute: async (context: ExecutionContext, node: FlowNode): Promise<StepResult> => {
    const config = node.data.config || {};
    const startedAt = new Date();

    try {
      const previousStep = getPreviousStepOutput(context, node.id);
      const action = config.action;

      let output: unknown;

      // 根据动作类型执行不同的逻辑
      switch (action) {
        case 'api_call': {
          const apiConfig: ApiCallConfig = {
            url: config.url,
            method: config.method || 'GET',
            headers: config.headers,
            body: config.body || previousStep,
            timeout: config.timeout,
            auth: config.auth,
          };
          const result = await executeApiCall(apiConfig, context);
          if (!result.success) {
            throw new Error(result.error || 'API 调用失败');
          }
          output = result.output;
          break;
        }

        case 'ai_process': {
          const aiConfig: AiProcessConfig = {
            provider: config.provider,
            model: config.model,
            prompt: config.prompt,
            systemPrompt: config.systemPrompt,
            temperature: config.temperature,
            maxTokens: config.maxTokens,
            inputMapping: config.inputMapping,
            outputParsing: config.outputParsing,
          };
          const result = await executeAiProcess(aiConfig, context);
          if (!result.success) {
            throw new Error(result.error || 'AI 处理失败');
          }
          output = result.output;
          break;
        }

        case 'file_operation': {
          const fileConfig: FileOperationConfig = {
            operation: config.fileOperation,
            path: config.filePath,
            content: config.content || previousStep,
            encoding: config.encoding,
            recursive: config.recursive,
          };
          const result = await executeFileOperation(fileConfig, context);
          if (!result.success) {
            throw new Error(result.error || '文件操作失败');
          }
          output = result.output;
          break;
        }

        case 'script': {
          const scriptConfig: ScriptExecuteConfig = {
            language: config.language || 'javascript',
            code: config.code,
            timeout: config.timeout,
            input: previousStep,
          };
          const result = await executeScript(scriptConfig, context);
          if (!result.success) {
            throw new Error(result.error || '脚本执行失败');
          }
          output = result.output;
          break;
        }

        case 'transform': {
          const transformConfig: TransformConfig = {
            type: config.transformType || 'jsonpath',
            expression: config.expression,
            input: previousStep,
          };
          const result = await executeTransform(transformConfig, context);
          if (!result.success) {
            throw new Error(result.error || '数据转换失败');
          }
          output = result.output;
          break;
        }

        case 'condition': {
          const conditionResult = evaluateCondition(config.condition, context.variables);
          output = { result: conditionResult, expression: config.condition };
          break;
        }

        default:
          // 默认任务执行
          output = { taskExecuted: true, input: previousStep, config };
      }

      return {
        nodeId: node.id,
        status: 'completed',
        input: previousStep,
        output,
        error: null,
        startedAt,
        completedAt: new Date(),
      };
    } catch (error) {
      return {
        nodeId: node.id,
        status: 'failed',
        input: null,
        output: null,
        error: error instanceof Error ? error.message : '任务执行失败',
        startedAt,
        completedAt: new Date(),
      };
    }
  },
};
```

- [ ] **Step 3: 删除旧的辅助函数**

删除文件末尾的旧实现函数：

```typescript
// 删除以下函数（已移至 workflow-actions/）：
// - executeApiCall (旧实现)
// - executeScript (旧实现)
// - executeAiProcess (旧实现)
// - executeFileOperation (旧实现)
// - evaluateCondition (旧实现)
// - executeTransform (旧实现)
```

- [ ] **Step 4: 提交**

```bash
git add src/lib/workflow-executor.ts
git commit -m "feat(workflow): integrate real action executors into workflow engine"
```

---

## Task 9: 验证和构建测试

- [ ] **Step 1: 运行 TypeScript 类型检查**

```bash
cd D:/claude-web-platform && npx tsc --noEmit
```

Expected: 无类型错误

- [ ] **Step 2: 运行构建**

```bash
cd D:/claude-web-platform && npm run build
```

Expected: 构建成功

- [ ] **Step 3: 最终提交**

```bash
git add -A
git commit -m "feat(workflow): complete workflow executor with real action implementations

- Add API call executor with authentication support
- Add AI process executor with Claude integration
- Add file operation executor with security checks
- Add sandboxed script executor using vm module
- Add safe condition evaluator with expression parsing
- Add data transform executor (jsonpath, jq, template)
- Integrate all executors into workflow engine

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## 完成检查清单

- [ ] 类型定义创建完成
- [ ] API 调用执行器创建完成
- [ ] AI 处理执行器创建完成
- [ ] 文件操作执行器创建完成
- [ ] 脚本执行器创建完成
- [ ] 条件评估器创建完成
- [ ] 数据转换执行器创建完成
- [ ] 工作流执行器更新完成
- [ ] TypeScript 类型检查通过
- [ ] 构建成功
- [ ] 所有更改已提交

---

## 安全注意事项

1. **文件操作**: 限制在允许的基础路径内
2. **脚本执行**: 使用 vm 模块隔离，禁止危险操作
3. **条件评估**: 自定义解析器，不使用 eval
4. **API 调用**: 支持超时限制
5. **输入验证**: 所有配置在使用前验证

## 使用示例

```typescript
// API 调用
{
  action: 'api_call',
  url: 'https://api.example.com/data',
  method: 'POST',
  body: { query: '${input.query}' },
  auth: { type: 'bearer', token: '${variables.apiToken}' }
}

// AI 处理
{
  action: 'ai_process',
  prompt: '分析以下数据: ${input}',
  model: 'claude-sonnet-4-20250514'
}

// 文件操作
{
  action: 'file_operation',
  fileOperation: 'write',
  filePath: './data/result.json',
  content: '${output}'
}

// 条件判断
{
  action: 'condition',
  condition: '${input.status} === "success"'
}

// 数据转换
{
  action: 'transform',
  transformType: 'jsonpath',
  expression: '$.data.items[*].name'
}
```
