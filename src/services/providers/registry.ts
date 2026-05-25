// src/services/providers/registry.ts

import { BaseProvider } from './base-provider';
import { ClaudeProvider } from './claude-provider';
import { CursorProvider } from './cursor-provider';
import { CodexProvider } from './codex-provider';
import { GeminiProvider } from './gemini-provider';
import { MultiSourceSession, ProviderSource } from '@/types/claude-code';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * Provider 注册表
 * 管理所有 Provider 实例，提供统一的访问接口
 */
export class ProviderRegistry {
  private providers: Map<string, BaseProvider> = new Map();
  private initialized: boolean = false;

  constructor() {
    // 自动注册内置 Provider
    this.registerBuiltins();
  }

  /**
   * 注册内置 Provider
   */
  private registerBuiltins(): void {
    this.register(new ClaudeProvider());
    this.register(new CursorProvider());
    this.register(new CodexProvider());
    this.register(new GeminiProvider());
    this.initialized = true;
  }

  /**
   * 注册 Provider
   * @param provider Provider 实例
   */
  register(provider: BaseProvider): void {
    if (this.providers.has(provider.source)) {
      logger.warn(LOG_MODULES.PROVIDER, 'Provider 已存在，将被覆盖', { details: { source: provider.source } });
    }
    this.providers.set(provider.source, provider);
  }

  /**
   * 获取 Provider
   * @param name Provider 名称或来源标识
   * @returns Provider 实例，如果不存在则返回 undefined
   */
  get(name: ProviderSource): BaseProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * 获取所有 Provider
   * @returns Provider 实例列表
   */
  getAll(): BaseProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * 获取所有可用的 Provider
   * @returns 可用的 Provider 实例列表
   */
  async getAvailable(): Promise<BaseProvider[]> {
    const available: BaseProvider[] = [];
    
    for (const provider of this.providers.values()) {
      try {
        const isAvailable = await provider.isAvailable();
        if (isAvailable) {
          available.push(provider);
        }
      } catch (error) {
        logger.warn(LOG_MODULES.PROVIDER, 'Provider 检查可用性失败', { details: { name: provider.name, error: error instanceof Error ? error.message : String(error) } });
      }
    }
    
    return available;
  }

  /**
   * 发现所有 Provider 的会话
   * @returns 所有会话列表
   */
  async discoverAllSessions(): Promise<MultiSourceSession[]> {
    const sessions: MultiSourceSession[] = [];
    
    for (const provider of this.providers.values()) {
      try {
        const providerSessions = await provider.discoverSessions();
        sessions.push(...providerSessions);
      } catch (error) {
        logger.error(LOG_MODULES.PROVIDER, 'Provider 发现会话失败', { details: { name: provider.name, error: error instanceof Error ? error.message : String(error) } });
      }
    }
    
    // 按更新时间排序
    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    
    return sessions;
  }

  /**
   * 发现指定 Provider 的会话
   * @param source Provider 来源
   * @returns 会话列表
   */
  async discoverSessions(source: ProviderSource): Promise<MultiSourceSession[]> {
    const provider = this.providers.get(source);
    
    if (!provider) {
      logger.warn(LOG_MODULES.PROVIDER, 'Provider 不存在', { details: { source } });
      return [];
    }
    
    try {
      return await provider.discoverSessions();
    } catch (error) {
      logger.error(LOG_MODULES.PROVIDER, 'Provider 发现会话失败', { details: { name: provider.name, error: error instanceof Error ? error.message : String(error) } });
      return [];
    }
  }

  /**
   * 获取会话数量统计
   * @returns 各 Provider 的会话数量
   */
  async getSessionCounts(): Promise<Record<ProviderSource, number>> {
    const counts: Record<ProviderSource, number> = {
      claude: 0,
      cursor: 0,
      codex: 0,
      gemini: 0,
    };
    
    for (const [source, provider] of this.providers.entries()) {
      try {
        const sessions = await provider.discoverSessions();
        counts[source as ProviderSource] = sessions.length;
      } catch (error) {
        logger.error(LOG_MODULES.PROVIDER, 'Provider 获取会话数量失败', { details: { name: provider.name, error: error instanceof Error ? error.message : String(error) } });
      }
    }
    
    return counts;
  }

  /**
   * 检查 Provider 是否已注册
   * @param source Provider 来源
   * @returns 是否已注册
   */
  has(source: ProviderSource): boolean {
    return this.providers.has(source);
  }

  /**
   * 移除 Provider
   * @param source Provider 来源
   * @returns 是否成功移除
   */
  remove(source: ProviderSource): boolean {
    return this.providers.delete(source);
  }

  /**
   * 清空所有 Provider
   */
  clear(): void {
    this.providers.clear();
    this.initialized = false;
  }

  /**
   * 重新初始化
   */
  reinitialize(): void {
    this.clear();
    this.registerBuiltins();
  }

  /**
   * 获取注册状态
   * @returns 是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// 导出单例实例
export const providerRegistry = new ProviderRegistry();
