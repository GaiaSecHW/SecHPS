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

    let baseUrl = this.config.baseUrl;
    if (!baseUrl) {
      throw new Error('Claude API baseUrl 未配置，请在模型配置中设置 apiBaseUrl');
    }

    // Claude 原生 API 格式 - 使用 /v1/messages 端点
    // 如果 URL 不包含 /v1/messages，自动添加
    if (!baseUrl.includes('/v1/messages') && !baseUrl.endsWith('/messages')) {
      // 移除末尾斜杠，添加 /v1/messages
      baseUrl = baseUrl.replace(/\/+$/, '') + '/v1/messages';
    }

    console.log('[ClaudeProvider] 调用 Claude API:', {
      url: baseUrl,
      model: this.config.model,
      hasApiKey: !!this.config.apiKey,
    });

    await this.withRetry(async () => {
      const response = await fetch(baseUrl, {
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
        signal: this.abortController!.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        const apiError = new Error(`Claude API 错误: ${response.status} ${error}`) as Error & { status?: number };
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
        callbacks.onComplete(fullResponse);
      } else {
        callbacks.onError(error as Error);
      }
    }
  }

  private extractText(chunk: Record<string, unknown>): string {
    // Claude API 流式响应格式
    if (chunk.type === 'content_block_delta' && (chunk as Record<string, unknown>).delta && typeof (chunk.delta as Record<string, unknown>).text === 'string') {
      return (chunk.delta as Record<string, unknown>).text as string;
    }
    // 兼容其他格式
    if ((chunk as Record<string, unknown>).delta && typeof ((chunk as Record<string, unknown>).delta as Record<string, unknown>).text === 'string') {
      return ((chunk as Record<string, unknown>).delta as Record<string, unknown>).text as string;
    }
    return '';
  }
}
