/**
 * 会话管理服务
 *
 * 参考 ClaudeCodeUI 的实现，提供以下功能：
 * 1. 会话发现和列表
 * 2. 消息存储和检索（支持分页）
 * 3. 会话恢复
 * 4. 消息关系追踪（uuid, parentUuid）
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import crypto from 'crypto';

// ============================================
// 类型定义
// ============================================

export interface SessionMessage {
  id: string;
  sessionId: string;
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'summary';
  message?: {
    role: 'user' | 'assistant' | 'system';
    content: string | Array<any>;
  };
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_result?: unknown;
  tool_use_id?: string;
  isApiErrorMessage?: boolean;
  timestamp: string;
  uuid?: string;
  parentUuid?: string | null;
  cwd?: string;
}

export interface Session {
  id: string;
  summary: string;
  messageCount: number;
  lastActivity: string;
  cwd?: string;
  model?: string;
}

export interface SessionListResult {
  sessions: Session[];
  hasMore: boolean;
  total: number;
  offset: number;
  limit: number;
}

export interface SessionMessagesResult {
  messages: SessionMessage[];
  total: number;
  hasMore: boolean;
  offset: number;
  limit: number;
}

// ============================================
// 常量
// ============================================

const SESSIONS_DIR = path.join(os.homedir(), '.claude', 'projects');
const MAX_SESSIONS_PER_PROJECT = 100;

// ============================================
// 工具函数
// ============================================

/**
 * 生成会话 ID
 */
function generateSessionId(): string {
  return crypto.randomUUID();
}

/**
 * 生成消息 UUID
 */
function generateMessageUuid(): string {
  return crypto.randomUUID();
}

/**
 * 判断是否为系统消息（应该被过滤）
 */
function isSystemMessage(textContent: string): boolean {
  if (typeof textContent !== 'string') {
    return false;
  }

  const systemPatterns = [
    '<command-name>',
    '<command-message>',
    '<command-args>',
    '<local-command-stdout>',
    '<system-reminder>',
    'Caveat:',
    'This session is being continued from a previous',
    'Invalid API key',
    '{"subtasks":', // Task Master prompts
    'CRITICAL: You MUST respond with ONLY a JSON', // Task Master system prompts
    'Warmup', // Explicit warmup message
  ];

  return systemPatterns.some(pattern => textContent.startsWith(pattern));
}

/**
 * 从内容数组中提取文本
 */
function extractTextFromContent(content: any): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((part: any) => part.type === 'text')
      .map((part: any) => part.text || '')
      .join(' ');
  }

  return '';
}

/**
 * 截断文本生成摘要
 */
function truncateText(text: string, maxLength = 50): string {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + '...';
}

// ============================================
// 会话管理类
// ============================================

export class SessionManager {
  private projectPath: string;
  private messageCache: Map<string, SessionMessage[]> = new Map();
  private cacheMaxSize = 1000;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  /**
   * 获取项目目录名称（路径编码）
   */
  private getProjectDirName(): string {
    return this.projectPath.replace(/[\\/:\s~_]/g, '-');
  }

  /**
   * 获取项目会话目录
   */
  private getProjectSessionDir(): string {
    const projectName = this.getProjectDirName();
    return path.join(SESSIONS_DIR, projectName);
  }

  /**
   * 获取会话文件路径
   */
  private getSessionFilePath(sessionId: string): string {
    const projectDir = this.getProjectSessionDir();
    return path.join(projectDir, `${sessionId}.jsonl`);
  }

  /**
   * 创建新会话
   */
  async createSession(options?: {
    cwd?: string;
    model?: string;
  }): Promise<Session> {
    const sessionId = generateSessionId();
    const sessionDir = this.getProjectSessionDir();

    // 确保项目目录存在
    await fs.mkdir(sessionDir, { recursive: true });

    // 创建会话文件
    const sessionFilePath = this.getSessionFilePath(sessionId);
    await fs.writeFile(sessionFilePath, '', 'utf8');

    const session: Session = {
      id: sessionId,
      summary: 'New Session',
      messageCount: 0,
      lastActivity: new Date().toISOString(),
      cwd: options?.cwd || this.projectPath,
      model: options?.model,
    };

    return session;
  }

