# 评估服务重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构评估服务架构，移除 OpenCode SDK 依赖，实现模块化的 AI 模型调用层，支持多轮对话、流式响应和指数退避重试。

**Architecture:** 分层服务架构 - AI 模型调用层（`services/ai/`）、评估业务层（`services/evaluation/`）、前端组件优化

**Tech Stack:** Next.js 16, React 19, TypeScript, Prisma, SQLite, SSE

---

## 文件结构

```
src/
├── services/
│   ├── ai/                          # 新增：AI 模型调用层
│   │   ├── base.ts                  # 抽象基类
│   │   ├── claude.ts                # Claude 实现
│   │   ├── ccr-proxy.ts             # CCR 代理实现
│   │   └── index.ts                 # 工厂方法
│   │
│   └── evaluation/                  # 新增：评估业务层
│       ├── caller.ts                # 评估调用器
│       ├── history.ts               # 对话历史管理
│       ├── prompt.ts                # Prompt 构建
│       ├── stream.ts                # SSE 流式处理
│       └── retry.ts                 # 重试策略
│
├── app/api/
│   ├── projects/
│   │   └── [id]/
│   │       ├── start/
│   │       │   └── route.ts         # 修改：重构评估启动
│   │       └── chat/
│   │           └── route.ts         # 新增：继续对话 API
│   │
│   └── evaluations/
│       └── [id]/
│           ├── messages/
│           │   └── route.ts         # 修改：获取对话历史
│           └── stop/
│               └── route.ts         # 修改：停止评估
│
├── components/
│   └── evaluation/                  # 新增：评估组件
│       ├── StreamingMessage.tsx     # 流式消息显示
│       ├── EvaluationProgress.tsx   # 进度指示器
│       ├── ChatInput.tsx            # 对话输入
│       └── EvaluationView.tsx       # 评估视图整合
│
└── types/
    └── evaluation.ts                # 新增：评估类型定义

已删除文件（无需处理）：
- src/lib/opencode-manager.ts
- src/lib/port-manager.ts
- src/lib/server-manager.ts
- src/app/api/opencode/**
- src/app/api/app/**
- src/app/api/sessions/[id]/children/**
- src/app/api/sessions/[id]/todo/**
```

---

## Task 1: 创建 AI 模型调用层 - 基础类型和抽象类

**Files:**
- Create: `src/services/ai/base.ts`

- [ ] **Step 1: 创建服务目录结构**

```bash
mkdir -p src/services/ai
mkdir -p src/services/evaluation
mkdir -p src/components/evaluation
```

- [ ] **Step 2: 创建 AI 基础类型和抽象类**

```typescript
// src/services/ai/base.ts

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIStreamCallbacks {
  onChunk: (text: string) => void;
  onComplete: (fullResponse: string) => void;
  onError: (error: Error) => void;
  onRetry?: (attempt: number, delay: number) => void;
}

export interface AIProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
  retryConfig?: RetryConfig;
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;    // 基础延迟（毫秒）
  maxDelay: number;     // 最大延迟（毫秒）
  multiplier: number;   // 乘数
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  multiplier: 2,
};

/**
 * AI 提供商抽象基类
 */
export abstract class AIProvider {
  protected config: AIProviderConfig;
  protected abortController: AbortController | null = null;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  /**
   * 流式调用 AI 模型
   */
  abstract stream(
    messages: AIMessage[],
    callbacks: AIStreamCallbacks
  ): Promise<void>;

  /**
   * 中止当前请求
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * 指数退避重试
   */
  protected async withRetry<T>(
    fn: () => Promise<T>,
    config: RetryConfig = DEFAULT_RETRY_CONFIG
  ): Promise<T> {
    let lastError: Error | null = null;
    let delay = config.baseDelay;

    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        
        // 检查是否可重试
        if (!this.isRetryable(error)) {
          throw error;
        }

        // 最后一次尝试不等待
        if (attempt < config.maxAttempts) {
          console.log(`[AIProvider] 重试 ${attempt}/${config.maxAttempts}，等待 ${delay}ms`);
          await this.sleep(delay);
          delay = Math.min(delay * config.multiplier, config.maxDelay);
        }
      }
    }

    throw lastError;
  }

  /**
   * 判断错误是否可重试
   */
  protected isRetryable(error: any): boolean {
    // 网络错误、超时、5xx 错误可重试
    if (error.name === 'AbortError') return false;
    if (error.status >= 500) return true;
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') return true;
    if (error.message?.includes('rate limit')) return true;
    if (error.message?.includes('429')) return true;
    return false;
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

- [ ] **Step 3: 验证文件创建**

```bash
ls -la src/services/ai/base.ts
```

Expected: 文件存在且内容正确

- [ ] **Step 4: 提交**

```bash
git add src/services/ai/base.ts
git commit -m "feat(ai): add AI provider base class with retry support"
```

---

## Task 2: 创建 Claude 提供商实现

**Files:**
- Create: `src/services/ai/claude.ts`

- [ ] **Step 1: 创建 Claude 提供商**

```typescript
// src/services/ai/claude.ts

