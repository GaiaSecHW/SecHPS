// src/services/providers/base-provider.ts

import {
  MultiSourceSession,
  ClaudeCodeSession,
  NormalizedMessage,
  ProviderSource,
} from '@/types/claude-code';

/**
 * Provider 抽象基类
 * 定义所有 AI 助手 Provider 的统一接口
 */
export abstract class BaseProvider {
  /**
   * Provider 名称
   */
  abstract readonly name: string;

  /**
   * Provider 来源标识
   */
  abstract readonly source: ProviderSource;

  /**
   * 图标名称（用于 UI 显示）
   */
  abstract readonly icon: string;

  /**
   * 颜色主题（用于 UI 显示）
   */
  abstract readonly color: string;

  /**
   * 发现所有会话
   * @returns 会话列表
   */
  abstract discoverSessions(): Promise<MultiSourceSession[]>;

  /**
   * 获取单个会话详情
   * @param sessionId 会话 ID
   * @returns 会话信息，如果不存在则返回 null
   */
  abstract getSession(sessionId: string): Promise<ClaudeCodeSession | null>;

  /**
   * 获取会话消息列表
   * @param sessionId 会话 ID
   * @param limit 返回消息数量限制
   * @param offset 偏移量
   * @returns 规范化的消息列表
   */
  abstract getMessages(
    sessionId: string,
    limit?: number,
    offset?: number
  ): Promise<NormalizedMessage[]>;

  /**
   * 检查 Provider 是否可用
   * @returns 是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      const sessions = await this.discoverSessions();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 规范化消息
   * 子类实现具体的消息规范化逻辑
   * @param rawMessage 原始消息
   * @param sessionId 会话 ID
   * @returns 规范化的消息数组
   */
  protected abstract normalizeMessage(
    rawMessage: unknown,
    sessionId: string
  ): NormalizedMessage[];

  /**
   * 生成唯一 ID
   * @param prefix ID 前缀
   * @returns 唯一 ID
   */
  protected generateId(prefix: string = 'msg'): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * 安全解析 JSON
   * @param text JSON 字本
   * @param defaultValue 解析失败时的默认值
   * @returns 解析结果
   */
  protected safeJsonParse<T>(text: string, defaultValue: T): T {
    try {
      return JSON.parse(text);
    } catch {
      return defaultValue;
    }
  }
}
