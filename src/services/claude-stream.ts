/**
 * Claude 流式传输服务
 * 参考 ClaudeCodeUI 的实现，提供以下功能：
 * 1. 流式消息处理
 * 2. 消息类型转换（SDK 格式到 UI 格式）
 * 3. 工具调用追踪
 * 4. 子代理工具分组
 */

import { query, Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

// ============================================
// 类型定义
// ============================================

export interface ClaudeStreamConfig {
  apiKey?: string;
  model?: string;
  cwd?: string;
  maxTokens?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  baseUrl?: string;
  resume?: string;  // 会话恢复 ID
  mcpServers?: Record<string, any>;
  permissionMode?: 'default' | 'bypassPermissions' | 'plan';
}

export interface ClaudeStreamCallbacks {
  onChunk?: (text: string) => void;
  onMessage?: (message: NormalizedMessage) => void;
  onToolUse?: (name: string, input: Record<string, unknown>, toolUseId: string) => void;
  onToolResult?: (name: string, result: unknown, toolUseId: string) => void;
  onComplete?: (fullResponse: string, sessionId: string) => void;
  onError?: (error: Error) => void;
  onSessionCreated?: (sessionId: string) => void;
  onTokenBudget?: (used: number, total: number) => void;
}

export interface NormalizedMessage {
  kind: string;
  sessionId?: string;
  provider?: string;
  timestamp?: number;
  [key: string]: any;
}

export interface TokenBudget {
  used: number;
  total: number;
}

// ============================================
// 消息适配器
// ============================================

class ClaudeAdapter {
  /**
   * 将 SDK 消息转换为规范化消息
   */
  normalizeMessage(message: SDKMessage, sessionId: string | null): NormalizedMessage[] {
    const normalized: NormalizedMessage[] = [];
    const safeSessionId = sessionId ?? undefined;

    switch (message.type as string) {
      case 'assistant':
        normalized.push({
          kind: 'assistant_message',
          safeSessionId,
          provider: 'claude',
          timestamp: Date.now(),
          role: 'assistant',
          content: this.extractContent(message),
        });
        break;

      case 'user':
        normalized.push({
          kind: 'user_message',
          safeSessionId,
          provider: 'claude',
          timestamp: Date.now(),
          role: 'user',
          content: this.extractContent(message),
        });
        break;

      case 'tool_use':
        normalized.push({
          kind: 'tool_use',
          safeSessionId,
          provider: 'claude',
          timestamp: Date.now(),
          tool_name: (message as any).name,
          tool_input: (message as any).input,
          tool_use_id: (message as any).id,
        });
        break;

      case 'tool_result':
        normalized.push({
          kind: 'tool_result',
          safeSessionId,
          provider: 'claude',
          timestamp: Date.now(),
          tool_name: (message as any).name,
          tool_result: (message as any).result,
          tool_use_id: (message as any).tool_use_id,
          success: !(message as any).is_error,
        });
        break;

      case 'result':
        if ((message as any).subtype === 'success') {
          normalized.push({
            kind: 'result',
            safeSessionId,
            provider: 'claude',
            timestamp: Date.now(),
            result: (message as any).result,
          });
        } else if ((message as any).subtype?.startsWith('error')) {
          normalized.push({
            kind: 'error',
            safeSessionId,
            provider: 'claude',
            timestamp: Date.now(),
            error: (message as any).errors?.join('\n') || 'Unknown error',
          });
        }
        break;

      case 'text':
        normalized.push({
          kind: 'text',
          safeSessionId,
          provider: 'claude',
          timestamp: Date.now(),
          text: (message as any).text,
        });
        break;

      default:
        // 其他消息类型，直接传递
        normalized.push({
          kind: String(message.type),
          safeSessionId,
          provider: 'claude',
          timestamp: Date.now(),
        });
    }

    return normalized;
  }

  /**
   * 从消息中提取内容
   */
  private extractContent(message: any): string {
    if (typeof message.content === 'string') {
      return message.content;
    }

    if (Array.isArray(message.content)) {
      return message.content
        .filter((part: any) => part.type === 'text')
        .map((part: any) => part.text || '')
        .join('');
    }

    return '';
  }
}

// ============================================
// Claude 流式服务
// ============================================

export class ClaudeStreamService {
  private config: ClaudeStreamConfig;
  private adapter: ClaudeAdapter;
  private abortController: AbortController | null = null;
  private currentSessionId: string | null = null;

  constructor(config: ClaudeStreamConfig = {}) {
    this.config = {
      model: 'claude-sonnet-4-20250514',
      ...config,
    };
    this.adapter = new ClaudeAdapter();
  }

  /**
   * 发送提示并处理流式响应
   */
  async sendPrompt(
    prompt: string,
    callbacks: ClaudeStreamCallbacks = {}
  ): Promise<{ response: string; sessionId: string }> {
    this.abortController = new AbortController();
    let fullResponse = '';

    try {
      // 构建 SDK 选项
      const options: Options = this.buildOptions();

      // 创建查询实例
      const q = query({
        prompt,
        options,
      });

      // 处理流式消息
      let fullResponse = '';
      let sessionCreated = false;

      for await (const message of q) {
        // 捕获会话 ID
        if (message.session_id && !this.currentSessionId) {
          this.currentSessionId = message.session_id;

          if (!sessionCreated) {
            callbacks.onSessionCreated?.(message.session_id);
            sessionCreated = true;
          }
        }

        // 转换消息
        const normalized = this.adapter.normalizeMessage(message, this.currentSessionId);

        // 发送消息回调
        for (const msg of normalized) {
          callbacks.onMessage?.(msg);

          // 处理特定消息类型
          if (msg.kind === 'assistant_message' && msg.content) {
            fullResponse += msg.content;
            callbacks.onChunk?.(msg.content);
          } else if (msg.kind === 'tool_use') {
            callbacks.onToolUse?.(msg.tool_name, msg.tool_input, msg.tool_use_id);
          } else if (msg.kind === 'tool_result') {
            callbacks.onToolResult?.(msg.tool_name, msg.tool_result, msg.tool_use_id);
          }
        }

        // 处理结果消息
        if (message.type === 'result' && (message as any).subtype === 'success') {
          const tokenBudget = this.extractTokenBudget(message);
          if (tokenBudget) {
            callbacks.onTokenBudget?.(tokenBudget.used, tokenBudget.total);
          }
        }
      }

      // 完成回调
      const sessionId = this.currentSessionId || 'unknown';
      callbacks.onComplete?.(fullResponse, sessionId);

      return { response: fullResponse, sessionId };
    } catch (error) {
      console.error('[ClaudeStream] Error:', error);

      if ((error as Error).name === 'AbortError') {
        callbacks.onComplete?.(fullResponse || '', this.currentSessionId || 'unknown');
      } else {
        callbacks.onError?.(error as Error);
      }

      throw error;
    } finally {
      this.abortController = null;
    }
  }

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
   * 获取当前会话 ID
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * 构建 SDK 选项
   */
  private buildOptions(): Options {
    const options: Options = {
      model: this.config.model,
      abortController: this.abortController ?? undefined,
    };

    // 设置工作目录
    if (this.config.cwd) {
      options.cwd = this.config.cwd;
    }

    // 设置工具权限
    if (this.config.allowedTools) {
      options.allowedTools = this.config.allowedTools;
    }

    if (this.config.disallowedTools) {
      options.disallowedTools = this.config.disallowedTools;
    }

    // 设置权限模式
    if (this.config.permissionMode) {
      options.permissionMode = this.config.permissionMode;
    }

    // 设置 MCP 服务器
    if (this.config.mcpServers) {
      options.mcpServers = this.config.mcpServers;
    }

    // 设置会话恢复
    if (this.config.resume) {
      options.resume = this.config.resume;
    }

    // 设置系统提示
    options.systemPrompt = {
      type: 'preset',
      preset: 'claude_code',
    };

    // 设置预设工具
    options.tools = {
      type: 'preset',
      preset: 'claude_code',
    };

    // 设置环境变量
    options.env = {
      ...process.env,
    };

    // 设置 API Key
    if (this.config.apiKey) {
      options.env.ANTHROPIC_API_KEY = this.config.apiKey;
    }

    // 设置 Base URL
    if (this.config.baseUrl) {
      options.env.ANTHROPIC_BASE_URL = this.config.baseUrl;
    }

    return options;
  }

  /**
   * 提取 token 使用情况
   */
  private extractTokenBudget(message: any): TokenBudget | null {
    if (!message.modelUsage) {
      return null;
    }

    const modelKey = Object.keys(message.modelUsage)[0];
    const modelData = message.modelUsage[modelKey];

    if (!modelData) {
      return null;
    }

    const inputTokens = modelData.cumulativeInputTokens || modelData.inputTokens || 0;
    const outputTokens = modelData.cumulativeOutputTokens || modelData.outputTokens || 0;
    const cacheReadTokens = modelData.cumulativeCacheReadInputTokens || modelData.cacheReadInputTokens || 0;
    const cacheCreationTokens = modelData.cumulativeCacheCreationInputTokens || modelData.cacheCreationInputTokens || 0;

    const totalUsed = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
    const total = parseInt(process.env.CONTEXT_WINDOW || '160000', 10);

    return {
      used: totalUsed,
      total,
    };
  }
}

// ============================================
// 导出（已在接口定义处导出）
// ============================================