  /**
   * 添加消息到会话
   */
  async addMessage(
    sessionId: string,
    message: Omit<SessionMessage, 'id' | 'sessionId' | 'timestamp'>
  ): Promise<SessionMessage> {
    const sessionMessage: SessionMessage = {
      id: generateMessageUuid(),
      sessionId,
      timestamp: new Date().toISOString(),
      ...message,
    };

    // 追加到会话文件
    const sessionFilePath = this.getSessionFilePath(sessionId);
    const line = JSON.stringify(sessionMessage) + '\n';
    await fs.appendFile(sessionFilePath, line, 'utf8');

    // 更新缓存
    if (!this.messageCache.has(sessionId)) {
      this.messageCache.set(sessionId, []);
    }
    const messages = this.messageCache.get(sessionId)!;
    messages.push(sessionMessage);

    // 限制缓存大小
    if (messages.length > this.cacheMaxSize) {
      messages.shift();
    }

    return sessionMessage;
  }

  /**
   * 获取会话列表
   */
  async getSessions(limit = 10, offset = 0): Promise<SessionListResult> {
    const projectDir = this.getProjectSessionDir();

    try {
      // 检查项目目录是否存在
      await fs.access(projectDir);
    } catch (error) {
      // 项目目录不存在，返回空列表
      return {
        sessions: [],
        hasMore: false,
        total: 0,
        offset,
        limit,
      };
    }

    try {
      const files = await fs.readdir(projectDir);
      const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));

      if (jsonlFiles.length === 0) {
        return {
          sessions: [],
          hasMore: false,
          total: 0,
          offset,
          limit,
        };
      }

      // 获取文件修改时间并排序
      const filesWithStats = await Promise.all(
        jsonlFiles.map(async (file) => {
          const filePath = path.join(projectDir, file);
          const stats = await fs.stat(filePath);
          return { file, mtime: stats.mtime };
        })
      );
      filesWithStats.sort((a, b) => b.mtime - a.mtime);

      // 解析所有会话
      const allSessions: Session[] = [];
      const sessionSummaries = new Map<string, string>();
      const pendingSummaries = new Map<string, string>();
      const sessionMessageCounts = new Map<string, number>();
      const sessionLastActivities = new Map<string, string>();

      for (const { file } of filesWithStats) {
        const sessionId = file.replace('.jsonl', '');
        const filePath = path.join(projectDir, file);

        try {
          const fileStream = await fs.open(filePath, 'r');
          const rl = readline.createInterface({
            input: fileStream.createReadStream(),
            crlfDelay: Infinity,
          });

          for await (const line of rl) {
            if (!line.trim()) continue;

            try {
              const entry: SessionMessage = JSON.parse(line);

              // 记录消息数量
              const count = sessionMessageCounts.get(sessionId) || 0;
              sessionMessageCounts.set(sessionId, count + 1);

              // 记录最后活动时间
              const lastActivity = sessionLastActivities.get(sessionId) || '';
              if (entry.timestamp > lastActivity) {
                sessionLastActivities.set(sessionId, entry.timestamp);
              }

              // 处理摘要
              if (entry.type === 'summary' && entry.message?.content) {
                const summary = typeof entry.message.content === 'string'
                  ? entry.message.content
                  : JSON.stringify(entry.message.content);
                sessionSummaries.set(sessionId, summary);
              }

              // 处理待定摘要（没有 sessionId 的情况）
              if (entry.type === 'summary' && !entry.sessionId && entry.uuid) {
                const summary = typeof entry.message?.content === 'string'
                  ? entry.message.content
                  : JSON.stringify(entry.message?.content);
                pendingSummaries.set(entry.uuid, summary);
              }

              // 应用待定摘要
              if (entry.parentUuid && pendingSummaries.has(entry.parentUuid)) {
                const pending = pendingSummaries.get(entry.parentUuid);
                if (pending && !sessionSummaries.has(sessionId)) {
                  sessionSummaries.set(sessionId, pending);
                }
              }

              // 提取最后用户消息作为摘要（如果没有摘要）
              if (entry.message?.role === 'user' && entry.message?.content) {
                const textContent = extractTextFromContent(entry.message.content);
                if (!isSystemMessage(textContent) && !sessionSummaries.has(sessionId)) {
                  sessionSummaries.set(sessionId, truncateText(textContent));
                }
              }
            } catch (parseError) {
              // 跳过格式错误的行
            }
          }

          await fileStream.close();
        } catch (error) {
          console.error(`Error reading session file ${file}:`, error);
        }
      }

