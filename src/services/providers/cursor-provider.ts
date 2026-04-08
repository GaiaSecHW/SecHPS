// src/services/providers/cursor-provider.ts

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { BaseProvider } from './base-provider';
import {
  MultiSourceSession,
  ClaudeCodeSession,
  NormalizedMessage,
  CursorMessage,
} from '@/types/claude-code';

/**
 * Cursor Provider
 * 从 ~/.cursor/chats/{md5-hash}/state.vscdb 读取会话数据
 * 
 * 注意：Cursor 使用 SQLite 数据库存储会话数据
 * 由于 better-sqlite3 未安装，此 Provider 提供基础框架
 * 实际 SQLite 读取功能需要在安装 better-sqlite3 后实现
 */
export class CursorProvider extends BaseProvider {
  readonly name = 'Cursor';
  readonly source = 'cursor' as const;
  readonly icon = 'cursor';
  readonly color = '#5C6BC0';

  private readonly cursorChatsDir: string;

  constructor() {
    super();
    this.cursorChatsDir = path.join(os.homedir(), '.cursor', 'chats');
  }

  /**
   * 发现所有 Cursor 会话
   */
  async discoverSessions(): Promise<MultiSourceSession[]> {
    try {
      await fs.access(this.cursorChatsDir);
    } catch {
      return [];
    }

    try {
      const entries = await fs.readdir(this.cursorChatsDir, { withFileTypes: true });
      const directories = entries.filter(e => e.isDirectory());
      const sessions: MultiSourceSession[] = [];

      for (const entry of directories) {
        const chatDir = path.join(this.cursorChatsDir, entry.name);
        const dbPath = path.join(chatDir, 'state.vscdb');

        try {
          await fs.access(dbPath);
          const stats = await fs.stat(dbPath);

          // 读取元数据文件（如果存在）
          const metadataPath = path.join(chatDir, 'metadata.json');
          let metadata: Record<string, unknown> = {};
          try {
            const metadataContent = await fs.readFile(metadataPath, 'utf-8');
            metadata = JSON.parse(metadataContent);
          } catch {
            // 元数据文件不存在
          }

          sessions.push({
            id: entry.name,
            source: 'cursor',
            projectId: metadata.projectId as string,
            projectPath: metadata.projectPath as string,
            projectAlias: metadata.projectName as string,
            createdAt: stats.birthtime.toISOString(),
            updatedAt: stats.mtime.toISOString(),
            messageCount: 0, // 需要读取数据库才能获取
            summary: metadata.title as string || 'Cursor Chat',
            metadata: {
              dbPath,
            },
          });
        } catch {
          // 跳过无法访问的目录
        }
      }

      // 按更新时间排序
      sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      return sessions;
    } catch (error) {
      console.error('[CursorProvider] 发现会话失败:', error);
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
      cwd: session.projectPath,
      filePath: session.metadata?.dbPath as string,
    };
  }

  /**
   * 获取会话消息
   * 
   * 注意：完整实现需要安装 better-sqlite3
   * 当前返回空数组，等待数据库支持
   */
  async getMessages(
    sessionId: string,
    limit?: number,
    offset?: number
  ): Promise<NormalizedMessage[]> {
    // TODO: 实现 SQLite 数据库读取
    // 需要安装 better-sqlite3 后实现
    console.warn('[CursorProvider] SQLite 读取功能尚未实现，请安装 better-sqlite3');
    return [];
  }

  /**
   * 规范化消息
   */
  protected normalizeMessage(rawMessage: unknown, sessionId: string): NormalizedMessage[] {
    const cursorMsg = rawMessage as CursorMessage;
    const messages: NormalizedMessage[] = [];
    const timestamp = cursorMsg.timestamp || Date.now();

    // 基本消息
    messages.push({
      id: cursorMsg.id || this.generateId('cursor'),
      sessionId,
      source: 'cursor',
      role: this.mapRole(cursorMsg.role),
      type: 'text',
      content: cursorMsg.content,
      timestamp,
    });

    // 如果有工具使用
    if (cursorMsg.toolUse) {
      messages.push({
        id: this.generateId('cursor-tool'),
        sessionId,
        source: 'cursor',
        role: 'assistant',
        type: 'tool_use',
        content: '',
        timestamp,
        toolUse: {
          id: this.generateId('tool'),
          name: cursorMsg.toolUse.name,
          input: cursorMsg.toolUse.input,
        },
      });
    }

    return messages;
  }

  // ============================================
  // 私有方法
  // ============================================

  /**
   * 映射角色
   */
  private mapRole(role: string): 'user' | 'assistant' | 'system' {
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
   * 生成工作区哈希
   * Cursor 使用 MD5 哈希工作区路径作为目录名
   */
  static generateWorkspaceHash(workspacePath: string): string {
    return crypto.createHash('md5').update(workspacePath).digest('hex');
  }
}
