// src/services/evaluation/caller.ts

import { ClaudeAgentService, ClaudeAgentCallbacks, createClaudeAgentService, AppMcpServerConfig } from '@/services/ai';
import { ConversationHistory } from './history';
import { PromptBuilder, PromptContext } from './prompt';
import { updateContextWindowFromError, isContextOverflowError } from '@/lib/context-window-updater';

export interface EvaluationConfig {
  modelConfigId?: string;  // ModelConfig ID，用于自动更新 contextWindow
  providerType: string;
  apiKey: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
  cwd?: string;
  allowedTools?: string[]; // 可选：允许的工具列表
  mcpServers?: AppMcpServerConfig[]; // MCP 服务器配置
  contextWindow?: number; // 模型的 context window，用于 SDK Compaction
}

export interface EvaluationCallbacks {
  onChunk: (text: string) => void;
  onComplete: (fullResponse: string) => void;
  onError: (error: Error) => void;
}

/**
 * 评估调用器 - 使用 Claude Agent SDK
 */
export class EvaluationCaller {
  private agentService: ClaudeAgentService;
  private history: ConversationHistory;
  private promptBuilder: PromptBuilder;
  private currentEvaluationId: string | null = null;
  private modelConfigId: string | null = null;  // ModelConfig ID，用于自动更新 contextWindow

  constructor(config: EvaluationConfig) {
    // 保存 modelConfigId
    this.modelConfigId = config.modelConfigId || null;
    // 默认工具列表
    const defaultTools = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'LS', 'Bash'];
    
    // 如果提供了自定义工具列表，合并到默认工具中
    const allowedTools = config.allowedTools 
      ? [...new Set([...defaultTools, ...config.allowedTools])] // 去重
      : defaultTools;
    
    this.agentService = createClaudeAgentService({
      apiKey: config.apiKey,
      model: config.model,
      maxTokens: config.maxTokens,
      cwd: config.cwd,
      baseUrl: config.baseUrl,
      allowedTools,
      mcpServers: config.mcpServers,  // MCP 服务器配置
      contextWindow: config.contextWindow,  // 传递 context window 用于 SDK Compaction
    });
    this.history = new ConversationHistory();
    this.promptBuilder = new PromptBuilder();
  }

  /**
   * 设置工作目录
   */
  setWorkingDirectory(dir: string): void {
    this.agentService.setWorkingDirectory(dir);
  }

  /**
   * 获取工作目录
   */
  getWorkingDirectory(): string | undefined {
    return this.agentService.getWorkingDirectory();
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

    // 保存用户消息到历史
    for (const msg of messages) {
      if (msg.role === 'user') {
        await this.history.addUserMessage(evaluationId, msg.content);
      } else if (msg.role === 'system') {
        // 系统消息也作为用户消息保存（Agent SDK 不区分系统消息）
        await this.history.addUserMessage(evaluationId, `[系统指令]\n${msg.content}`);
      }
    }

    // 构建提示
    const prompt = messages.map(m => `${m.role === 'user' ? 'Human' : 'System'}: ${m.content}`).join('\n\n---\n\n');

    const agentCallbacks: ClaudeAgentCallbacks = {
      onChunk: callbacks.onChunk,
      onComplete: async (fullResponse) => {
        // 保存助手消息到历史
        if (this.currentEvaluationId && fullResponse.trim()) {
          await this.history.addAssistantMessage(this.currentEvaluationId, fullResponse);
        }
        callbacks.onComplete(fullResponse);
      },
      onError: (error: Error) => {
        // 自动学习：如果是 context 超限错误，尝试更新数据库
        if (this.modelConfigId && isContextOverflowError(error)) {
          updateContextWindowFromError(this.modelConfigId, error).catch(() => {});
        }
        callbacks.onError(error);
      },
    };

    try {
      await this.agentService.sendPrompt(prompt, agentCallbacks);
    } catch (error) {
      // 自动学习：如果是 context 超限错误，尝试更新数据库
      if (this.modelConfigId && isContextOverflowError(error)) {
        updateContextWindowFromError(this.modelConfigId, error).catch(() => {});
      }
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
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

    // 构建消息（包含历史）
    const messages = this.promptBuilder.buildMessages({
      ...context,
      conversationHistory,
    });

    // 构建提示
    const prompt = messages.map(m => `${m.role === 'user' ? 'Human' : 'System'}: ${m.content}`).join('\n\n---\n\n');

    const agentCallbacks: ClaudeAgentCallbacks = {
      onChunk: callbacks.onChunk,
      onComplete: async (fullResponse) => {
        // 保存助手消息到历史
        if (this.currentEvaluationId && fullResponse.trim()) {
          await this.history.addAssistantMessage(this.currentEvaluationId, fullResponse);
        }
        callbacks.onComplete(fullResponse);
      },
      onError: (error: Error) => {
        // 自动学习：如果是 context 超限错误，尝试更新数据库
        if (this.modelConfigId && isContextOverflowError(error)) {
          updateContextWindowFromError(this.modelConfigId, error).catch(() => {});
        }
        callbacks.onError(error);
      },
    };

    try {
      await this.agentService.sendPrompt(prompt, agentCallbacks);
    } catch (error) {
      // 自动学习：如果是 context 超限错误，尝试更新数据库
      if (this.modelConfigId && isContextOverflowError(error)) {
        updateContextWindowFromError(this.modelConfigId, error).catch(() => {});
      }
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * 中止评估
   */
  abort(): void {
    this.agentService.abort();
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
  },
  workingDirectory?: string,
  allowedTools?: string[]
): EvaluationCaller {
  // 解析模型列表
  const models = JSON.parse(modelConfig.models || '[]');
  const model = models[0];
  
  if (!model) {
    throw new Error(`模型配置的 models 字段为空，必须配置至少一个模型。`);
  }

  return new EvaluationCaller({
    providerType: modelConfig.providerType,
    apiKey: modelConfig.apiKey,
    baseUrl: modelConfig.apiBaseUrl,
    model,
    cwd: workingDirectory,
    allowedTools,
  });
}
