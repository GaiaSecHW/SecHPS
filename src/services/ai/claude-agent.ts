// src/services/ai/claude-agent.ts

import { query, Options, SDKMessage, SDKResultSuccess, SDKResultError, McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

/**
 * MCP 服务器配置（应用层）
 */
export interface AppMcpServerConfig {
  name: string;
  type: 'local' | 'remote';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  isEnabled?: boolean;
  autoStart?: boolean;
}

/**
 * 工具权限规则
 */
export interface ToolPermissionRule {
  toolPattern: string;
  permission: 'allow' | 'deny' | 'ask';
}

/**
 * 系统提示词配置
 */
export interface SystemPromptConfig {
  type: 'preset' | 'custom';
  preset?: 'claude_code';
  content?: string;
  priority?: number;
}

export interface ClaudeAgentConfig {
  apiKey?: string;
  model?: string;
  cwd?: string;
  maxTokens?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  baseUrl?: string;  // CCR 代理地址，如 http://127.0.0.1:3000/v1/messages
  
  // SDK 高级配置（参考 CloudCLI）
  mcpServers?: AppMcpServerConfig[];  // MCP 服务器配置
  toolPermissions?: ToolPermissionRule[];  // 工具权限规则
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string };  // 系统提示词配置
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto';  // 权限模式
  allowDangerouslySkipPermissions?: boolean;  // 必须为 true 才能使用 bypassPermissions 模式
  settingSources?: ('project' | 'user' | 'local')[];  // 设置源
  resumeSession?: string;  // 恢复会话 ID
  settings?: { context_management?: boolean };  // 通过 settings 对象配置 context_management
}

export interface ClaudeAgentCallbacks {
  onChunk?: (text: string) => void;
  onToolUse?: (name: string, input: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: unknown) => void;
  onComplete?: (fullResponse: string) => void;
  onError?: (error: Error) => void;
  onMessage?: (message: SDKMessage) => void;
  onSessionId?: (sessionId: string) => void;  // 捕获 SDK 返回的会话 ID
  onUsage?: (usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    totalCostUsd?: number;
    modelUsage?: Record<string, {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
      costUSD: number;
    }>;
  }) => void;  // 捕获 SDK 返回的 token 使用量
}

/**
 * Claude Agent SDK 服务类
 * 使用官方 @anthropic-ai/claude-agent-sdk 实现评估功能
 *
 * 支持两种连接方式：
 * 1. 直接连接 Claude API（providerType === 'claude'）
 * 2. 连接 CCR 代理（providerType === 'openai'），由 CCR 转发到其他 AI 服务
 */
export class ClaudeAgentService {
  private config: ClaudeAgentConfig;
  private abortController: AbortController | null = null;

  constructor(config: ClaudeAgentConfig = {}) {
    this.config = {
      model: config.model || 'claude-sonnet-4-20250514',
      ...config,
    };
  }

  /**
   * 设置工作目录
   */
  setWorkingDirectory(dir: string): void {
    this.config.cwd = dir;
  }

  /**
   * 获取工作目录
   */
  getWorkingDirectory(): string | undefined {
    return this.config.cwd;
  }