import { AIProvider, AIMessage, AIStreamCallbacks, AIProviderConfig } from './base';

export class ClaudeProvider extends AIProvider {
  constructor(config: AIProviderConfig) {
    super(config);
  }

  async stream(
    messages: AIMessage[],
    callbacks: AIStreamCallbacks
  ): Promise<void> {
    this.abortController = new AbortController();

    const systemMessage = messages.find(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    await this.withRetry(async () => {
      const response = await fetch(
        this.config.baseUrl || 'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.config.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: this.config.model,
            max_tokens: this.config.maxTokens || 4096,
            system: systemMessage?.content,
            messages: otherMessages.map(m => ({
              role: m.role,
              content: m.content,
            })),
            stream: true,
          }),
          signal: this.abortController.signal,
        }
      );

      if (!response.ok) {
        const error = await response.text();
        const apiError = new Error(`Claude API 错误: ${response.status} ${error}`);
        (apiError as any).status = response.status;
        throw apiError;
      }

      await this.handleStream(response, callbacks);
    }, this.config.retryConfig);
  }

  private async handleStream(
    response: Response,
    callbacks: AIStreamCallbacks
  ): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) {
      callbacks.onError(new Error('响应体不可读'));
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              callbacks.onComplete(fullResponse);
              return;
            }

            try {
              const chunk = JSON.parse(data);
              const text = this.extractText(chunk);
              if (text) {
                fullResponse += text;
                callbacks.onChunk(text);
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }

      callbacks.onComplete(fullResponse);
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // 用户中止，正常结束
        callbacks.onComplete(fullResponse);
      } else {
        callbacks.onError(error as Error);
      }
    }
  }

  private extractText(chunk: any): string {
    // Claude API 流式响应格式
    if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
      return chunk.delta.text;
    }
    // 兼容其他格式
    if (chunk.delta?.text) {
      return chunk.delta.text;
    }
    return '';
  }
}
```

- [ ] **Step 2: 验证文件创建**

```bash
ls -la src/services/ai/claude.ts
```

- [ ] **Step 3: 提交**

```bash
git add src/services/ai/claude.ts
git commit -m "feat(ai): add Claude provider implementation"
```

---

## Task 3: 创建 CCR 代理提供商实现

**Files:**
- Create: `src/services/ai/ccr-proxy.ts`

- [ ] **Step 1: 创建 CCR 代理提供商**

```typescript
// src/services/ai/ccr-proxy.ts

import { AIProvider, AIMessage, AIStreamCallbacks, AIProviderConfig } from './base';

export class CCRProxyProvider extends AIProvider {
  constructor(config: AIProviderConfig) {
    super(config);
  }

  async stream(
    messages: AIMessage[],
    callbacks: AIStreamCallbacks
  ): Promise<void> {
    this.abortController = new AbortController();

    let baseUrl = this.config.baseUrl || '';
    
    // 确保 URL 正确
    if (!baseUrl.endsWith('/chat/completions')) {
      if (baseUrl.endsWith('/v1')) {
        baseUrl = baseUrl + '/chat/completions';
      } else if (!baseUrl.endsWith('/v1/')) {
        baseUrl = baseUrl.replace(/\/?$/, '/chat/completions');
      }
    }

    console.log('[CCRProxy] 调用内部大模型:', {
      url: baseUrl,
      model: this.config.model,
    });

    await this.withRetry(async () => {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          stream: true,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        const apiError = new Error(`内部大模型错误: ${response.status} ${error}`);
        (apiError as any).status = response.status;
        throw apiError;
      }

      await this.handleStream(response, callbacks);
    }, this.config.retryConfig);
  }

  private async handleStream(
    response: Response,
    callbacks: AIStreamCallbacks
  ): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) {
      callbacks.onError(new Error('响应体不可读'));
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              callbacks.onComplete(fullResponse);
              return;
            }

            try {
              const chunk = JSON.parse(data);
              const content = chunk.choices?.[0]?.delta?.content;
              if (content) {
                fullResponse += content;
                callbacks.onChunk(content);
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }

      callbacks.onComplete(fullResponse);
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        callbacks.onComplete(fullResponse);
      } else {
        callbacks.onError(error as Error);
      }
    }
  }
}
```

- [ ] **Step 2: 验证文件创建**

```bash
ls -la src/services/ai/ccr-proxy.ts
```

- [ ] **Step 3: 提交**

```bash
git add src/services/ai/ccr-proxy.ts
git commit -m "feat(ai): add CCR proxy provider implementation"
```

---

## Task 4: 创建 AI 提供商工厂方法

**Files:**
- Create: `src/services/ai/index.ts`

- [ ] **Step 1: 创建工厂方法和导出**

```typescript
// src/services/ai/index.ts

import { AIProvider, AIProviderConfig, RetryConfig, DEFAULT_RETRY_CONFIG, AIMessage, AIStreamCallbacks } from './base';
import { ClaudeProvider } from './claude';
import { CCRProxyProvider } from './ccr-proxy';

