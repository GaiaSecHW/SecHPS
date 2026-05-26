// src/services/ai/base.ts

import { logger, LOG_MODULES } from '@/lib/logger';

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
          logger.info(LOG_MODULES.AGENT, `重试 ${attempt}/${config.maxAttempts}，等待 ${delay}ms`);
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
  protected isRetryable(error: unknown): boolean {
    const err = error as Error & { status?: number; code?: string };
    // 网络错误、超时、5xx 错误可重试
    if (err.name === 'AbortError') return false;
    if (err.status && err.status >= 500) return true;
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') return true;
    if (err.message?.includes('rate limit')) return true;
    if (err.message?.includes('429')) return true;
    return false;
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
