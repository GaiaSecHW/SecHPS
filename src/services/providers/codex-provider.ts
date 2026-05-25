// src/services/providers/codex-provider.ts

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { BaseProvider } from './base-provider';
import {
  MultiSourceSession,
  ClaudeCodeSession,
  NormalizedMessage,
  CodexMessage,
} from '@/types/claude-code';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * Codex Provider
 * 从 ~/.codex/sessions/ 读取 .jsonl 文件
 */
export class CodexProvider extends BaseProvider {
  readonly name = 'Codex';
  readonly source = 'codex' as const;
  readonly icon = 'codex';
  readonly color = '#10A37F';

  private readonly codexSessionsDir: string;

  constructor() {
    super();
    this.codexSessionsDir = path.join(os.homedir(), '.codex', 'sessions');
  }

  /**
   * 发现所有 Codex 会话
   */
  async discoverSessions(): Promise<MultiSourceSession[]> {
    try {
      await fs.access(this.codexSessionsDir);
    } catch {
      return [];
    }

    try {
      const files = await fs.readdir(this.codexSessionsDir);
      const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));
      const sessions: MultiSourceSession[] = [];

      for (const file of jsonlFiles) {
        const sessionId = file.replace('.jsonl', '');
        const filePath = path.join(this.codexSessionsDir, file);
        const stats = await fs.stat(filePath);

        const sessionInfo = await this.parseSessionInfo(filePath, sessionId);
        
        sessions.push({
          id: sessionId,
          source: 'codex',
          createdAt: stats.birthtime.toISOString(),
          updatedAt: stats.mtime.toISOString(),
          messageCount: sessionInfo.messageCount,
          summary: sessionInfo.summary,
          metadata: {
            filePath,
            cwd: sessionInfo.cwd,
          },
        });
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
      cwd: session.metadata?.cwd as string,
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
      const messages = await this.parseMessages(session.metadata.filePath as string, sessionId);
      
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
    const entry = rawMessage as CodexMessage;
    const messages: NormalizedMessage[] = [];
    const timestamp = entry.timestamp || Date.now();

    // 处理文本消息
    if (entry.content) {
      messages.push({
        id: this.generateId('codex'),
        sessionId,
        source: 'codex',
        role: this.mapRole(entry.role),
        type: 'text',
        content: entry.content,
        timestamp,
      });
    }

    // 处理工具使用
    if (entry.toolName) {
      messages.push({
        id: this.generateId('codex-tool'),
        sessionId,
        source: 'codex',
        role: 'assistant',
        type: 'tool_use',
        content: '',
        timestamp,
        toolUse: {
          id: this.generateId('tool'),
          name: entry.toolName,
          input: entry.toolInput || {},
        },
      });
    }

    // 处理工具结果
    if (entry.toolOutput !== undefined) {
      messages.push({
        id: this.generateId('codex-result'),
        sessionId,
        source: 'codex',
        role: 'user',
        type: 'tool_result',
        content: '',
        timestamp,
        toolResult: {
          toolUseId: this.generateId('tool'),
          content: entry.toolOutput,
        },
      });
    }

    return messages;
  }

  // ============================================
  // 私有方法
  // ============================================

  /**
   * 解析会话信息
   */
  private async parseSessionInfo(
    filePath: string,
    sessionId: string
  ): Promise<{ messageCount: number; summary: string; cwd?: string }> {
    try {
      const fileStream = await fs.open(filePath, 'r');
      const rl = readline.createInterface({
        input: fileStream.createReadStream(),
        crlfDelay: Infinity,
      });

      let messageCount = 0;
      let summary = '';
      let cwd: string | undefined;
      let lastUserMessage = '';

      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const entry = JSON.parse(line);
          messageCount++;

          // 提取 cwd
          if (entry.cwd && !cwd) {
            cwd = entry.cwd;
          }

          // 提取最后用户消息作为摘要
          if (entry.role === 'user' && entry.content) {
            lastUserMessage = this.truncateText(entry.content, 100);
          }
        } catch {
          // 跳过解析错误
        }
      }

      await fileStream.close();
      summary = summary || lastUserMessage || 'Codex Session';

      return { messageCount, summary, cwd };
    } catch (error) {
      logger.error(LOG_MODULES.PROVIDER, '解析会话信息失败', { details: { error: error instanceof Error ? error.message : String(error) } });
      return { messageCount: 0, summary: 'Codex Session' };
    }
  }

  /**
   * 解析消息列表
   */
  private async parseMessages(filePath: string, sessionId: string): Promise<NormalizedMessage[]> {
    const fileStream = await fs.open(filePath, 'r');
    const rl = readline.createInterface({
      input: fileStream.createReadStream(),
      crlfDelay: Infinity,
    });

    const messages: NormalizedMessage[] = [];

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line);
        const normalized = this.normalizeMessage(entry, sessionId);
        messages.push(...normalized);
      } catch {
        // 跳过解析错误
      }
    }

    await fileStream.close();

    // 按时间戳排序
    messages.sort((a, b) => a.timestamp - b.timestamp);

    return messages;
  }

  /**
   * 映射角色
   */
  private mapRole(role?: string): 'user' | 'assistant' | 'system' {
    if (!role) return 'user';
    
    switch (role.toLowerCase()) {
      case 'user':
        return 'user';
      case 'assistant':
      case 'ai':
        return 'assistant';
      case 'system':
        return 'system';
      default:
        return 'user';
    }
  }

  /**
   * 截断文本
   */
  private truncateText(text: string, maxLength: number): string {
    if (!text || text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength) + '...';
  }
}
