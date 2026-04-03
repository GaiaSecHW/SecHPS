// src/services/ai/index.ts

import { AIProvider, DEFAULT_RETRY_CONFIG } from './base';
import { ClaudeProvider } from './claude';
import { CCRProxyProvider } from './ccr-proxy';

// 重新导出类型
export type { AIMessage, AIStreamCallbacks, AIProviderConfig, RetryConfig } from './base';

export type ProviderType = 'claude' | 'openai' | 'ccr-proxy';

/**
 * 创建 AI 提供商实例
 */
export function createAIProvider(
  type: ProviderType,
  config: import('./base').AIProviderConfig
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

// 导出类和常量
export { AIProvider, DEFAULT_RETRY_CONFIG };
export { ClaudeProvider } from './claude';
export { CCRProxyProvider } from './ccr-proxy';
