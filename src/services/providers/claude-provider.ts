// src/services/providers/claude-provider.ts

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { BaseProvider } from './base-provider';
import {
  MultiSourceSession,
  ClaudeCodeSession,
  NormalizedMessage,
  ClaudeCodeJSONLEntry,
  ClaudeCodeMessage,
} from '@/types/claude-code';

/**
 * Claude Provider
 * 从 ~/.claude/projects/ 读取会话数据
 */
export class ClaudeProvider extends BaseProvider {
  readonly name = 'Claude';
  readonly source = 'claude' as const;
  readonly icon = 'claude';
  readonly color = '#CC785C';

  private readonly claudeProjectsDir: string;
  private readonly projectConfigPath: string;
  private projectDirectoryCache: Map<string, string> = new Map();

  constructor() {
    super();
    this.claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
    this.projectConfigPath = path.join(os.homedir(), '.claude', 'project-config.json');
  }

  /**
   * 发现所有 Claude 会话
   */
  async discoverSessions(): Promise<MultiSourceSession[]> {
    try {
      await fs.access(this.claudeProjectsDir);
    } catch {
      return [];
    }

    try {
      const entries = await fs.readdir(this.claudeProjectsDir, { withFileTypes: true });
      const directories = entries.filter(e => e.isDirectory());
      const sessions: MultiSourceSession[] = [];

      for (const entry of directories) {
        const projectName = entry.name;
        const projectPath = await this.extractProjectDirectory(projectName);
        const projectDir = path.join(this.claudeProjectsDir, projectName);

        const files = await fs.readdir(projectDir);
        const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));

        for (const file of jsonlFiles) {
          const sessionId = file.replace('.jsonl', '');
          const filePath = path.join(projectDir, file);
          const stats = await fs.stat(filePath);

          const session = await this.parseSessionFile(filePath, sessionId, projectPath);
          if (session) {
            sessions.push({
              id: sessionId,
              source: 'claude',
              projectId: projectName,
              projectPath,
              createdAt: stats.birthtime.toISOString(),
              updatedAt: stats.mtime.toISOString(),
              messageCount: session.messageCount,
              summary: session.summary,
              metadata: {
                filePath,
                model: session.model,
                cwd: session.cwd,
              },
            });
          }
        }
      }