  /**
   * 发送提示并获取响应
   */
  async sendPrompt(
    prompt: string,
    callbacks: ClaudeAgentCallbacks = {}
  ): Promise<string> {
    this.abortController = new AbortController();

    // 构建环境变量
    const env: Record<string, string | undefined> = {
      ...process.env,
      // MCP 工具调用超时设置为 10 分钟（默认 60 秒）
      CLAUDE_CODE_STREAM_CLOSE_TIMEOUT: '600000',
    };

    // 如果配置了 baseUrl（CCR 代理），设置环境变量
    if (this.config.baseUrl) {
      env.ANTHROPIC_BASE_URL = this.config.baseUrl;
    }

    // 如果配置了 apiKey，设置环境变量
    if (this.config.apiKey) {
      env.ANTHROPIC_API_KEY = this.config.apiKey;
    }

    const options: Options = {
      cwd: this.config.cwd,
      model: this.config.model,
      allowedTools: this.config.allowedTools || [
        'Read',
        'Write',
        'Edit',
        'Glob',
        'Grep',
        'LS',
        'Bash',
        'Skill',
      ],
      disallowedTools: this.config.disallowedTools,
      abortController: this.abortController,
      env,
      // 设置源（加载 CLAUDE.md）
      settingSources: this.config.settingSources || [],
      
      // 权限模式
      permissionMode: this.config.permissionMode,
      
      // 允许跳过权限检查（必须为 true 才能使用 bypassPermissions 模式）
      allowDangerouslySkipPermissions: this.config.allowDangerouslySkipPermissions,
      
      // 恢复会话
      resume: this.config.resumeSession,
      
      // 扩展思考（Extended Thinking）- 让 Claude 深度推理
      thinking: { type: 'enabled', budgetTokens: 10000 },
    } as any;
    
    // 配置 MCP 服务器
    if (this.config.mcpServers && this.config.mcpServers.length > 0) {
      const mcpServers: Record<string, McpServerConfig> = {};
      for (const server of this.config.mcpServers) {
        if (server.isEnabled !== false) {
          if (server.type === 'local' && server.command) {
            // 本地 MCP 服务器 (stdio)
            mcpServers[server.name] = {
              type: 'stdio',
              command: server.command,
              args: server.args,
              env: server.env,
            };
          } else if (server.type === 'remote' && server.url) {
            // 远程 MCP 服务器 (SSE)
            mcpServers[server.name] = {
              type: 'sse',
              url: server.url,
            };
          }
        }
      }
       if (Object.keys(mcpServers).length > 0) {
         options.mcpServers = mcpServers;
        
        // 根据 MCP 服务器名称自动添加 allowedTools
        // 官方文档要求：MCP 工具必须通过 allowedTools 授权才能使用
        // 格式：mcp__<server-name>__* 表示允许该服务器的所有工具
        const mcpAllowedTools = Object.keys(mcpServers).map(
          serverName => `mcp__${serverName}__*`
        );
        
        // 合并到现有的 allowedTools
        if (mcpAllowedTools.length > 0) {
          const existingTools = options.allowedTools || [];
          options.allowedTools = [...existingTools, ...mcpAllowedTools];
          console.log('[ClaudeAgentService] 已添加 MCP 工具权限:', mcpAllowedTools);
        }
       }
     }
    
    // 配置系统提示词
    if (this.config.systemPrompt) {
      options.systemPrompt = this.config.systemPrompt;
      console.log('[ClaudeAgentService] 已配置系统提示词:',
        typeof this.config.systemPrompt === 'string'
          ? this.config.systemPrompt.substring(0, 200) + '...'
          : JSON.stringify(this.config.systemPrompt));
    } else {
      console.log('[ClaudeAgentService] ⚠️  未配置系统提示词');
    }

    let fullResponse = '';

    try {
      // 日志：发送给 SDK 的完整配置
      console.log('[ClaudeAgentService] ========================================');
      console.log('[ClaudeAgentService] 发送给 Claude SDK 的配置:');
      console.log('[ClaudeAgentService] - 模型:', this.config.model);
      console.log('[ClaudeAgentService] - 工作目录:', this.config.cwd);
      console.log('[ClaudeAgentService] - 权限模式:', this.config.permissionMode);
      console.log('[ClaudeAgentService] - 允许跳过权限:', this.config.allowDangerouslySkipPermissions);
      console.log('[ClaudeAgentService] - 设置源(settingSources):', this.config.settingSources || '未配置');
      console.log('[ClaudeAgentService] - 系统提示词类型:', typeof this.config.systemPrompt);
      console.log('[ClaudeAgentService] - 系统提示词内容:',
        this.config.systemPrompt
          ? (typeof this.config.systemPrompt === 'string'
              ? this.config.systemPrompt.substring(0, 300) + '...'
              : JSON.stringify(this.config.systemPrompt, null, 2).substring(0, 500) + '...')
          : '未配置');
      console.log('[ClaudeAgentService] - 用户提示词(prompt):', prompt.substring(0, 300) + '...');
      console.log('[ClaudeAgentService] ========================================');

      const q = query({
        prompt,
        options,
      });

      let capturedSessionId = false;
      
      // 累计 token 使用量（从 assistant 消息中提取）
      const seenMessageIds = new Set<string>();
      let accumulatedInputTokens = 0;
      let accumulatedOutputTokens = 0;
      let accumulatedCacheReadTokens = 0;
      let accumulatedCacheCreationTokens = 0;

      // 遍历消息流
      for await (const message of q) {
        // 调试：打印每条消息的完整结构
        const msg = message as any;
        console.log('[ClaudeAgent] 📨 消息类型:', msg.type, '| subtype:', msg.subtype);
        
        // 检查是否有 usage 相关字段
        if (msg.usage || msg.apiUsage || msg.total_cost_usd !== undefined || msg.num_turns !== undefined) {
          console.log('[ClaudeAgent] 📊 发现 usage 相关数据:', {
            usage: msg.usage,
            apiUsage: msg.apiUsage,
            total_cost_usd: msg.total_cost_usd,
            num_turns: msg.num_turns,
            modelUsage: msg.modelUsage,
          });
        }
        
        callbacks.onMessage?.(message);

        // 捕获 SDK 返回的会话 ID（参考 CloudCLI 实现）
        if (msg.session_id && !capturedSessionId) {
          capturedSessionId = true;
          console.log('[ClaudeAgent] 🆔 会话ID:', msg.session_id);
          callbacks.onSessionId?.(msg.session_id);
        }

        // 处理不同类型的消息
        if (this.isResultSuccess(message)) {
          // 成功结果消息
          fullResponse = message.result || '';
          if (message.result) {
            callbacks.onChunk?.(message.result);
          }
          
          // SDKResultSuccess 包含 total_cost_usd 和 modelUsage
          const msg = message as any;
          const totalCostUsd = msg.total_cost_usd || 0;
          
          console.log('[ClaudeAgent] Result Success - total_cost_usd:', totalCostUsd);
          console.log('[ClaudeAgent] Result Success - modelUsage:', JSON.stringify(msg.modelUsage));
          console.log('[ClaudeAgent] 📊 累计 token:', {
            inputTokens: accumulatedInputTokens,
            outputTokens: accumulatedOutputTokens,
            cacheReadTokens: accumulatedCacheReadTokens,
            cacheCreationTokens: accumulatedCacheCreationTokens,
            totalCostUsd,
            steps: seenMessageIds.size,
          });
          
          // 回调最终累计的 token 使用量
          const usageData = {
            inputTokens: accumulatedInputTokens,
            outputTokens: accumulatedOutputTokens,
            cacheReadInputTokens: accumulatedCacheReadTokens,
            cacheCreationInputTokens: accumulatedCacheCreationTokens,
            totalCostUsd,
            modelUsage: msg.modelUsage || {},
          };
          console.log('[ClaudeAgent] ✅ 最终 Token 使用量:', usageData);
          callbacks.onUsage?.(usageData);
        } else if (this.isResultError(message)) {
          // 错误结果消息
          const errorMsg = message.errors?.join('\n') || 'Unknown error';
          console.error('[ClaudeAgent] Error:', errorMsg);
          callbacks.onError?.(new Error(errorMsg));
        } else if (this.isToolUseMessage(message)) {
          // 工具使用消息
          const toolUse = message as any;
          if (toolUse.tool_name) {
            callbacks.onToolUse?.(toolUse.tool_name, toolUse.tool_input || {});
          }
        } else if (this.isToolResultMessage(message)) {
          // 工具结果消息
          const toolResult = message as any;
          if (toolResult.tool_name) {
            callbacks.onToolResult?.(toolResult.tool_name, toolResult.tool_result);
          }
        } else if (this.isAssistantMessage(message)) {
          // 助手消息（流式文本）
          const assistantMsg = message as any;
          
          // 调试：打印完整的 assistant 消息结构
          console.log('[ClaudeAgent] 📨 Assistant 消息完整结构:', {
            type: assistantMsg.type,
            hasMessage: !!assistantMsg.message,
            hasUsage: !!assistantMsg.usage,
            messageKeys: assistantMsg.message ? Object.keys(assistantMsg.message) : [],
            topKeys: Object.keys(assistantMsg),
          });
          
          // 根据 SDK 文档，token 使用量可能在以下位置：
          // 1. message.message.usage（嵌套结构）
          // 2. message.usage（直接字段）
          let usageData = null;
          let msgId = null;
          
          if (assistantMsg.message?.usage) {
            // 方式1：嵌套在 message.message 中
            msgId = assistantMsg.message.id;
            usageData = assistantMsg.message.usage;
            console.log('[ClaudeAgent] 📊 从 message.message.usage 提取');
          } else if (assistantMsg.usage) {
            // 方式2：直接在消息上
            msgId = assistantMsg.id || assistantMsg.message_id;
            usageData = assistantMsg.usage;
            console.log('[ClaudeAgent] 📊 从 message.usage 提取');
          }
          
          if (usageData) {
            // 使用 message ID 去重（并行工具调用可能共享相同 ID）
            if (msgId && !seenMessageIds.has(msgId)) {
              seenMessageIds.add(msgId);
              
              const inputTokens = usageData.input_tokens || 0;
              const outputTokens = usageData.output_tokens || 0;
              const cacheReadTokens = usageData.cache_read_input_tokens || 0;
              const cacheCreationTokens = usageData.cache_creation_input_tokens || 0;
              
              accumulatedInputTokens += inputTokens;
              accumulatedOutputTokens += outputTokens;
              accumulatedCacheReadTokens += cacheReadTokens;
              accumulatedCacheCreationTokens += cacheCreationTokens;
              
              console.log('[ClaudeAgent] 📊 Assistant 消息 usage:', {
                msgId,
                inputTokens,
                outputTokens,
                cacheReadTokens,
                cacheCreationTokens,
              });
              
              // 实时回调每次的 token 使用量
              callbacks.onUsage?.({
                inputTokens,
                outputTokens,
                cacheReadInputTokens: cacheReadTokens,
                cacheCreationInputTokens: cacheCreationTokens,
                totalCostUsd: 0, // 单条消息没有费用，费用在 result 消息中
                modelUsage: {},
              });
            }
          } else {
            console.log('[ClaudeAgent] ⚠️ Assistant 消息中没有找到 usage 数据');
          }
          
          if (assistantMsg.content) {
            for (const block of assistantMsg.content) {
              if (block.type === 'text' && block.text) {
                fullResponse += block.text;
                callbacks.onChunk?.(block.text);
              }
            }
          }
        }
      }

      callbacks.onComplete?.(fullResponse);
      return fullResponse;
    } catch (error) {
      console.error('[ClaudeAgent] Error:', error);
      if ((error as Error).name === 'AbortError') {
        callbacks.onComplete?.(fullResponse);
        return fullResponse;
      }
      callbacks.onError?.(error as Error);
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * 发送消息并处理响应（支持多轮对话）
   */
  async sendMessage(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    callbacks: ClaudeAgentCallbacks = {}
  ): Promise<string> {
    // 将消息转换为提示
    const prompt = messages
      .map(m => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    return this.sendPrompt(prompt, callbacks);
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
   * 类型守卫：检查是否为结果成功消息
   */
  private isResultSuccess(message: SDKMessage): message is SDKResultSuccess {
    return (message as any).type === 'result' && (message as any).subtype === 'success';
  }

  /**
   * 类型守卫：检查是否为结果错误消息
   */
  private isResultError(message: SDKMessage): message is SDKResultError {
    return (message as any).type === 'result' && (message as any).subtype?.startsWith('error');
  }

  /**
   * 类型守卫：检查是否为工具使用消息
   */
  private isToolUseMessage(message: SDKMessage): boolean {
    return (message as any).type === 'tool_use';
  }

  /**
   * 类型守卫：检查是否为工具结果消息
   */
  private isToolResultMessage(message: SDKMessage): boolean {
    return (message as any).type === 'tool_result';
  }

  /**
   * 类型守卫：检查是否为助手消息
   */
  private isAssistantMessage(message: SDKMessage): boolean {
    return (
      (message as any).type === 'assistant' ||
      (message as any).role === 'assistant' ||
      (message as any).subtype === 'assistant'
    );
  }
}

/**
 * 创建 Claude Agent 服务实例的工厂方法
 */
export function createClaudeAgentService(config: ClaudeAgentConfig = {}): ClaudeAgentService {
  return new ClaudeAgentService(config);
}