export type ProviderType = 'claude' | 'openai' | 'ccr-proxy';

/**
 * 创建 AI 提供商实例
 */
export function createAIProvider(
  type: ProviderType,
  config: AIProviderConfig
): AIProvider {
  switch (type) {
    case 'claude':
      return new ClaudeProvider(config);
    case 'openai':
      throw new Error('OpenAI Provider 尚未实现，请使用 claude 或 ccr-proxy');
    case 'ccr-proxy':
      return new CCRProxyProvider(config);
    default:
      throw new Error(`未知的提供商类型: ${type}`);
  }
}

/**
 * 根据模型配置判断提供商类型
 */
export function getProviderType(modelConfig: {
  providerType: string;
}): ProviderType {
  if (modelConfig.providerType === 'claude') {
    return 'claude';
  }
  // 其他类型默认使用 ccr-proxy
  return 'ccr-proxy';
}

// 导出所有类型和类
export {
  AIProvider,
  AIProviderConfig,
  RetryConfig,
  DEFAULT_RETRY_CONFIG,
  AIMessage,
  AIStreamCallbacks,
};
export { ClaudeProvider } from './claude';
export { CCRProxyProvider } from './ccr-proxy';
```

- [ ] **Step 2: 验证模块导入**

```bash
cd D:/claude-web-platform && npx tsc --noEmit src/services/ai/index.ts
```

Expected: 无类型错误

- [ ] **Step 3: 提交**

```bash
git add src/services/ai/index.ts
git commit -m "feat(ai): add AI provider factory and exports"
```

---

## Task 5: 创建对话历史管理模块

**Files:**
- Create: `src/services/evaluation/history.ts`

- [ ] **Step 1: 创建对话历史管理**

```typescript
// src/services/evaluation/history.ts

import { prisma } from '@/lib/prisma';
import { AIMessage } from '@/services/ai';

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: Date;
}

/**
 * 对话历史管理
 */
export class ConversationHistory {
  /**
   * 获取对话历史
   */
  async getMessages(evaluationId: string): Promise<ConversationMessage[]> {
    const messages = await prisma.sessionMessage.findMany({
      where: { evaluationSessionId: evaluationId },
      orderBy: { createdAt: 'asc' },
    });

    return messages.map(m => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      createdAt: m.createdAt,
    }));
  }

  /**
   * 添加用户消息
   */
  async addUserMessage(evaluationId: string, content: string): Promise<ConversationMessage> {
    const message = await prisma.sessionMessage.create({
      data: {
        evaluationSessionId: evaluationId,
        role: 'user',
        content,
      },
    });

    return {
      id: message.id,
      role: 'user',
      content: message.content,
      createdAt: message.createdAt,
    };
  }

  /**
   * 添加助手消息
   */
  async addAssistantMessage(evaluationId: string, content: string): Promise<ConversationMessage> {
    const message = await prisma.sessionMessage.create({
      data: {
        evaluationSessionId: evaluationId,
        role: 'assistant',
        content,
      },
    });

    return {
      id: message.id,
      role: 'assistant',
      content: message.content,
      createdAt: message.createdAt,
    };
  }

  /**
   * 获取最近的对话历史（用于上下文窗口）
   */
  async getRecentMessages(
    evaluationId: string,
    maxTokens: number = 100000
  ): Promise<AIMessage[]> {
    // 获取所有消息
    const messages = await this.getMessages(evaluationId);
    
    // 简单估算：平均 1 token ≈ 4 字符（中文约 1.5 字符/token）
    const maxChars = maxTokens * 3;
    let totalChars = 0;
    const result: AIMessage[] = [];

    // 从最新消息开始，向前累积
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      totalChars += msg.content.length;
      if (totalChars > maxChars && result.length > 0) break;
      result.unshift({
        role: msg.role,
        content: msg.content,
      });
    }

    return result;
  }

  /**
   * 清除对话历史
   */
  async clearHistory(evaluationId: string): Promise<void> {
    await prisma.sessionMessage.deleteMany({
      where: { evaluationSessionId: evaluationId },
    });
  }

  /**
   * 获取对话统计
   */
  async getStats(evaluationId: string): Promise<{
    totalMessages: number;
    userMessages: number;
    assistantMessages: number;
  }> {
    const messages = await this.getMessages(evaluationId);
    return {
      totalMessages: messages.length,
      userMessages: messages.filter(m => m.role === 'user').length,
      assistantMessages: messages.filter(m => m.role === 'assistant').length,
    };
  }
}
```

- [ ] **Step 2: 验证文件创建**

```bash
ls -la src/services/evaluation/history.ts
```

- [ ] **Step 3: 提交**

```bash
git add src/services/evaluation/history.ts
git commit -m "feat(evaluation): add conversation history management"
```

---

## Task 6: 创建 Prompt 构建模块

**Files:**
- Create: `src/services/evaluation/prompt.ts`

- [ ] **Step 1: 创建 Prompt 构建器**

```typescript
// src/services/evaluation/prompt.ts

