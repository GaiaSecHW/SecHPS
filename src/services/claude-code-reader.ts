/**
 * Claude Code 本地数据读取服务
 * 
 * 从 ~/.claude/projects 目录读取项目、会话和消息数据
 * 
 * 核心功能:
 * 1. discoverProjects() - 发现所有项目
 * 2. getSessions(projectPath) - 获取项目的会话列表
 * 3. getMessages(sessionId) - 获取会话消息
 * 4. extractProjectDirectory(projectName) - 提取项目目录路径
 * 5. generateDisplayName(projectPath) - 生成显示名称
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import type {
  ClaudeCodeProject,
  ClaudeCodeSession,
  ClaudeCodeSessionListResult,
  ClaudeCodeMessage,
  ClaudeCodeMessageListResult,
  ClaudeCodeJSONLEntry,
  ClaudeCodeConfigFile,
  ClaudeCodeReaderOptions,
} from '@/types/claude-code';

// ============================================
// 常量
// ============================================

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const PROJECT_CONFIG_PATH = path.join(os.homedir(), '.claude', 'project-config.json');
const DEFAULT_CACHE_MAX_SIZE = 1000;
const DEFAULT_MAX_SESSIONS_PER_PROJECT = 100;

// ============================================
// 工具函数
// ============================================

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
    '{"subtasks":',
    'CRITICAL: You MUST respond with ONLY a JSON',
    'Warmup',
  ];

  return systemPatterns.some(pattern => textContent.startsWith(pattern));
}

/**
 * 从内容数组中提取文本
 */
