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
  temperature?: number;  // 模型温度，默认 0.3
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
      
      // 最大输出 token 数，默认 32000
      maxTokens: this.config.maxTokens ?? 32000,
      
      // 模型温度，默认 0.3
      temperature: this.config.temperature ?? 0.3,
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
      // 注意：SDK 返回的 usage 是累计值（cumulative），不是增量值（incremental）
      // 所以要用 Math.max 取最大值，而不是累加
      // 参考：https://docs.anthropic.com/en/api/streaming
      const seenMessageIds = new Set<string>();
      let accumulatedInputTokens = 0;
      let accumulatedOutputTokens = 0;
      let accumulatedCacheReadTokens = 0;
      let accumulatedCacheCreationTokens = 0;

      // 遍历消息流
      for await (const message of q) {
        const msg = message as any;
        const msgType = msg.type;
        const msgSubtype = msg.subtype;
        const msgRole = msg.role;
        
        // 打印消息类型
        console.log(`[ClaudeAgent] 📨 消息: type=${msgType} | subtype=${msgSubtype} | role=${msgRole}`);
        
        // 处理所有可能包含内容的消息
        let extractedContent = '';
        
        // 1. result 字段（完成时的最终结果）
        if (msg.result && typeof msg.result === 'string') {
          extractedContent = msg.result;
          console.log('[ClaudeAgent] 📨 从 result 提取，长度:', extractedContent.length);
        }
        
        // 2. message.content 字段
        if (!extractedContent && msg.message?.content) {
          const content = msg.message.content;
          if (Array.isArray(content)) {
            const textBlocks = content.filter((b: any) => b.type === 'text' && b.text);
            if (textBlocks.length > 0) {
              extractedContent = textBlocks.map((b: any) => b.text).join('');
              console.log('[ClaudeAgent] 📨 从 message.content[] 提取，长度:', extractedContent.length);
            }
          } else if (typeof content === 'string') {
            extractedContent = content;
            console.log('[ClaudeAgent] 📨 从 message.content (string) 提取，长度:', extractedContent.length);
          }
        }
        
        // 3. content 字段（直接）
        if (!extractedContent && msg.content) {
          const content = msg.content;
          if (Array.isArray(content)) {
            const textBlocks = content.filter((b: any) => b.type === 'text' && b.text);
            if (textBlocks.length > 0) {
              extractedContent = textBlocks.map((b: any) => b.text).join('');
              console.log('[ClaudeAgent] 📨 从 content[] 提取，长度:', extractedContent.length);
            }
          } else if (typeof content === 'string') {
            extractedContent = content;
            console.log('[ClaudeAgent] 📨 从 content (string) 提取，长度:', extractedContent.length);
          }
        }
        
        // 4. text 字段
        if (!extractedContent && msg.text && typeof msg.text === 'string') {
          extractedContent = msg.text;
          console.log('[ClaudeAgent] 📨 从 text 提取，长度:', extractedContent.length);
        }
        
        // 5. description 字段（system/task_progress 消息）
        if (!extractedContent && msg.description && typeof msg.description === 'string') {
          extractedContent = msg.description;
          console.log('[ClaudeAgent] 📨 从 description 提取，长度:', extractedContent.length);
        }
        
        // 如果提取到内容，调用 onChunk
        if (extractedContent) {
          fullResponse += extractedContent;
          callbacks.onChunk?.(extractedContent);
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
          
          // 回调最终累计的 token 使用量
          const usageData = {
            inputTokens: accumulatedInputTokens,
            outputTokens: accumulatedOutputTokens,
            cacheReadInputTokens: accumulatedCacheReadTokens,
            cacheCreationInputTokens: accumulatedCacheCreationTokens,
            totalCostUsd,
            modelUsage: msg.modelUsage || {},
          };
          
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
          // 助手消息（流式文本）- 已在上面统一提取内容，这里只处理 token 使用量
          const assistantMsg = message as any;
          
          // 根据 SDK 文档，token 使用量可能在以下位置：
          // 1. message.message.usage（嵌套结构）
          // 2. message.usage（直接字段）
          let usageData = null;
          let msgId = null;
          
          if (assistantMsg.message?.usage) {
            msgId = assistantMsg.message.id;
            usageData = assistantMsg.message.usage;
          } else if (assistantMsg.usage) {
            msgId = assistantMsg.id || assistantMsg.message_id;
            usageData = assistantMsg.usage;
          }
          
          if (usageData) {
            if (msgId && !seenMessageIds.has(msgId)) {
              seenMessageIds.add(msgId);
              
              const inputTokens = usageData.input_tokens || 0;
              const outputTokens = usageData.outputTokens || 0;
              const cacheReadTokens = usageData.cache_read_input_tokens || 0;
              const cacheCreationTokens = usageData.cache_creation_input_tokens || 0;
              
              // SDK 返回的是累计值，使用 Math.max 而不是累加
              // 避免重复计算（SDK 可能在多个事件中返回相同的累计值）
              accumulatedInputTokens = Math.max(accumulatedInputTokens, inputTokens);
              accumulatedOutputTokens = Math.max(accumulatedOutputTokens, outputTokens);
              accumulatedCacheReadTokens = Math.max(accumulatedCacheReadTokens, cacheReadTokens);
              accumulatedCacheCreationTokens = Math.max(accumulatedCacheCreationTokens, cacheCreationTokens);
              
              console.log('[ClaudeAgent] 📊 Token (cumulative): input=%d, output=%d', accumulatedInputTokens, accumulatedOutputTokens);
              
              // 回调当前的累计值
              callbacks.onUsage?.({
                inputTokens: accumulatedInputTokens,
                outputTokens: accumulatedOutputTokens,
                cacheReadInputTokens: accumulatedCacheReadTokens,
                cacheCreationInputTokens: accumulatedCacheCreationTokens,
                totalCostUsd: 0,
                modelUsage: {},
              });
            }
          }
          // 内容已在上面统一提取，这里不再重复处理
        } else {
          // 其他类型的消息 - 也要尝试提取内容
          console.log('[ClaudeAgent] 📨 其他消息类型，尝试提取内容');
          console.log('[ClaudeAgent] 📨 消息 keys:', Object.keys(msg));
          
          // 处理 type=user 消息
          if (msgType === 'user') {
            console.log('[ClaudeAgent] 📨 处理 user 消息');
            // user 消息通常包含在 message.content 中
            if (msg.message?.content) {
              const content = msg.message.content;
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'text' && block.text) {
                    console.log('[ClaudeAgent] 📨 从 user 消息提取 text，长度:', block.text.length);
                    // user 消息不追加到 fullResponse，但触发 onMessage 回调
                    callbacks.onMessage?.(message);
                  }
                }
              } else if (typeof content === 'string') {
                console.log('[ClaudeAgent] 📨 从 user 消息提取 string content，长度:', content.length);
                callbacks.onMessage?.(message);
              }
            }
            // 检查 tool_use_result（工具返回结果）
            if (msg.tool_use_result) {
              console.log('[ClaudeAgent] 📨 user 消息包含 tool_use_result');
              callbacks.onMessage?.(message);
            }
            continue;
          }
          
          // 尝试从各种可能的位置提取内容
          if (msg.message?.content) {
            const content = msg.message.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text' && block.text) {
                  console.log('[ClaudeAgent] 📨 从其他消息提取 text，长度:', block.text.length);
                  fullResponse += block.text;
                  callbacks.onChunk?.(block.text);
                }
              }
            } else if (typeof content === 'string') {
              console.log('[ClaudeAgent] 📨 从其他消息提取 string content，长度:', content.length);
              fullResponse += content;
              callbacks.onChunk?.(content);
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