import { AIMessage } from '@/services/ai';

export interface PromptContext {
  projectName: string;
  projectDescription?: string;
  environmentUrl?: string;
  files: Array<{
    name: string;
    type: string;
    size: number;
  }>;
  taskDescription?: string;
  conversationHistory?: AIMessage[];
}

/**
 * Prompt 构建器
 */
export class PromptBuilder {
  /**
   * 构建系统提示词
   */
  buildSystemPrompt(): string {
    return `你是一个专业的代码评估专家。你的任务是对项目进行全面评估，包括：

1. 分析项目结构和代码质量
2. 识别潜在的安全漏洞
3. 评估代码的可维护性和可扩展性
4. 提供改进建议
5. 给项目整体评分（1-10 分）

请使用专业的语气，提供具体、可操作的建议。如果用户有后续问题，请基于之前的评估内容进行回答。`;
  }

  /**
   * 构建用户提示词（首次评估）
   */
  buildUserPrompt(context: PromptContext): string {
    let prompt = `## 项目信息\n`;
    prompt += `- 项目名称: ${context.projectName}\n`;
    
    if (context.projectDescription) {
      prompt += `- 项目描述: ${context.projectDescription}\n`;
    }
    
    if (context.environmentUrl) {
      prompt += `- 环境地址: ${context.environmentUrl}\n`;
    }
    
    prompt += `\n## 上传的文件\n`;
    if (context.files.length > 0) {
      prompt += context.files
        .map(f => `- ${f.name} (${f.type}, ${this.formatFileSize(f.size)})`)
        .join('\n');
    } else {
      prompt += '（暂无上传文件）';
    }
    prompt += `\n\n`;

    if (context.taskDescription) {
      prompt += `## 评估任务\n`;
      prompt += context.taskDescription;
    } else {
      prompt += `## 评估要求\n`;
      prompt += `1. 分析项目结构和代码质量\n`;
      prompt += `2. 识别潜在的安全漏洞\n`;
      prompt += `3. 评估代码的可维护性和可扩展性\n`;
      prompt += `4. 提供改进建议\n`;
      prompt += `5. 给项目整体评分（1-10 分）\n\n`;
      prompt += `请开始你的评估：`;
    }

    return prompt;
  }

  /**
   * 构建完整的消息列表
   */
  buildMessages(context: PromptContext): AIMessage[] {
    const messages: AIMessage[] = [
      { role: 'system', content: this.buildSystemPrompt() },
    ];

    // 添加对话历史
    if (context.conversationHistory && context.conversationHistory.length > 0) {
      messages.push(...context.conversationHistory);
    } else {
      // 首次评估，添加初始用户消息
      messages.push({
        role: 'user',
        content: this.buildUserPrompt(context),
      });
    }

    return messages;
  }

  /**
   * 格式化文件大小
   */
  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}
```

- [ ] **Step 2: 验证文件创建**

```bash
ls -la src/services/evaluation/prompt.ts
```

- [ ] **Step 3: 提交**

```bash
git add src/services/evaluation/prompt.ts
git commit -m "feat(evaluation): add prompt builder"
```

---

## Task 7: 创建评估调用器

**Files:**
- Create: `src/services/evaluation/caller.ts`

- [ ] **Step 1: 创建评估调用器**

```typescript
// src/services/evaluation/caller.ts

import {
  createAIProvider,
  AIProvider,
  AIStreamCallbacks,
  AIMessage,
  ProviderType,
} from '@/services/ai';
import { ConversationHistory } from './history';
import { PromptBuilder, PromptContext } from './prompt';

export interface EvaluationConfig {
  providerType: ProviderType;
  apiKey: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
}

export interface EvaluationCallbacks {
  onChunk: (text: string) => void;
  onComplete: (fullResponse: string) => void;
  onError: (error: Error) => void;
}

/**
 * 评估调用器
 */
export class EvaluationCaller {
  private provider: AIProvider;
  private history: ConversationHistory;
  private promptBuilder: PromptBuilder;
  private currentEvaluationId: string | null = null;

  constructor(config: EvaluationConfig) {
    this.provider = createAIProvider(config.providerType, {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      maxTokens: config.maxTokens,
    });
    this.history = new ConversationHistory();
    this.promptBuilder = new PromptBuilder();
  }

  /**
   * 启动评估
   */
  async startEvaluation(
    evaluationId: string,
    context: PromptContext,
    callbacks: EvaluationCallbacks
  ): Promise<void> {
    this.currentEvaluationId = evaluationId;

    // 构建消息
    const messages = this.promptBuilder.buildMessages(context);

    // 调用 AI
    await this.provider.stream(messages, {
      onChunk: callbacks.onChunk,
      onComplete: async (fullResponse) => {
        // 保存助手消息到历史
        try {
          await this.history.addAssistantMessage(evaluationId, fullResponse);
        } catch (error) {
          console.error('[EvaluationCaller] 保存消息失败:', error);
        }
        callbacks.onComplete(fullResponse);
      },
      onError: callbacks.onError,
    });
  }