      // 构建会话列表
      for (const [sessionId, count] of sessionMessageCounts.entries()) {
        const summary = sessionSummaries.get(sessionId) || 'New Session';
        const lastActivity = sessionLastActivities.get(sessionId) || new Date().toISOString();

        allSessions.push({
          id: sessionId,
          summary,
          messageCount: count,
          lastActivity,
        });
      }

      // 按最后活动时间排序
      allSessions.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());

      const total = allSessions.length;
      const paginatedSessions = allSessions.slice(offset, offset + limit);
      const hasMore = offset + limit < total;

      return {
        sessions: paginatedSessions,
        hasMore,
        total,
        offset,
        limit,
      };
    } catch (error) {
      console.error('Error getting sessions:', error);
      return {
        sessions: [],
        hasMore: false,
        total: 0,
        offset,
        limit,
      };
    }
  }

  /**
   * 获取会话消息
   */
  async getSessionMessages(
    sessionId: string,
    limit: number | null = null,
    offset = 0
  ): Promise<SessionMessagesResult> {
    const sessionFilePath = this.getSessionFilePath(sessionId);

    try {
      await fs.access(sessionFilePath);
    } catch (error) {
      return {
        messages: [],
        total: 0,
        hasMore: false,
        offset,
        limit: limit || 0,
      };
    }

    try {
      const fileStream = await fs.open(sessionFilePath, 'r');
      const rl = readline.createInterface({
        input: fileStream.createReadStream(),
        crlfDelay: Infinity,
      });

      const messages: SessionMessage[] = [];

      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const entry: SessionMessage = JSON.parse(line);
          if (entry.sessionId === sessionId) {
            messages.push(entry);
          }
        } catch (parseError) {
          // 跳过格式错误的行
        }
      }

      await fileStream.close();

      // 按时间戳排序
      messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      const total = messages.length;

      // 如果没有指定 limit，返回所有消息
      if (limit === null) {
        return {
          messages,
          total,
          hasMore: false,
          offset: 0,
          limit: total,
        };
      }

      // 应用分页
      const startIndex = Math.max(0, total - offset - limit);
      const endIndex = total - offset;
      const paginatedMessages = messages.slice(startIndex, endIndex);
      const hasMore = startIndex > 0;

      return {
        messages: paginatedMessages,
        total,
        hasMore,
        offset,
        limit,
      };
    } catch (error) {
      console.error('Error getting session messages:', error);
      return {
        messages: [],
        total: 0,
        hasMore: false,
        offset,
        limit: limit || 0,
      };
    }
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const sessionFilePath = this.getSessionFilePath(sessionId);

    try {
      await fs.unlink(sessionFilePath);

      // 清除缓存
      this.messageCache.delete.delete(sessionId);

      return true;
    } catch (error) {
      console.error('Error deleting session:', error);
      return false;
    }
  }

  /**
   * 续订会话
   * 从历史会话加载上下文，创建新的会话并标记续订来源
   */
  async resumeSession(
    sessionId: string,
    options?: {
      maxContextMessages?: number;  // 加载多少条历史消息作为上下文
      cwd?: string;
      model?: string;
    }
  ): Promise<{
    newSession: Session;
    contextMessages: SessionMessage[];
    originalSessionId: string;
  }> {
    const maxContext = options?.maxContextMessages || 10;

    // 1. 加载原会话的所有消息
    const messagesResult = await this.getSessionMessages(sessionId, null, 0);
    if (messagesResult.messages.length === 0) {
      throw new Error('原会话没有消息，无法续订');
    }

    // 2. 取最后 N 条消息作为上下文
    const contextMessages = messagesResult.messages.slice(-maxContext);

    // 3. 创建新会话
    const newSessionId = generateSessionId();
    const sessionDir = this.getProjectSessionDir();
    await fs.mkdir(sessionDir, { recursive: true });

    const newSessionFilePath = this.getSessionFilePath(newSessionId);

    // 4. 写入续订标记消息
    const resumeMessage: SessionMessage = {
      id: generateMessageUuid(),
      sessionId: newSessionId,
      type: 'summary',
      message: {
        role: 'system',
        content: `This session is being continued from a previous conversation.\nOriginal session ID: ${sessionId}\nLoaded ${contextMessages.length} messages as context.`,
      },
      timestamp: new Date().toISOString(),
      parentUuid: contextMessages[contextMessages.length - 1]?.uuid || null,
    };

    await fs.writeFile(newSessionFilePath, JSON.stringify(resumeMessage) + '\n', 'utf8');

    // 5. 构建新 Session 对象
    const newSession: Session = {
      id: newSessionId,
      summary: `Continued from: ${messagesResult.messages[0]?.message?.content ? (typeof messagesResult.messages[0].message.content === 'string' ? messagesResult.messages[0].message.content.substring(0, 50) : '...') : 'Previous session'}`,
      messageCount: 0,
      lastActivity: new Date().toISOString(),
      cwd: options?.cwd || this.projectPath,
      model: options?.model,
    };

    return {
      newSession,
      contextMessages,
      originalSessionId: sessionId,
    };
  }

  /**
   * 搜索会话中的消息
   */
  async searchMessages(
    query: string,
    limit = 50
  ): Promise<{ sessionId: string; matches: Array<{ role: string; snippet: string; timestamp: string }> }[]> {
    const projectDir = this.getProjectSessionDir();
    const safeQuery = query.trim().toLowerCase();
    const words = safeQuery.split(/\s+/).filter(w => w.length > 0);

    if (words.length === 0) {
      return [];
    }

    try {
      await fs.access(projectDir);
    } catch (error) {
      return [];
    }

    try {
      const files = await fs.readdir(projectDir);
      const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));

      const results: Map<string, Array<{ role: string; snippet: string; timestamp: string }>> = new Map();

      for (const file of jsonlFiles) {
        const sessionId = file.replace('.jsonl', '');
        const filePath = path.join(projectDir, file);

        try {
          const fileStream = await fs.open(filePath, 'r');
          const rl = readline.createInterface({
            input: fileStream.createReadStream(),
            crlfDelay: Infinity,
          });

          const sessionMatches: Array<{ role: string; snippet: string; timestamp: string }> = [];

          for await (const line of rl) {
            if (!line.trim()) continue;

            try {
              const entry: SessionMessage = JSON.parse(line);

              if (entry.message?.content) {
                const textContent = extractTextFromContent(entry.message.content);
                const textLower = textContent.toLowerCase();

                // 检查是否匹配所有单词
                const allWordsMatch = words.every(word => textLower.includes(word));

                if (allWordsMatch && !isSystemMessage(textContent)) {
                  const role = entry.message.role || 'unknown';
                  const timestamp = entry.timestamp;

                  // 构建摘要（高亮匹配词）
                  const snippet = textContent.length > 150
                    ? textContent.substring(0, 150) + '...'
                    : textContent;

                  if (sessionMatches.length < 2) {
                    sessionMatches.push({ role, snippet, timestamp });
                  }
                }
              }
            } catch (parseError) {
              // 跳过格式错误的行
            }
          }

          await fileStream.close();

          if (sessionMatches.length > 0) {
            results.set(sessionId, sessionMatches);
          }
        } catch (error) {
          console.error(`Error searching session file ${file}:`, error);
        }
      }

      return Array.from(results.entries()).map(([sessionId, matches]) => ({
        sessionId,
        matches,
      }));
    } catch (error) {
      console.error('Error searching messages:', error);
      return [];
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.messageCache.clear();
  }
}

