// src/services/ai/claude.ts

import { AIProvider, AIMessage, AIStreamCallbacks, AIProviderConfig } from './base';

export class ClaudeProvider extends AIProvider {
  constructor(config: AIProviderConfig) {
    super(config);
  }

  /**
   * 判断是否使用 OpenAI 兼容格式
   * 如果 baseUrl 不是 Anthropic 官方 API，则假设是 OpenAI 兼容的代理
   */
  private isOpenAICompatible(): boolean {
    const baseUrl = this.config.baseUrl || '';
    // 如果是 Anthropic 官方 API，使用原生格式
    if (baseUrl.includes('api.anthropic.com')) {
      return false;
    }
    // 自定义 URL 假设是 OpenAI 兼容代理
    return true;
  }

  async stream(
    messages: AIMessage[],
    callbacks: AIStreamCallbacks
  ): Promise<void> {
    this.abortController = new AbortController();

    const isOpenAI = this.isOpenAICompatible();

    if (isOpenAI) {
      await this.streamOpenAICompatible(messages, callbacks);
    } else {
      await this.streamClaudeNative(messages, callbacks);
    }
  }

  /**
   * OpenAI 兼容格式（用于代理服务）
   */
  private async streamOpenAICompatible(
    messages: AIMessage[],
    callbacks: AIStreamCallbacks
  ): Promise<void> {
    let baseUrl = this.config.baseUrl || '';

    // 确保 URL 正确
    if (!baseUrl.endsWith('/chat/completions')) {
      if (baseUrl.endsWith('/v1')) {
        baseUrl = baseUrl + '/chat/completions';
      } else if (!baseUrl.endsWith('/v1/')) {
        baseUrl = baseUrl.replace(/\/?$/, '/v1/chat/completions');
      }
    }

    console.log('[ClaudeProvider] 使用 OpenAI 兼容格式:', {
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
          max_tokens: this.config.maxTokens || 4096,
          stream: true,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        const apiError = new Error(`Claude API 错误: ${response.status} ${error}`) as Error & { status?: number };
        apiError.status = response.status;
        throw apiError;
      }

      await this.handleOpenAIStream(response, callbacks);
    }, this.config.retryConfig);
  }

  /**
   * Claude 原生 API 格式
   */
  private async streamClaudeNative(
    messages: AIMessage[],
    callbacks: AIStreamCallbacks
  ): Promise<void> {
    const systemMessage = messages.find(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    const baseUrl = this.config.baseUrl || 'https://api.anthropic.com/v1/messages';

    console.log('[ClaudeProvider] 使用 Claude 原生格式:', {
      url: baseUrl,
      model: this.config.model,
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
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        const apiError = new Error(`Claude API 错误: ${response.status} ${error}`) as Error & { status?: number };
        apiError.status = response.status;
        throw apiError;
      }

      await this.handleClaudeStream(response, callbacks);
    }, this.config.retryConfig);
  }

  /**
   * 处理 OpenAI 兼容格式的流式响应
   */
  private async handleOpenAIStream(
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
              const content = (chunk as Record<string, unknown>).choices?.[0] &&
                ((chunk as Record<string, unknown>).choices as Array<Record<string, unknown>>)[0]?.delta &&
                typeof (((chunk as Record<string, unknown>).choices as Array<Record<string, unknown>>)[0].delta as Record<string, unknown>).content === 'string'
                  ? (((chunk as Record<string, unknown>).choices as Array<Record<string, unknown>>)[0].delta as Record<string, unknown>).content as string
                  : '';
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

  /**
   * 处理 Claude 原生格式的流式响应
   */
  private async handleClaudeStream(
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
              const text = this.extractClaudeText(chunk);
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

  private extractClaudeText(chunk: Record<string, unknown>): string {
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