  /**
   * 继续对话
   */
  async continueConversation(
    evaluationId: string,
    userMessage: string,
    context: PromptContext,
    callbacks: EvaluationCallbacks
  ): Promise<void> {
    this.currentEvaluationId = evaluationId;

    // 保存用户消息
    await this.history.addUserMessage(evaluationId, userMessage);

    // 获取对话历史
    const conversationHistory = await this.history.getRecentMessages(evaluationId);
    
    // 构建消息
    const messages = this.promptBuilder.buildMessages({
      ...context,
      conversationHistory,
    });

    // 调用 AI
    await this.provider.stream(messages, {
      onChunk: callbacks.onChunk,
      onComplete: async (fullResponse) => {
        try {
          await this.history.addAssistantMessage(evaluationId, fullResponse);
        } catch (error) {
          console.error('[EvaluationCaller] 保存消息失败:', error);
        }
        callbacks.onComplete(fullResponse);
      },
      onError: callbacks.onError,
    });
  }

  /**
   * 中止评估
   */
  abort(): void {
    this.provider.abort();
  }

  /**
   * 获取对话历史
   */
  getHistory(): ConversationHistory {
    return this.history;
  }
}

/**
 * 创建评估调用器的工厂方法
 */
export function createEvaluationCaller(
  modelConfig: {
    providerType: string;
    apiKey: string;
    apiBaseUrl: string;
    models: string;
  }
): EvaluationCaller {
  // 解析模型列表
  const models = JSON.parse(modelConfig.models || '[]');
  const model = models[0] || 'claude-sonnet-4-20250514';

  // 确定提供商类型
  let providerType: ProviderType = 'ccr-proxy';
  if (modelConfig.providerType === 'claude') {
    providerType = 'claude';
  }

  return new EvaluationCaller({
    providerType,
    apiKey: modelConfig.apiKey,
    baseUrl: modelConfig.apiBaseUrl,
    model,
  });
}
```

- [ ] **Step 2: 验证文件创建**

```bash
ls -la src/services/evaluation/caller.ts
```

- [ ] **Step 3: 提交**

```bash
git add src/services/evaluation/caller.ts
git commit -m "feat(evaluation): add evaluation caller with conversation support"
```

---

## Task 8: 创建评估服务索引文件

**Files:**
- Create: `src/services/evaluation/index.ts`

- [ ] **Step 1: 创建索引文件**

```typescript
// src/services/evaluation/index.ts

export { ConversationHistory } from './history';
export { PromptBuilder } from './prompt';
export { EvaluationCaller, createEvaluationCaller } from './caller';
export type { EvaluationConfig, EvaluationCallbacks } from './caller';
export type { PromptContext } from './prompt';
export type { ConversationMessage } from './history';
```

- [ ] **Step 2: 验证导入**

```bash
cd D:/claude-web-platform && npx tsc --noEmit src/services/evaluation/index.ts
```

- [ ] **Step 3: 提交**

```bash
git add src/services/evaluation/index.ts
git commit -m "feat(evaluation): add evaluation service exports"
```

---

## Task 9: 创建评估类型定义

**Files:**
- Create: `src/types/evaluation.ts`

- [ ] **Step 1: 创建评估类型定义**

```typescript
// src/types/evaluation.ts

export type EvaluationStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export type ProgressStatus = 'idle' | 'connecting' | 'streaming' | 'completed' | 'error';