// ============================================
// 项目发现服务
// ============================================

export class ProjectDiscovery {
  private claudeProjectsDir: string;
  private projectConfigPath: string;
  private projectDirectoryCache: Map<string, string> = new Map();

  constructor() {
    this.claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
    this.projectConfigPath = path.join(os.homedir(), '.claude', 'project-config.json');
  }

  /**
   * 加载项目配置
   */
  private async loadProjectConfig(): Promise<Record<string, any>> {
    try {
      const configContent = await fs.readFile(this.projectConfigPath, 'utf8');
      return JSON.parse(configContent);
    } catch (error) {
      return {};
    }
  }

  /**
   * 保存项目配置
   */
  private async saveProjectConfig(config: Record<string, any>): Promise<void> {
    await fs.mkdir(path.dirname(this.projectConfigPath), { recursive: true });
    await fs.writeFile(this.projectConfigPath, JSON.stringify(config, null, 2), 'utf8');
  }

  /**
   * 从 JSONL 文件提取项目目录
   */
  private async extractProjectDirectory(projectName: string): Promise<string> {
    // 检查缓存
    if (this.projectDirectoryCache.has(projectName)) {
      return this.projectDirectoryCache.get(projectName)!;
    }

    // 检查项目配置中的 originalPath
    const config = await this.loadProjectConfig();
    if (config[projectName]?.originalPath) {
      const originalPath = config[projectName].originalPath;
      this.projectDirectoryCache.set(projectName, originalPath);
      return originalPath;
    }

    const projectDir = path.join(this.claudeProjectsDir, projectName);
    const cwdCounts = new Map<string, number>();
    let latestTimestamp = 0;
    let latestCwd = '';

    try {
      await fs.access(projectDir);

      const files = await fs.readdir(projectDir);
      const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));