function extractTextFromContent(content: unknown): string {
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
function truncateText(text: string, maxLength = 100): string {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + '...';
}

/**
 * 解析 JSONL 文件条目
 */
async function* parseJSONLFile(filePath: string): AsyncGenerator<ClaudeCodeJSONLEntry> {
  const fileStream = await fs.open(filePath, 'r');
  const rl = readline.createInterface({
    input: fileStream.createReadStream(),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const entry: ClaudeCodeJSONLEntry = JSON.parse(line);
      yield entry;
    } catch (parseError) {
      // 跳过格式错误的行
    }
  }

  await fileStream.close();
}

// ============================================
// ClaudeCodeReader 类
// ============================================

export class ClaudeCodeReader {
  private cacheMaxSize: number;
  private maxSessionsPerProject: number;
  private projectDirectoryCache: Map<string, string> = new Map();

  constructor(options?: ClaudeCodeReaderOptions) {
    this.cacheMaxSize = options?.cacheMaxSize || DEFAULT_CACHE_MAX_SIZE;
    this.maxSessionsPerProject = options?.maxSessionsPerProject || DEFAULT_MAX_SESSIONS_PER_PROJECT;
  }

  // ============================================
  // 项目发现
  // ============================================

  /**
   * 发现所有项目
   * 扫描 ~/.claude/projects/ 目录，每个子目录是一个项目
   */
  async discoverProjects(): Promise<ClaudeCodeProject[]> {
    try {
      await fs.access(CLAUDE_PROJECTS_DIR);
    } catch (error) {
      // Claude 项目目录不存在，返回空数组
      return [];
    }

    try {
      const entries = await fs.readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
      const directories = entries.filter(e => e.isDirectory());

      const projects: ClaudeCodeProject[] = [];

      for (const entry of directories) {
        const projectName = entry.name;
        const projectPath = await this.extractProjectDirectory(projectName);
        const displayName = await this.generateDisplayName(projectPath);

        // 获取会话列表以获取统计信息
        const sessionsResult = await this.getSessions(projectPath, 1, 0);
        const lastActivity = sessionsResult.sessions.length > 0 
          ? sessionsResult.sessions[0].lastActivity 
          : undefined;

        projects.push({
          name: projectName,
          path: projectPath,
          displayName,
          lastActivity,
          sessionCount: sessionsResult.total,
        });
      }

      // 按最后活动时间排序
      projects.sort((a, b) => {
        if (!a.lastActivity && !b.lastActivity) return 0;
        if (!a.lastActivity) return 1;
        if (!b.lastActivity) return -1;
        return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
      });

      return projects;
    } catch (error) {
      console.error('Error discovering projects:', error);
      return [];
    }
  }

  // ============================================
  // 会话管理
  // ============================================

  /**
   * 获取项目的会话列表
   * 扫描项目目录下的 .jsonl 文件，解析每个文件提取会话元数据
   */
  async getSessions(
    projectPath: string,
    limit = 10,
    offset = 0
  ): Promise<ClaudeCodeSessionListResult> {
    const projectDir = this.getProjectDir(projectPath);
    const sessionsDir = path.join(CLAUDE_PROJECTS_DIR, projectDir);

    try {
      await fs.access(sessionsDir);
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
      const files = await fs.readdir(sessionsDir);
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
          const filePath = path.join(sessionsDir, file);
          const stats = await fs.stat(filePath);
          return { file, mtime: stats.mtime, filePath };
        })
      );
      filesWithStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      // 解析所有会话
      const allSessions: ClaudeCodeSession[] = [];
      const sessionSummaries = new Map<string, string>();
      const sessionMessageCounts = new Map<string, number>();
      const sessionLastActivities = new Map<string, string>();
      const sessionCwds = new Map<string, string>();
      const sessionModels = new Map<string, string>();

      for (const { file, filePath } of filesWithStats) {
        const sessionId = file.replace('.jsonl', '');

        try {
          let messageCount = 0;

          for await (const entry of parseJSONLFile(filePath)) {
            // 只处理包含 sessionId 的条目，或所有条目（如果 sessionId 缺失）
            if (entry.sessionId && entry.sessionId !== sessionId) {
              continue;
            }

            messageCount++;

            // 记录消息数量
            const count = sessionMessageCounts.get(sessionId) || 0;
            sessionMessageCounts.set(sessionId, count + 1);

            // 记录最后活动时间
            const lastActivity = sessionLastActivities.get(sessionId) || '';
            if (entry.timestamp && entry.timestamp > lastActivity) {
              sessionLastActivities.set(sessionId, entry.timestamp);
            }

            // 记录 cwd
            if (entry.cwd && !sessionCwds.has(sessionId)) {
              sessionCwds.set(sessionId, entry.cwd);
            }

            // 记录 model
            if (entry.model && !sessionModels.has(sessionId)) {
              sessionModels.set(sessionId, entry.model);
            }

            // 处理摘要
            if (entry.type === 'summary' && entry.message?.content) {
              const summary = typeof entry.message.content === 'string'
                ? entry.message.content
                : JSON.stringify(entry.message.content);
              sessionSummaries.set(sessionId, summary);
            }

            // 提取最后用户消息作为摘要（如果没有摘要）
            if (entry.message?.role === 'user' && entry.message?.content) {
              const textContent = extractTextFromContent(entry.message.content);
              if (!isSystemMessage(textContent) && !sessionSummaries.has(sessionId)) {
                sessionSummaries.set(sessionId, truncateText(textContent));
              }
            }
          }
        } catch (error) {
          console.error(`Error reading session file ${file}:`, error);
        }
      }

      // 构建会话列表 - 按 .jsonl 文件分组，跳过空文件
      for (const { file, filePath } of filesWithStats) {
        const sessionId = file.replace('.jsonl', '');
        const messageCount = sessionMessageCounts.get(sessionId) || 0;
        
        // 跳过空文件（messageCount 为 0）
        if (messageCount === 0) {
          continue;
        }
        
        const summary = sessionSummaries.get(sessionId) || 'New Session';
        const lastActivity = sessionLastActivities.get(sessionId) || new Date().toISOString();
        const cwd = sessionCwds.get(sessionId);
        const model = sessionModels.get(sessionId);

        allSessions.push({
          id: sessionId,
          summary,
          messageCount,
          lastActivity,
          cwd,
          model,
          filePath,
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

  // ============================================
  // 消息检索
  // ============================================

  /**
   * 获取会话消息
   * 查找包含该 sessionId 的 JSONL 文件，解析并返回所有消息条目
   */
  async getMessages(
    sessionId: string,
    projectPath?: string,
    limit: number | null = null,
    offset = 0
  ): Promise<ClaudeCodeMessageListResult> {
    // 如果提供了 projectPath，直接定位文件
    if (projectPath) {
      return this.getMessagesFromProject(sessionId, projectPath, limit, offset);
    }

    // 否则，搜索所有项目
    const projects = await this.discoverProjects();
    
    for (const project of projects) {
      const result = await this.getMessagesFromProject(sessionId, project.path, limit, offset);
      if (result.messages.length > 0) {
        return result;
      }
    }

    return {
      messages: [],
      total: 0,
      hasMore: false,
      offset,
      limit: limit || 0,
    };
  }

  /**
   * 从特定项目获取会话消息
   */
  private async getMessagesFromProject(
    sessionId: string,
    projectPath: string,
    limit: number | null,
    offset: number
  ): Promise<ClaudeCodeMessageListResult> {
    const projectDir = this.getProjectDir(projectPath);
    const sessionFilePath = path.join(CLAUDE_PROJECTS_DIR, projectDir, `${sessionId}.jsonl`);

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
      const messages: ClaudeCodeMessage[] = [];
      let messageId = 0;

      for await (const entry of parseJSONLFile(sessionFilePath)) {
        // 确定消息类型
        let type: ClaudeCodeMessage['type'] = 'user';
        if (entry.type === 'tool_use' || entry.tool_name) {
          type = 'tool_use';
        } else if (entry.type === 'tool_result' || entry.tool_result !== undefined) {
          type = 'tool_result';
        } else if (entry.type === 'summary') {
          type = 'summary';
        } else if (entry.message?.role === 'assistant') {
          type = 'assistant';
        } else if (entry.message?.role === 'system') {
          type = 'system';
        }

        const message: ClaudeCodeMessage = {
          id: `${sessionId}-${messageId++}`,
          sessionId: entry.sessionId || sessionId,
          type,
          role: entry.message?.role as ClaudeCodeMessage['role'],
          content: entry.message?.content as string | ClaudeCodeMessage['content'],
          toolName: entry.tool_name,
          toolInput: entry.tool_input,
          toolResult: entry.tool_result,
          toolUseId: entry.tool_use_id,
          isApiErrorMessage: entry.isApiErrorMessage,
          timestamp: entry.timestamp || new Date().toISOString(),
          uuid: entry.uuid,
          parentUuid: entry.parentUuid,
          cwd: entry.cwd,
          model: entry.model,
        };

        messages.push(message);
      }

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

  // ============================================
  // 辅助方法
  // ============================================

  /**
   * 从编码的目录名提取实际路径
   * 1. 首先检查 project-config.json
   * 2. 然后从 JSONL 文件的 cwd 字段提取
   * 3. 最后 fallback 到解码目录名
   */
  private async extractProjectDirectory(projectName: string): Promise<string> {
    // 检查缓存
    if (this.projectDirectoryCache.has(projectName)) {
      return this.projectDirectoryCache.get(projectName)!;
    }

    // 1. 检查项目配置中的 originalPath
    try {
      const configContent = await fs.readFile(PROJECT_CONFIG_PATH, 'utf8');
      const config: ClaudeCodeConfigFile = JSON.parse(configContent);
      
      if (config[projectName]?.originalPath) {
        const originalPath = config[projectName].originalPath!;
        this.projectDirectoryCache.set(projectName, originalPath);
        return originalPath;
      }
    } catch (error) {
      // 配置文件不存在或解析失败，继续下一步
    }

    // 2. 从 JSONL 文件提取 cwd
    const projectDir = path.join(CLAUDE_PROJECTS_DIR, projectName);
    const cwdCounts = new Map<string, number>();
    let latestTimestamp = 0;
    let latestCwd = '';

    try {
      await fs.access(projectDir);

      const files = await fs.readdir(projectDir);
      const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));

      if (jsonlFiles.length === 0) {
        // 没有会话文件，使用解码后的项目名
        const fallbackPath = this.decodeProjectName(projectName);
        this.projectDirectoryCache.set(projectName, fallbackPath);
        return fallbackPath;
      }

      // 解析 JSONL 文件提取 cwd
      for (const file of jsonlFiles.slice(0, 10)) { // 只检查前10个文件
        const filePath = path.join(projectDir, file);

        try {
          for await (const entry of parseJSONLFile(filePath)) {
            if (entry.cwd) {
              const count = cwdCounts.get(entry.cwd) || 0;
              cwdCounts.set(entry.cwd, count + 1);

              const timestamp = new Date(entry.timestamp || 0).getTime();
              if (timestamp > latestTimestamp) {
                latestTimestamp = timestamp;
                latestCwd = entry.cwd;
              }
            }
          }
        } catch (error) {
          // 跳过无法读取的文件
        }
      }

      // 确定最佳 cwd
      let extractedPath = '';

      if (cwdCounts.size === 0) {
        extractedPath = this.decodeProjectName(projectName);
      } else if (cwdCounts.size === 1) {
        extractedPath = Array.from(cwdCounts.keys())[0];
      } else {
        // 多个 cwd，使用最频繁的
        const maxCount = Math.max(...cwdCounts.values());
        const mostFrequentCwd = Array.from(cwdCounts.entries()).find(([_, count]) => count === maxCount)?.[0];

        if (mostFrequentCwd) {
          extractedPath = mostFrequentCwd;
        } else {
          extractedPath = latestCwd || this.decodeProjectName(projectName);
        }
      }

      this.projectDirectoryCache.set(projectName, extractedPath);
      return extractedPath;
    } catch (error) {
      const fallbackPath = this.decodeProjectName(projectName);
      this.projectDirectoryCache.set(projectName, fallbackPath);
      return fallbackPath;
    }
  }

  /**
   * 生成显示名称
   * 优先从 package.json 读取 name，否则使用路径最后一部分
   */
  private async generateDisplayName(projectPath: string): Promise<string> {
    // 尝试读取 package.json
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const packageContent = await fs.readFile(packageJsonPath, 'utf8');
      const packageJson = JSON.parse(packageContent);

      if (packageJson.name) {
        return packageJson.name;
      }
    } catch (error) {
      // package.json 不存在或解析失败，继续下一步
    }

    // 从路径中提取最后部分
    const parts = projectPath.split(path.sep).filter(Boolean);
    return parts[parts.length - 1] || projectPath;
  }

  /**
   * 获取项目目录名称（路径编码）
   */
  private getProjectDir(projectPath: string): string {
    return projectPath.replace(/[\\/:\s~_]/g, '-');
  }

  /**
   * 解码项目名称
   * 将编码后的项目名转换回路径
   */
  private decodeProjectName(projectName: string): string {
    // Claude Code 使用简单的替换编码
    // 将 - 替换回 / 或 \
    // 这是一个启发式方法，可能不完全准确
    return projectName.replace(/-/g, '/');
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

export { ClaudeCodeReader };
