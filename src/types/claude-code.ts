/**
 * Claude Code 本地数据类型定义
 * 
 * 用于读取 ~/.claude/projects 目录下的项目、会话和消息数据
 */

// ============================================
// 项目相关类型
// ============================================

/**
 * Claude Code 项目信息
 */
export interface ClaudeCodeProject {
  /** 编码后的项目目录名 */
  name: string;
  /** 实际项目路径 */
  path: string;
  /** 显示名称（优先从 package.json 读取） */
  displayName: string;
  /** 项目配置 */
  config?: ClaudeCodeProjectConfig;
  /** 最后活动时间 */
  lastActivity?: string;
  /** 会话数量 */
  sessionCount?: number;
}

/**
 * 项目配置
 */
export interface ClaudeCodeProjectConfig {
  originalPath?: string;
  displayName?: string;
  manuallyAdded?: boolean;
}

// ============================================
// 会话相关类型
// ============================================

/**
 * Claude Code 会话信息
 */
export interface ClaudeCodeSession {
  /** 会话 ID */
  id: string;
  /** 会话摘要 */
  summary: string;
  /** 消息数量 */
  messageCount: number;
  /** 最后活动时间 */
  lastActivity: string;
  /** 工作目录 */
  cwd?: string;
  /** 使用的模型 */
  model?: string;
  /** 会话文件路径 */
  filePath?: string;
}

/**
 * 会话列表查询结果
 */
export interface ClaudeCodeSessionListResult {
  sessions: ClaudeCodeSession[];
  hasMore: boolean;
  total: number;
  offset: number;
  limit: number;
}

// ============================================
// 消息相关类型
// ============================================

/**
 * 消息类型
 */
export type ClaudeCodeMessageType = 
  | 'user'
  | 'assistant'
  | 'tool_use'
  | 'tool_result'
  | 'summary'
  | 'system';

/**
 * 消息内容
 */
export interface ClaudeCodeMessageContent {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
  tool_use_id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string | ClaudeCodeMessageContent[];
}

/**
 * Claude Code 消息
 */
export interface ClaudeCodeMessage {
  /** 消息 ID */
  id: string;
  /** 会话 ID */
  sessionId: string;
  /** 消息类型 */
  type: ClaudeCodeMessageType;
  /** 消息角色 */
  role?: 'user' | 'assistant' | 'system';
  /** 消息内容 */
  content?: string | ClaudeCodeMessageContent[];
  /** 工具名称 */
  toolName?: string;
  /** 工具输入 */
  toolInput?: Record<string, unknown>;
  /** 工具结果 */
  toolResult?: unknown;
  /** 工具调用 ID */
  toolUseId?: string;
  /** 是否为 API 错误消息 */
  isApiErrorMessage?: boolean;
  /** 时间戳 */
  timestamp: string;
  /** 消息 UUID */
  uuid?: string;
  /** 父消息 UUID */
  parentUuid?: string | null;
  /** 工作目录 */
  cwd?: string;
  /** 模型信息 */
  model?: string;
}

/**
 * 消息列表查询结果
 */
export interface ClaudeCodeMessageListResult {
  messages: ClaudeCodeMessage[];
  total: number;
  hasMore: boolean;
  offset: number;
  limit: number;
}

// ============================================
// JSONL 条目类型
// ============================================

/**
 * JSONL 文件中的原始条目格式
 */
export interface ClaudeCodeJSONLEntry {
  sessionId?: string;
  type?: string;
  message?: {
    role?: string;
    content?: string | any[];
  };
  timestamp?: string;
  uuid?: string;
  parentUuid?: string | null;
  cwd?: string;
  model?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_result?: unknown;
  tool_use_id?: string;
  isApiErrorMessage?: boolean;
}

// ============================================
// 配置类型
// ============================================

/**
 * Claude Code 项目配置文件格式
 */
export interface ClaudeCodeConfigFile {
  [projectName: string]: ClaudeCodeProjectConfig;
}

/**
 * ClaudeCodeReader 配置选项
 */
export interface ClaudeCodeReaderOptions {
  /** 最大缓存大小 */
  cacheMaxSize?: number;
  /** 会话文件最大读取数量 */
  maxSessionsPerProject?: number;
}

// ============================================
// 多源 Provider 类型
// ============================================

/**
 * Provider 来源类型
 */
export type ProviderSource = 'claude' | 'cursor' | 'codex' | 'gemini';

/**
 * 多源会话结构
 * 统一各 Provider 的会话数据
 */
export interface MultiSourceSession {
  id: string;
  source: ProviderSource;
  projectId?: string;
  projectPath?: string;
  projectAlias?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  summary?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 规范化消息结构
 * 统一各 Provider 的消息格式
 */
export interface NormalizedMessage {
  id: string;
  sessionId: string;
  source: ProviderSource;
  role: 'user' | 'assistant' | 'system';
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'image' | 'code' | 'error';
  content: string;
  timestamp: number;
  toolUse?: {
    id: string;
    name: string;
    input: Record<string, unknown>;
  };
  toolResult?: {
    toolUseId: string;
    content: string | unknown;
    isError?: boolean;
  };
  thinking?: string;
  code?: {
    language: string;
    content: string;
  };
  images?: string[];
  metadata?: Record<string, unknown>;
  parentMessageId?: string;
  children?: string[];
}

/**
 * Provider 配置
 */
export interface ProviderConfig {
  enabled: boolean;
  basePath?: string;
}

/**
 * 多源 Provider 配置
 */
export interface MultiSourceProviderConfig {
  claude: ProviderConfig;
  cursor: ProviderConfig;
  codex: ProviderConfig;
  gemini: ProviderConfig;
}

// ============================================
// Cursor 特定类型
// ============================================

/**
 * Cursor 数据库会话结构
 * 来自 ~/.cursor/chats/{md5-hash}/state.vscdb
 */
export interface CursorSession {
  id: string;
  workspaceId: string;
  workspaceName?: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  messages: CursorMessage[];
}

/**
 * Cursor 消息结构
 */
export interface CursorMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number;
  toolUse?: {
    name: string;
    input: Record<string, unknown>;
    output?: unknown;
  };
}

// ============================================
// Codex 特定类型
// ============================================

/**
 * Codex JSONL 会话结构
 * 来自 ~/.codex/sessions/{sessionId}.jsonl
 */
export interface CodexSession {
  sessionId: string;
  createdAt: string;
  messages: CodexMessage[];
}

/**
 * Codex 消息结构
 */
export interface CodexMessage {
  type: string;
  role?: string;
  content?: string;
  timestamp?: number;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
}

// ============================================
// Gemini 特定类型
// ============================================

/**
 * Gemini 会话结构
 * 来自 ~/.gemini/sessions/{sessionId}.json
 */
export interface GeminiSession {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  messages: GeminiMessage[];
}

/**
 * Gemini 消息结构
 */
export interface GeminiMessage {
  role: string;
  parts: Array<{
    text?: string;
    functionCall?: {
      name: string;
      args: Record<string, unknown>;
    };
    functionResponse?: {
      name: string;
      response: unknown;
    };
  }>;
  timestamp?: number;
}