      if (jsonlFiles.length === 0) {
        // 没有会话文件，使用解码后的项目名
        const fallbackPath = projectName.replace(/-/g, '/');
        this.projectDirectoryCache.set(projectName, fallbackPath);
        return fallbackPath;
      }

      // 解析 JSONL 文件提取 cwd
      for (const file of jsonlFiles) {
        const filePath = path.join(projectDir, file);
        const fileStream = await fs.open(filePath, 'r');
        const rl = readline.createInterface({
          input: fileStream.createReadStream(),
          crlfDelay: Infinity,
        });

        for await (const line of rl) {
          if (!line.trim()) continue;

          try {
            const entry = JSON.parse(line);
            if (entry.cwd) {
              const count = cwdCounts.get(entry.cwd) || 0;
              cwdCounts.set(entry.cwd, count + 1);

              const timestamp = new Date(entry.timestamp || 0).getTime();
              if (timestamp > latestTimestamp) {
                latestTimestamp = timestamp;
                latestCwd = entry.cwd;
              }
            }
          } catch (parseError) {
            // 跳过格式错误的行
          }
        }

        await fileStream.close();
      }

      // 确定最佳 cwd
      let extractedPath = '';

      if (cwdCounts.size === 0) {
        extractedPath = projectName.replace(/-/g, '/');
      } else if (cwdCounts.size === 1) {
        extractedPath = Array.from(cwdCounts.keys())[0];
      } else {
        // 多个 cwd，使用最频繁的或最近的
        const maxCount = Math.max(...cwdCounts.values());
        const mostFrequentCwd = Array.from(cwdCounts.entries()).find(([_, count]) => count === maxCount)?.[0];

        if (mostFrequentCwd) {
          extractedPath = mostFrequentCwd;
        } else {
          extractedPath = latestCwd || projectName.replace(/-/g, '/');
        }
      }