      // 按更新时间排序
      sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      return sessions;
    } catch (error) {
      console.error('[ClaudeProvider] 发现会话失败:', error);
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
      model: session.metadata?.model as string,
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
      console.error('[ClaudeProvider] 获取消息失败:', error);
      return [];
    }
  }

  /**
   * 规范化消息
   */
  protected normalizeMessage(rawMessage: unknown, sessionId: string): NormalizedMessage[] {
    const entry = rawMessage as ClaudeCodeJSONLEntry;
    const messages: NormalizedMessage[] = [];
    const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();

    // 处理普通消息
    if (entry.message) {
      const content = this.extractTextFromContent(entry.message.content);
      
      if (content && !this.isSystemMessage(content)) {
        messages.push({
          id: this.generateId('claude'),
          sessionId,
          source: 'claude',
          role: (entry.message.role as 'user' | 'assistant' | 'system') || 'user',
          type: 'text',
          content,
          timestamp,
          parentMessageId: entry.parentUuid || undefined,
        });
      }
    }

    // 处理工具使用
    if (entry.type === 'tool_use' || entry.tool_name) {
      messages.push({
        id: this.generateId('claude'),
        sessionId,
        source: 'claude',
        role: 'assistant',
        type: 'tool_use',
        content: '',
        timestamp,
        toolUse: {
          id: entry.tool_use_id || this.generateId('tool'),
          name: entry.tool_name || '',
          input: entry.tool_input || {},
        },
        parentMessageId: entry.parentUuid || undefined,
      });
    }

    // 处理工具结果
    if (entry.type === 'tool_result' || entry.tool_result !== undefined) {
      messages.push({
        id: this.generateId('claude'),
        sessionId,
        source: 'claude',
        role: 'user',
        type: 'tool_result',
        content: '',
        timestamp,
        toolResult: {
          toolUseId: entry.tool_use_id || '',
          content: entry.tool_result,
          isError: entry.isApiErrorMessage,
        },
        parentMessageId: entry.parentUuid || undefined,
      });
    }

    return messages;
  }

  // ============================================
  // 私有方法
  // ============================================

  /**
   * 解析会话文件
   */
  private async parseSessionFile(
    filePath: string,
    sessionId: string
  ): Promise<{ messageCount: number; summary: string; model?: string; cwd?: string } | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      
      let messageCount = 0;
      let summary = '';
      let model: string | undefined;
      let cwd: string | undefined;
      let lastUserMessage = '';

      for (const line of lines) {
        try {
          const entry: ClaudeCodeJSONLEntry = JSON.parse(line);
          messageCount++;

          // 提取 cwd
          if (entry.cwd && !cwd) {
            cwd = entry.cwd;
          }

          // 提取 model
          if (entry.model && !model) {
            model = entry.model;
          }

          // 提取摘要
          if (entry.type === 'summary' && entry.message?.content) {
            summary = typeof entry.message.content === 'string'
              ? entry.message.content
              : JSON.stringify(entry.message.content);
          }

          // 提取最后用户消息
          if (entry.message?.role === 'user' && entry.message?.content) {
            const text = this.extractTextFromContent(entry.message.content);
            if (!this.isSystemMessage(text)) {
              lastUserMessage = text;
            }
          }
        } catch {
          // 跳过解析错误
        }
      }

      // 如果没有摘要，使用最后的用户消息
      if (!summary && lastUserMessage) {
        summary = this.truncateText(lastUserMessage, 100);
      }

      return { messageCount, summary: summary || 'New Session', model, cwd };
    } catch (error) {
      console.error('[ClaudeProvider] 解析会话文件失败:', error);
      return null;
    }
  }

  /**
   * 解析消息列表
   */
  private async parseMessages(filePath: string, sessionId: string): Promise<NormalizedMessage[]> {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    const messages: NormalizedMessage[] = [];

    for (const line of lines) {
      try {
        const entry: ClaudeCodeJSONLEntry = JSON.parse(line);
        const normalized = this.normalizeMessage(entry, sessionId);
        messages.push(...normalized);
      } catch {
        // 跳过解析错误
      }
    }

    // 按时间戳排序
    messages.sort((a, b) => a.timestamp - b.timestamp);

    return messages;
  }

  /**
   * 从编码的目录名提取实际路径
   */
  private async extractProjectDirectory(projectName: string): Promise<string> {
    if (this.projectDirectoryCache.has(projectName)) {
      return this.projectDirectoryCache.get(projectName)!;
    }

    // 尝试从配置文件读取
    try {
      const configContent = await fs.readFile(this.projectConfigPath, 'utf8');
      const config = JSON.parse(configContent);
      
      if (config[projectName]?.originalPath) {
        this.projectDirectoryCache.set(projectName, config[projectName].originalPath);
        return config[projectName].originalPath;
      }
    } catch {
      // 配置文件不存在
    }

    // 从目录名解码
    const decoded = projectName.replace(/-/g, '/');
    this.projectDirectoryCache.set(projectName, decoded);
    return decoded;
  }

  /**
   * 从内容中提取文本
   */
  private extractTextFromContent(content: unknown): string {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .filter((part: unknown) => typeof part === 'object' && part !== null && (part as Record<string, unknown>).type === 'text')
        .map((part: unknown) => ((part as Record<string, unknown>).text as string) || '')
        .join(' ');
    }

    return '';
  }

  /**
   * 判断是否为系统消息
   */
  private isSystemMessage(text: string): boolean {
    const systemPatterns = [
      '<command-name>',
      '<command-message>',
      '<command-args>',
      '<local-command-stdout>',
      '<system-reminder>',
      'Caveat:',
      'This session is being continued from a previous',
      'Invalid API key',
      '{"subtasks":',
      'CRITICAL: You MUST respond with ONLY a JSON',
      'Warmup',
    ];

    return systemPatterns.some(pattern => text.startsWith(pattern));
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
