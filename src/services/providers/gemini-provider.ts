// src/services/providers/gemini-provider.ts

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { BaseProvider } from './base-provider';
import {
  MultiSourceSession,
  ClaudeCodeSession,
  NormalizedMessage,
  GeminiMessage,
  GeminiSession,
} from '@/types/claude-code';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * Gemini Provider
 * 从 ~/.gemini/sessions/ 读取 .json 文件
 */
export class GeminiProvider extends BaseProvider {
  readonly name = 'Gemini';
  readonly source = 'gemini' as const;
  readonly icon = 'gemini';
  readonly color = '#4285F4';

  private readonly geminiSessionsDir: string;

  constructor() {
    super();
    this.geminiSessionsDir = path.join(os.homedir(), '.gemini', 'sessions');
  }

  /**
   * 发现所有 Gemini 会话
   */
  async discoverSessions(): Promise<MultiSourceSession[]> {
    try {
      await fs.access(this.geminiSessionsDir);
    } catch {
      return [];
    }

    try {
      const files = await fs.readdir(this.geminiSessionsDir);
      const jsonFiles = files.filter(file => file.endsWith('.json'));
      const sessions: MultiSourceSession[] = [];

      for (const file of jsonFiles) {
        const filePath = path.join(this.geminiSessionsDir, file);
        
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const session: GeminiSession = JSON.parse(content);
          const stats = await fs.stat(filePath);

          sessions.push({
            id: session.id || file.replace('.json', ''),
            source: 'gemini',
            createdAt: session.createdAt || stats.birthtime.toISOString(),
            updatedAt: session.updatedAt || stats.mtime.toISOString(),
            messageCount: session.messages?.length || 0,
            summary: session.title || 'Gemini Session',
            metadata: {
              filePath,
            },
          });
        } catch {
          // 跳过无法解析的文件
        }
      }

      // 按更新时间排序
      sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      return sessions;
    } catch (error) {
      logger.error(LOG_MODULES.PROVIDER, '发现会话失败', { details: { error: error instanceof Error ? error.message : String(error) } });
      return [];
    }
  }

  /**
   * 获取单个会话详情
   */
  async getSession(sessionId: string): Promise<ClaudeCodeSession | null> {
    const sessions = await this.discoverSessions();
    const session = sessions.find(s => s.id === sessionId);
    
    if (!session) {
      return null;
    }

    return {
      id: session.id,
      summary: session.summary || '',
      messageCount: session.messageCount,
      lastActivity: session.updatedAt,
      filePath: session.metadata?.filePath as string,
    };
  }

  /**
   * 获取会话消息
   */
  async getMessages(
    sessionId: string,
    limit?: number,
    offset?: number
  ): Promise<NormalizedMessage[]> {
    const sessions = await this.discoverSessions();
    const session = sessions.find(s => s.id === sessionId);
    
    if (!session || !session.metadata?.filePath) {
      return [];
    }

    try {
      const content = await fs.readFile(session.metadata.filePath as string, 'utf-8');
      const geminiSession: GeminiSession = JSON.parse(content);
      
      const messages = this.parseMessages(geminiSession.messages || [], sessionId);
      
      // 应用分页
      const start = offset || 0;
      const end = limit ? start + limit : undefined;
      
      return messages.slice(start, end);
    } catch (error) {
      logger.error(LOG_MODULES.PROVIDER, '获取消息失败', { details: { error: error instanceof Error ? error.message : String(error) } });
      return [];
    }
  }

  /**
   * 规范化消息
   */
  protected normalizeMessage(rawMessage: unknown, sessionId: string): NormalizedMessage[] {
    const geminiMsg = rawMessage as GeminiMessage;
    const messages: NormalizedMessage[] = [];
    const timestamp = geminiMsg.timestamp || Date.now();

    // 处理每个 part
    for (const part of geminiMsg.parts || []) {
      // 文本内容
      if (part.text) {
        messages.push({
          id: this.generateId('gemini'),
          sessionId,
          source: 'gemini',
          role: this.mapRole(geminiMsg.role),
          type: 'text',
          content: part.text,
          timestamp,
        });
      }

      // 函数调用
      if (part.functionCall) {
        messages.push({
          id: this.generateId('gemini-func'),
          sessionId,
          source: 'gemini',
          role: 'assistant',
          type: 'tool_use',
          content: '',
          timestamp,
          toolUse: {
            id: this.generateId('func'),
            name: part.functionCall.name,
            input: part.functionCall.args,
          },
        });
      }

      // 函数响应
      if (part.functionResponse) {
        messages.push({
          id: this.generateId('gemini-resp'),
          sessionId,
          source: 'gemini',
          role: 'user',
          type: 'tool_result',
          content: '',
          timestamp,
          toolResult: {
            toolUseId: this.generateId('func'),
            content: part.functionResponse.response,
          },
        });
      }
    }

    return messages;
  }

  // ============================================
  // 私有方法
  // ============================================

  /**
   * 解析消息列表
   */
  private parseMessages(messages: GeminiMessage[], sessionId: string): NormalizedMessage[] {
    const normalized: NormalizedMessage[] = [];

    for (const msg of messages) {
      const converted = this.normalizeMessage(msg, sessionId);
      normalized.push(...converted);
    }

    // 按时间戳排序
    normalized.sort((a, b) => a.timestamp - b.timestamp);

    return normalized;
  }

  /**
   * 映射角色
   */
  private mapRole(role: string): 'user' | 'assistant' | 'system' {
    switch (role.toLowerCase()) {
      case 'user':
        return 'user';
      case 'model':
      case 'assistant':
        return 'assistant';
      case 'system':
        return 'system';
      default:
        return 'user';
    }
  }
}