      this.projectDirectoryCache.set(projectName, extractedPath);
      return extractedPath;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        const fallbackPath = projectName.replace(/-/g, '/');
        this.projectDirectoryCache.set(projectName, fallbackPath);
        return fallbackPath;
      }
      console.error(`Error extracting project directory for ${projectName}:`, error);
      return projectName.replace(/-/g, '/');
    }
  }

  /**
   * 生成显示名称
   */
  private async generateDisplayName(projectName: string, actualProjectDir?: string): Promise<string> {
    const projectPath = actualProjectDir || await this.extractProjectDirectory(projectName);

    // 尝试读取 package.json
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const packageContent = await fs.readFile(packageJsonPath, 'utf8');
      const packageJson = JSON.parse(packageContent);

      if (packageJson.name) {
        return packageJson.name;
      }
    } catch (error) {
      // 使用路径作为显示名称
    }

    // 从路径中提取最后部分
    const parts = projectPath.split(path.sep).filter(Boolean);
    return parts[parts.length - 1] || projectName;
  }

  /**
   * 扫描 Cursor 会话目录
   * Cursor 会话通常存储在 ~/.cursor 目录下
   */
  private async getCursorSessions(): Promise<Session[]> {
    const cursorDir = path.join(os.homedir(), '.cursor');
    const sessions: Session[] = [];

    try {
      await fs.access(cursorDir);
    } catch {
      // Cursor 目录不存在，返回空数组
      return sessions;
    }

    try {
      // Cursor 可能将会话存储在多个位置，检查常见的会话目录结构
      const possibleSessionDirs = [
        path.join(cursorDir, 'sessions'),
        path.join(cursorDir, 'conversations'),
        path.join(cursorDir, 'history'),
      ];

      for (const sessionDir of possibleSessionDirs) {
        try {
          const entries = await fs.readdir(sessionDir, { withFileTypes: true });

          for (const entry of entries) {
            if (entry.isFile() && (entry.name.endsWith('.jsonl') || entry.name.endsWith('.json'))) {
              const filePath = path.join(sessionDir, entry.name);
              const stat = await fs.stat(filePath);

              try {
                const fileStream = await fs.open(filePath, 'r');
                const rl = readline.createInterface({
                  input: fileStream.createReadStream(),
                  crlfDelay: Infinity,
                });

                let messageCount = 0;
                let lastTimestamp = '';
                let summary = '';
                const sessionId = entry.name.replace(/\.(jsonl|json)$/, '');

                for await (const line of rl) {
                  if (!line.trim()) continue;

                  try {
                    const entry: { timestamp?: string; message?: { content?: string | Array<any> }; summary?: string } = JSON.parse(line);
                    messageCount++;

                    if (entry.timestamp) {
                      lastTimestamp = entry.timestamp;
                    }

                    // 提取摘要（第一行用户消息）
                    if (!summary && entry.message?.content) {
                      const content = typeof entry.message.content === 'string'
                        ? entry.message.content
                        : Array.isArray(entry.message.content)
                          ? entry.message.content.find(c => typeof c === 'string' || c?.type === 'text')?.text || ''
                          : '';
                      if (content && content.length > 0) {
                        summary = content.length > 100 ? content.substring(0, 100) + '...' : content;
                      }
                    }
                  } catch {
                    // 跳过格式错误的行
                  }
                }

                await fileStream.close();

                if (messageCount > 0) {
                  sessions.push({
                    id: `cursor-${sessionId}`,
                    summary: summary || `Cursor 会话 (${sessionId.substring(0, 8)})`,
                    messageCount,
                    lastActivity: lastTimestamp || stat.mtime.toISOString(),
                  });
                }
              } catch {
                // 跳过无法读取的文件
              }
            }
          }
        } catch {
          // 目录不存在或无法访问，继续下一个
        }
      }

      // 按最后活动时间排序
      sessions.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());

    } catch (error) {
      console.error('Error scanning Cursor sessions:', error);
    }

    return sessions;
  }

  /**
   * 扫描 Codex (OpenAI) 会话目录
   * OpenAI Codex CLI 可能将会话存储在 ~/.codex 或类似目录
   */
  private async getCodexSessions(): Promise<Session[]> {
    const codexDir = path.join(os.homedir(), '.codex');
    const sessions: Session[] = [];

    try {
      await fs.access(codexDir);
    } catch {
      // Codex 目录不存在，返回空数组
      return sessions;
    }

    try {
      const entries = await fs.readdir(codexDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && (entry.name.endsWith('.jsonl') || entry.name.endsWith('.json'))) {
          const filePath = path.join(codexDir, entry.name);
          const stat = await fs.stat(filePath);

          try {
            const fileStream = await fs.open(filePath, 'r');
            const rl = readline.createInterface({
              input: fileStream.createReadStream(),
              crlfDelay: Infinity,
            });

            let messageCount = 0;
            let lastTimestamp = '';
            let summary = '';
            const sessionId = entry.name.replace(/\.(jsonl|json)$/, '');

            for await (const line of rl) {
              if (!line.trim()) continue;

              try {
                const entry: { timestamp?: string; message?: { content?: string | Array<any> }; summary?: string } = JSON.parse(line);
                messageCount++;

                if (entry.timestamp) {
                  lastTimestamp = entry.timestamp;
                }

                if (!summary && entry.message?.content) {
                  const content = typeof entry.message.content === 'string'
                    ? entry.message.content
                    : Array.isArray(entry.message.content)
                      ? entry.message.content.find(c => typeof c === 'string' || c?.type === 'text')?.text || ''
                      : '';
                  if (content && content.length > 0) {
                    summary = content.length > 100 ? content.substring(0, 100) + '...' : content;
                  }
                }
              } catch {
                // 跳过格式错误的行
              }
            }

            await fileStream.close();

            if (messageCount > 0) {
              sessions.push({
                id: `codex-${sessionId}`,
                summary: summary || `Codex 会话 (${sessionId.substring(0, 8)})`,
                messageCount,
                lastActivity: lastTimestamp || stat.mtime.toISOString(),
              });
            }
          } catch {
            // 跳过无法读取的文件
          }
        }
      }

      // 按最后活动时间排序
      sessions.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());

    } catch (error) {
      console.error('Error scanning Codex sessions:', error);
    }

    return sessions;
  }

  /**
   * 扫描 Gemini CLI 会话目录
   * Gemini CLI 会话通常存储在 ~/.gemini/sessions 目录
   */
  private async getGeminiCliSessions(): Promise<Session[]> {
    const geminiDir = path.join(os.homedir(), '.gemini', 'sessions');
    const sessions: Session[] = [];

    try {
      await fs.access(geminiDir);
    } catch {
      // Gemini CLI 目录不存在，返回空数组
      return sessions;
    }

    try {
      const entries = await fs.readdir(geminiDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && (entry.name.endsWith('.jsonl') || entry.name.endsWith('.json'))) {
          const filePath = path.join(geminiDir, entry.name);
          const stat = await fs.stat(filePath);

          try {
            const fileStream = await fs.open(filePath, 'r');
            const rl = readline.createInterface({
              input: fileStream.createReadStream(),
              crlfDelay: Infinity,
            });

            let messageCount = 0;
            let lastTimestamp = '';
            let summary = '';
            const sessionId = entry.name.replace(/\.(jsonl|json)$/, '');

            for await (const line of rl) {
              if (!line.trim()) continue;

              try {
                const entry: { timestamp?: string; message?: { content?: string | Array<any> }; summary?: string } = JSON.parse(line);
                messageCount++;

                if (entry.timestamp) {
                  lastTimestamp = entry.timestamp;
                }

                if (!summary && entry.message?.content) {
                  const content = typeof entry.message.content === 'string'
                    ? entry.message.content
                    : Array.isArray(entry.message.content)
                      ? entry.message.content.find(c => typeof c === 'string' || c?.type === 'text')?.text || ''
                      : '';
                  if (content && content.length > 0) {
                    summary = content.length > 100 ? content.substring(0, 100) + '...' : content;
                  }
                }
              } catch {
                // 跳过格式错误的行
              }
            }

            await fileStream.close();

            if (messageCount > 0) {
              sessions.push({
                id: `gemini-${sessionId}`,
                summary: summary || `Gemini 会话 (${sessionId.substring(0, 8)})`,
                messageCount,
                lastActivity: lastTimestamp || stat.mtime.toISOString(),
              });
            }
          } catch {
            // 跳过无法读取的文件
          }
        }
      }

      // 按最后活动时间排序
      sessions.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());

    } catch (error) {
      console.error('Error scanning Gemini CLI sessions:', error);
    }

    return sessions;
  }

  /**
   * 发现所有项目
   */
  async discoverProjects(): Promise<Array<{
    name: string;
    path: string;
    displayName: string;
    sessions: Session[];
    cursorSessions: Session[];
    codexSessions: Session[];
    geminiSessions: Session[];
  }>> {
    // 并行获取多源会话
    const [cursorSessions, codexSessions, geminiSessions] = await Promise.all([
      this.getCursorSessions(),
      this.getCodexSessions(),
      this.getGeminiCliSessions(),
    ]);

    try {
      await fs.access(this.claudeProjectsDir);
    } catch (error) {
      // Claude 项目目录不存在，但仍返回多源会话
      return [{
        name: 'multi-source-sessions',
        path: '',
        displayName: '多源会话',
        sessions: [],
        cursorSessions,
        codexSessions,
        geminiSessions,
      }];
    }

    try {
      const entries = await fs.readdir(this.claudeProjectsDir, { withFileTypes: true });
      const directories = entries.filter(e => e.isDirectory());

      const config = await this.loadProjectConfig();
      const projects = [];

      for (const entry of directories) {
        const projectName = entry.name;
        const actualProjectDir = await this.extractProjectDirectory(projectName);
        const customName = config[projectName]?.displayName;
        const displayName = customName || await this.generateDisplayName(projectName, actualProjectDir);

        // 获取会话列表
        const sessionManager = new SessionManager(actualProjectDir);
        const sessionsResult = await sessionManager.getSessions(5, 0);

        projects.push({
          name: projectName,
          path: actualProjectDir,
          displayName,
          sessions: sessionsResult.sessions,
          cursorSessions,
          codexSessions,
          geminiSessions,
        });
      }

      return projects;
    } catch (error) {
      console.error('Error discovering projects:', error);
      // 发生错误时，仍返回多源会话
      return [{
        name: 'multi-source-sessions',
        path: '',
        displayName: '多源会话',
        sessions: [],
        cursorSessions,
        codexSessions,
        geminiSessions,
      }];
    }
  }

  /**
   * 手动添加项目
   */
  async addProjectManually(
    projectPath: string,
    options?: {
      displayName?: string;
    }
  ): Promise<{
    name: string;
    path: string;
    displayName: string;
  }> {
    const absolutePath = path.resolve(projectPath);

    // 检查路径是否存在
    try {
      await fs.access(absolutePath);
    } catch (error) {
      throw new Error(`Path does not exist: ${absolutePath}`);
    }

    // 生成项目名称
    const projectName = absolutePath.replace(/[\\/:\s~_]/g, '-');

    // 加载现有配置
    const config = await this.loadProjectConfig();

    // 检查是否已存在
    if (config[projectName]) {
      throw new Error(`Project already configured for path: ${absolutePath}`);
    }

    // 添加到配置
    config[projectName] = {
      manuallyAdded: true,
      originalPath: absolutePath,
    };

    if (options?.displayName) {
      config[projectName].displayName = options.displayName;
    }

    await this.saveProjectConfig(config);

    return {
      name: projectName,
      path: absolutePath,
      displayName: options?.displayName || await this.generateDisplayName(projectName, absolutePath),
    };
  }

  /**
   * 重命名项目
   */
  async renameProject(projectName: string, newDisplayName: string): Promise<boolean> {
    const config = await this.loadProjectConfig();

    if (!newDisplayName || newDisplayName.trim() === '') {
      // 删除自定义名称
      if (config[projectName]) {
        delete config[projectName].displayName;
      }
    } else {
      // 设置自定义名称
      config[projectName] = {
        ...config[projectName],
        displayName: newDisplayName.trim(),
      };
    }

    await this.saveProjectConfig(config);
    return true;
  }

  /**
   * 删除项目
   */
  async deleteProject(projectName: string): Promise<boolean> {
    const projectDir = path.join(this.claudeProjectsDir, projectName);

    try {
      // 删除项目目录
      await fs.rm(projectDir, { recursive: true, force: true });

      // 从配置中移除
      const config = await this.loadProjectConfig();
      delete config[projectName];
      await this.saveProjectConfig(config);

      // 清除缓存
      this.projectDirectoryCache.delete(projectName);

      return true;
    } catch (error) {
      console.error(`Error deleting project ${projectName}:`, error);
      return false;
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.projectDirectoryCache.clear();
  }
}

// ============================================
// 导出
// ============================================

export {
  SessionManager,
  ProjectDiscovery,
  type SessionMessage,
  type Session,
  type SessionListResult,
  type SessionMessagesResult,
};
