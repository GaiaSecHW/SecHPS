// src/services/ai/ccr-proxy.ts

import { AIProvider, AIMessage, AIStreamCallbacks, AIProviderConfig } from './base';
import { logger, LOG_MODULES } from '@/lib/logger';

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

    logger.info(LOG_MODULES.AGENT, '调用内部大模型', {
      details: {
        url: baseUrl,
        model: this.config.model,
      }
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
        signal: this.abortController!.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        const apiError = new Error(`内部大模型错误: ${response.status} ${error}`) as Error & { status?: number };
        apiError.status = response.status;
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
              const chunk = JSON.parse(data) as any;
              const choices = chunk.choices as any[];
              const content = choices?.[0]?.delta?.content || '';
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