export interface EvaluationProgress {
  evaluationId: string;
  status: ProgressStatus;
  progress: number; // 0-100
  message?: string;
  errorMessage?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface EvaluationSession {
  id: string;
  projectId: string;
  status: EvaluationStatus;
  startedAt: Date;
  completedAt?: Date;
  errorMessage?: string;
  messageCount: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

export interface ProjectInfo {
  id: string;
  name: string;
  description?: string;
  environmentUrl?: string;
  files: Array<{
    id: string;
    name: string;
    type: string;
    size: number;
  }>;
}
```

- [ ] **Step 2: 验证文件创建**

```bash
ls -la src/types/evaluation.ts
```

- [ ] **Step 3: 提交**

```bash
git add src/types/evaluation.ts
git commit -m "feat(types): add evaluation type definitions"
```

---

## Task 10: 创建前端流式消息组件

**Files:**
- Create: `src/components/evaluation/StreamingMessage.tsx`

- [ ] **Step 1: 创建流式消息组件**

```typescript
// src/components/evaluation/StreamingMessage.tsx

'use client';

import React, { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';

interface StreamingMessageProps {
  content: string;
  isStreaming: boolean;
  className?: string;
}

export function StreamingMessage({ 
  content, 
  isStreaming,
  className = '' 
}: StreamingMessageProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (containerRef.current && isStreaming) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [content, isStreaming]);

  return (
    <div
      ref={containerRef}
      className={`prose prose-sm max-w-none bg-gray-50 rounded-lg p-4 max-h-[600px] overflow-y-auto ${className}`}
    >
      {content ? (
        <ReactMarkdown>{content}</ReactMarkdown>
      ) : (
        <span className="text-gray-400">等待响应...</span>
      )}
      {isStreaming && (
        <span className="inline-block w-2 h-4 bg-blue-500 animate-pulse ml-1" />
      )}
    </div>
  );
}
```

- [ ] **Step 2: 验证文件创建**

```bash
ls -la src/components/evaluation/StreamingMessage.tsx
```

- [ ] **Step 3: 提交**

```bash
git add src/components/evaluation/StreamingMessage.tsx
git commit -m "feat(components): add streaming message component"
```

---

## Task 11: 创建进度指示器组件

**Files:**
- Create: `src/components/evaluation/EvaluationProgress.tsx`

- [ ] **Step 1: 创建进度指示器组件**

```typescript
// src/components/evaluation/EvaluationProgress.tsx

'use client';

import React from 'react';
import { Loader2, CheckCircle, AlertCircle, Clock } from 'lucide-react';

export type ProgressStatus = 'idle' | 'connecting' | 'streaming' | 'completed' | 'error';

interface EvaluationProgressProps {
  status: ProgressStatus;
  progress?: number; // 0-100
  message?: string;
  errorMessage?: string;
}

const statusConfig = {
  idle: {
    icon: Clock,
    text: '等待开始',
    color: 'text-gray-500',
    bgColor: 'bg-gray-100',
  },
  connecting: {
    icon: Loader2,
    text: '连接中...',
    color: 'text-blue-500',
    bgColor: 'bg-blue-50',
  },
  streaming: {
    icon: Loader2,
    text: '评估进行中',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
  },
  completed: {
    icon: CheckCircle,
    text: '评估完成',
    color: 'text-green-500',
    bgColor: 'bg-green-50',
  },
  error: {
    icon: AlertCircle,
    text: '评估失败',
    color: 'text-red-500',
    bgColor: 'bg-red-50',
  },
};

export function EvaluationProgress({
  status,
  progress,
  message,
  errorMessage,
}: EvaluationProgressProps) {
  const config = statusConfig[status];
  const Icon = config.icon;
  const isAnimating = status === 'connecting' || status === 'streaming';

  return (
    <div className={`${config.bgColor} rounded-lg p-4`}>
      <div className="flex items-center space-x-3">
        <Icon
          size={24}
          className={`${config.color} ${isAnimating ? 'animate-spin' : ''}`}
        />
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <span className={`font-medium ${config.color}`}>
              {config.text}
            </span>
            {progress !== undefined && status === 'streaming' && (
              <span className="text-sm text-gray-500">{progress}%</span>
            )}
          </div>
          {message && (
            <p className="text-sm text-gray-600 mt-1">{message}</p>
          )}
          {errorMessage && status === 'error' && (
            <p className="text-sm text-red-600 mt-1">{errorMessage}</p>
          )}
        </div>
      </div>
      
      {/* 进度条 */}
      {status === 'streaming' && progress !== undefined && (
        <div className="mt-3">
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 验证文件创建**

```bash
ls -la src/components/evaluation/EvaluationProgress.tsx
```

- [ ] **Step 3: 提交**

```bash
git add src/components/evaluation/EvaluationProgress.tsx
git commit -m "feat(components): add evaluation progress component"
```

---

## Task 12: 创建对话输入组件

**Files:**
- Create: `src/components/evaluation/ChatInput.tsx`

- [ ] **Step 1: 创建对话输入组件**

```typescript
// src/components/evaluation/ChatInput.tsx

'use client';

import React, { useState, useRef } from 'react';
import { Send, Loader2 } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = '输入您的问题...',
}: ChatInputProps) {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    if (message.trim() && !disabled) {
      onSend(message.trim());
      setMessage('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    // 自动调整高度
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  };

  return (
    <div className="border-t border-gray-200 bg-white p-4">
      <div className="flex items-end space-x-3">
        <div className="flex-1">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="w-full resize-none border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            style={{ maxHeight: '200px' }}
          />
        </div>
        <button
          onClick={handleSubmit}
          disabled={!message.trim() || disabled}
          className="flex-shrink-0 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {disabled ? (
            <Loader2 size={20} className="animate-spin" />
          ) : (
            <Send size={20} />
          )}
        </button>
      </div>
      <p className="text-xs text-gray-500 mt-2">
        按 Enter 发送，Shift + Enter 换行
      </p>
    </div>
  );
}
```

- [ ] **Step 2: 验证文件创建**

```bash
ls -la src/components/evaluation/ChatInput.tsx
```

- [ ] **Step 3: 提交**

```bash
git add src/components/evaluation/ChatInput.tsx
git commit -m "feat(components): add chat input component"
```

---

## Task 13: 重构评估启动 API

**Files:**
- Modify: `src/app/api/projects/[id]/start/route.ts`

- [ ] **Step 1: 备份原文件**

```bash
cp src/app/api/projects/[id]/start/route.ts src/app/api/projects/[id]/start/route.ts.bak
```

- [ ] **Step 2: 重构评估启动 API**

```typescript
// src/app/api/projects/[id]/start/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { createEvaluationCaller, EvaluationCaller } from '@/services/evaluation';

// 存储活跃的评估调用器（用于中止）
const activeCallers = new Map<string, EvaluationCaller>();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id } = await params;

    // 获取项目信息
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        files: true,
        config: true,
      },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    if (project.status === 'running') {
      return NextResponse.json({ error: '项目已在运行中' }, { status: 400 });
    }

    // 获取模型配置
    const modelConfig = await getModelConfig();
    if (!modelConfig) {
      return NextResponse.json(
        { error: '请先配置模型或设置 ANTHROPIC_API_KEY 环境变量' },
        { status: 400 }
      );
    }

    // 更新项目状态
    await prisma.project.update({
      where: { id },
      data: { status: 'running' },
    });

    // 创建评估会话
    const evaluation = await prisma.evaluationSession.create({
      data: {
        projectId: id,
        status: 'running',
      },
    });

    // 创建评估调用器
    const caller = createEvaluationCaller(modelConfig);
    activeCallers.set(evaluation.id, caller);

    // 获取任务描述
    const taskDescription = project.config?.taskDescription || null;

    // 构建文件列表
    const files = project.files.map(f => ({
      name: f.fileName,
      type: f.fileType,
      size: f.fileSize,
    }));

    // 创建 SSE 流
    const stream = new ReadableStream({
      async start(controller) {
        let fullResponse = '';

        try {
          await caller.startEvaluation(evaluation.id, {
            projectName: project.name,
            projectDescription: project.description || undefined,
            environmentUrl: project.environmentUrl || undefined,
            files,
            taskDescription: taskDescription || undefined,
          }, {
            onChunk: (text) => {
              fullResponse += text;
              const data = JSON.stringify({
                type: 'message',
                content: text,
                timestamp: Date.now(),
              });
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
            },
            onComplete: async () => {
              // 更新评估状态
              await prisma.evaluationSession.update({
                where: { id: evaluation.id },
                data: {
                  status: 'completed',
                  completedAt: new Date(),
                },
              });

              await prisma.project.update({
                where: { id },
                data: { status: 'completed' },
              });

              // 发送完成事件
              const data = JSON.stringify({
                type: 'done',
                evaluationId: evaluation.id,
                timestamp: Date.now(),
              });
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
              controller.close();
              activeCallers.delete(evaluation.id);
            },
            onError: async (error) => {
              console.error('[Evaluation] 错误:', error);

              // 保存错误消息
              await prisma.sessionMessage.create({
                data: {
                  evaluationSessionId: evaluation.id,
                  role: 'assistant',
                  content: `评估失败: ${error.message}`,
                },
              });

              // 更新状态
              await prisma.evaluationSession.update({
                where: { id: evaluation.id },
                data: {
                  status: 'failed',
                  errorMessage: error.message,
                  completedAt: new Date(),
                },
              });

              await prisma.project.update({
                where: { id },
                data: { status: 'failed' },
              });

              // 发送错误事件
              const data = JSON.stringify({
                type: 'error',
                error: error.message,
                timestamp: Date.now(),
              });
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
              controller.close();
              activeCallers.delete(evaluation.id);
            },
          });
        } catch (error) {
          console.error('[Evaluation] 启动失败:', error);
          const errorMessage = error instanceof Error ? error.message : '未知错误';
          
          // 发送错误事件
          const data = JSON.stringify({
            type: 'error',
            error: errorMessage,
            timestamp: Date.now(),
          });
          controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
          controller.close();
          
          // 更新状态
          await prisma.evaluationSession.update({
            where: { id: evaluation.id },
            data: {
              status: 'failed',
              errorMessage,
              completedAt: new Date(),
            },
          });

          await prisma.project.update({
            where: { id },
            data: { status: 'failed' },
          });

          activeCallers.delete(evaluation.id);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('启动评估错误:', error);
    return NextResponse.json(
      { error: '服务器内部错误', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * 获取模型配置
 */
async function getModelConfig() {
  // 优先使用环境变量
  const envApiKey = process.env.ANTHROPIC_API_KEY;
  const envBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const envModel = process.env.ANTHROPIC_MODEL;

  if (envApiKey) {
    return {
      providerType: 'claude',
      apiKey: envApiKey,
      apiBaseUrl: envBaseUrl || 'https://api.anthropic.com/v1/messages',
      models: JSON.stringify([envModel || 'claude-sonnet-4-20250514']),
    };
  }

  // 使用数据库配置
  const defaultModel = await prisma.modelConfig.findFirst({
    where: {
      isActive: true,
      isDefault: true,
    },
  });

  if (!defaultModel) {
    const firstModel = await prisma.modelConfig.findFirst({
      where: { isActive: true },
    });
    return firstModel;
  }

  return defaultModel;
}
```

- [ ] **Step 3: 验证文件语法**

```bash
cd D:/claude-web-platform && npx tsc --noEmit src/app/api/projects/[id]/start/route.ts
```

- [ ] **Step 4: 删除备份文件**

```bash
rm src/app/api/projects/[id]/start/route.ts.bak
```

- [ ] **Step 5: 提交**

```bash
git add src/app/api/projects/[id]/start/route.ts
git commit -m "refactor(api): rewrite evaluation start API with new service layer"
```

---

## Task 14: 创建继续对话 API

**Files:**
- Create: `src/app/api/evaluations/[id]/chat/route.ts`

- [ ] **Step 1: 创建继续对话 API**

```typescript
// src/app/api/evaluations/[id]/chat/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { createEvaluationCaller } from '@/services/evaluation';

interface ChatRequest {
  message: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id } = await params;
    const body: ChatRequest = await request.json();

    if (!body.message?.trim()) {
      return NextResponse.json({ error: '消息不能为空' }, { status: 400 });
    }

    // 获取评估会话
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      include: {
        project: {
          include: {
            files: true,
            config: true,
          },
        },
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    if (evaluation.status !== 'completed') {
      return NextResponse.json({ error: '评估会话未完成，无法继续对话' }, { status: 400 });
    }

    // 获取模型配置
    const modelConfig = await getModelConfig();
    if (!modelConfig) {
      return NextResponse.json({ error: '模型配置不存在' }, { status: 500 });
    }

    // 创建评估调用器
    const caller = createEvaluationCaller(modelConfig);

    // 构建上下文
    const project = evaluation.project;
    const files = project.files.map(f => ({
      name: f.fileName,
      type: f.fileType,
      size: f.fileSize,
    }));

    // 创建 SSE 流
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await caller.continueConversation(id, body.message, {
            projectName: project.name,
            projectDescription: project.description || undefined,
            environmentUrl: project.environmentUrl || undefined,
            files,
            taskDescription: project.config?.taskDescription || undefined,
          }, {
            onChunk: (text) => {
              const data = JSON.stringify({
                type: 'message',
                content: text,
                timestamp: Date.now(),
              });
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
            },
            onComplete: () => {
              const data = JSON.stringify({
                type: 'done',
                timestamp: Date.now(),
              });
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
              controller.close();
            },
            onError: (error) => {
              const data = JSON.stringify({
                type: 'error',
                error: error.message,
                timestamp: Date.now(),
              });
              controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
              controller.close();
            },
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '未知错误';
          const data = JSON.stringify({
            type: 'error',
            error: errorMessage,
            timestamp: Date.now(),
          });
          controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('继续对话错误:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}

async function getModelConfig() {
  const envApiKey = process.env.ANTHROPIC_API_KEY;
  const envBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const envModel = process.env.ANTHROPIC_MODEL;

  if (envApiKey) {
    return {
      providerType: 'claude',
      apiKey: envApiKey,
      apiBaseUrl: envBaseUrl || 'https://api.anthropic.com/v1/messages',
      models: JSON.stringify([envModel || 'claude-sonnet-4-20250514']),
    };
  }

  return prisma.modelConfig.findFirst({
    where: { isActive: true, isDefault: true },
  });
}
```

- [ ] **Step 2: 验证文件创建**

```bash
ls -la src/app/api/evaluations/[id]/chat/route.ts
```

- [ ] **Step 3: 提交**

```bash
git add src/app/api/evaluations/[id]/chat/route.ts
git commit -m "feat(api): add evaluation chat endpoint for conversations"
```

---

## Task 15: 运行构建验证

- [ ] **Step 1: 运行 TypeScript 类型检查**

```bash
cd D:/claude-web-platform && npm run build 2>&1 | head -50
```

Expected: 构建成功，无类型错误

- [ ] **Step 2: 运行 lint 检查**

```bash
cd D:/claude-web-platform && npm run lint
```

- [ ] **Step 3: 提交所有更改**

```bash
git add -A
git commit -m "feat: complete evaluation service refactor

- Add AI provider abstraction layer with retry support
- Implement Claude and CCR Proxy providers
- Add conversation history management
- Add prompt builder for evaluations
- Add evaluation caller with streaming support
- Add frontend components (StreamingMessage, EvaluationProgress, ChatInput)
- Refactor evaluation start API
- Add evaluation chat API for conversations

BREAKING CHANGE: Removed OpenCode SDK dependency"
```

---

## 完成检查清单

- [ ] AI 模型调用层实现完成
- [ ] 评估业务层实现完成
- [ ] 前端组件实现完成
- [ ] API 路由重构完成
- [ ] TypeScript 类型检查通过
- [ ] 构建成功
- [ ] 所有更改已提交

---

## 后续任务（不在本计划范围）

1. 更新前端评估详情页面，使用新组件
2. 添加数据库索引优化
3. 添加单元测试
4. 性能测试和优化
5. 添加更多 AI 提供商（OpenAI 等）
