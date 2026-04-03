// src/services/evaluation/caller.ts

import {
  createAIProvider,
  AIProvider,
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
