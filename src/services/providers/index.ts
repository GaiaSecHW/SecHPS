// src/services/providers/index.ts

// 导出类型
export type {
  ProviderSource,
  MultiSourceSession,
  NormalizedMessage,
  ClaudeCodeSession,
  CursorSession,
  CursorMessage,
  CodexSession,
  CodexMessage,
  GeminiSession,
  GeminiMessage,
  ProviderConfig,
  MultiSourceProviderConfig,
} from '@/types/claude-code';

// 导出基类
export { BaseProvider } from './base-provider';

// 导出具体实现
export { ClaudeProvider } from './claude-provider';
export { CursorProvider } from './cursor-provider';
export { CodexProvider } from './codex-provider';
export { GeminiProvider } from './gemini-provider';

// 导出注册表
export { ProviderRegistry, providerRegistry } from './registry';
