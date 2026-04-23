/**
 * EvaluationMessageStore - JSONL 存储服务
 *
 * 用于存储评估会话的消息，替代 Prisma SessionMessage 模型。
 * 解决外键约束问题（workflowNodeId 不存在于 WorkflowNode 表）。
 *
 * 存储位置：data/sessions/{projectId}/{sessionId}/
 * - messages.jsonl: 消息记录（每行一个 JSON 对象）
 * - index.json: 索引信息（sessionId, projectId, messageCount, nodeIdRanges）
 * - summary.json: 会话摘要
 *
 * 参考：src/services/session-manager.ts 的成熟 JSONL 实现
 */

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import readline from 'readline';
import AsyncLock from 'async-lock';

// ============================================
// 类型定义
// ============================================

/**
 * 评估消息接口
 * 
 * 与 Prisma SessionMessage 的区别：
 * - nodeId 为字符串，无外键依赖
 * - 包含 agentCallMsgId 用于子 Agent 消息归属
 * - nodeIndex 用于节点内消息排序
 */
export interface EvaluationMessage {
  /** 消息 ID，格式：msg-{timestamp}-{random} */
  id: string;
  
  /** 会话 ID */
  sessionId: string;
  
  /** 消息角色 */
  role: 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result';
  
  /** 工作流节点 ID（字符串，无外键依赖） */
  nodeId: string;
  
  /** 节点内消息索引（用于排序） */
  nodeIndex: number;
  
  /** 消息内容 */
  content: string | Array<any>;
  
  /** 
   * 子 Agent 调用消息 ID
   * 用于标记子 Agent 产生的消息归属
   * null 表示主 Agent 消息
   */
  agentCallMsgId: string | null;
  
  /** 创建时间 */
  timestamp: string;
  
  /** 可选：工具名称（仅 tool_use/tool_result） */
  toolName?: string;
  
  /** 可选：工具输入（仅 tool_use） */
  toolInput?: Record<string, unknown>;
  
  /** 可选：工具结果（仅 tool_result） */
  toolResult?: unknown;
  
  /** 可选：工具调用 ID（用于关联 tool_use 和 tool_result） */
  toolUseId?: string;
}

/**
 * 消息索引接口
 * 
 * 存储在 index.json 中，用于快速查询和所有权验证
 */
export interface MessageIndex {
  /** 会话 ID */
  sessionId: string;
  
  /** 项目 ID（用于所有权验证） */
  projectId: string;
  
  /** 消息总数 */
  messageCount: number;
  
  /** 
   * 节点 ID 范围映射
   * 用于高效过滤 nodeId
   * 格式：{ nodeId: { start: number, end: number } }
   */
  nodeIdRanges: Record<string, { start: number; end: number }>;
  
  /** 最后活动时间 */
  lastActivity: string;
  
  /** 创建时间 */
  createdAt: string;
}

/**
 * 消息摘要接口
 * 
 * 存储在 summary.json 中，用于会话列表展示
 */
export interface MessageSummary {
  /** 会话 ID */
  sessionId: string;
  
  /** 会话摘要文本 */
  summary: string;
  
  /** 创建时间 */
  createdAt: string;
  
  /** 更新时间 */
  updatedAt: string;
  
  /** 消息总数 */
  messageCount: number;
  
  /** 工作流类型 */
  workflowType?: 'FSM' | 'DAG';
}

/**
 * 消息查询结果
 */
export interface EvaluationMessagesResult {
  messages: EvaluationMessage[];
  total: number;
  hasMore: boolean;
  offset: number;
  limit: number;
}

// ============================================
// 常量
// ============================================

/** 会话存储根目录 */
const SESSIONS_BASE_DIR = path.join(process.cwd(), 'data', 'sessions');

/** 锁超时时间（毫秒） */
const LOCK_TIMEOUT = 5000;

// ============================================
// 工具函数
// ============================================

/**
 * 生成消息 ID
 * 格式：msg-{timestamp}-{random}
 */
function generateMessageId(): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  return `msg-${timestamp}-${random}`;
}

/**
 * 生成会话目录路径
 * 格式：data/sessions/{projectId}/{sessionId}/
 */
function getSessionDir(projectId: string, sessionId: string): string {
  return path.join(SESSIONS_BASE_DIR, projectId, sessionId);
}

/**
 * 获取消息文件路径
 */
function getMessagesPath(sessionDir: string): string {
  return path.join(sessionDir, 'messages.jsonl');
}

/**
 * 获取索引文件路径
 */
function getIndexPath(sessionDir: string): string {
  return path.join(sessionDir, 'index.json');
}

/**
 * 获取摘要文件路径
 */
function getSummaryPath(sessionDir: string): string {
  return path.join(sessionDir, 'summary.json');
}

// ============================================
// EvaluationMessageStore 类
// ============================================

/**
 * 评估消息存储服务
 * 
 * 使用 JSONL 文件存储会话消息，支持：
 * - 流式写入（append-only）
 * - 并发控制（async-lock）
 * - nodeId 过滤
 * - 子 Agent 消息归属
 */
export class EvaluationMessageStore {
  /** 并发锁（按 sessionId 锁定） */
  private lock: AsyncLock;
  
  /** 会话目录路径 */
  private sessionDir: string;
  
  /** 消息文件路径 */
  private messagesPath: string;
  
  /** 索引文件路径 */
  private indexPath: string;
  
  /** 摘要文件路径 */
  private summaryPath: string;
  
  /** 会话 ID */
  private sessionId: string;
  
  /** 项目 ID */
  private projectId: string;
  
  /** 消息 ID 到行索引的缓存 */
  private messageIdCache: Map<string, number> = new Map();
  
  /** 缓存是否已构建 */
  private cacheBuilt: boolean = false;

  /**
   * 构造函数
   * 
   * @param projectId 项目 ID
   * @param sessionId 会话 ID
   */
  constructor(projectId: string, sessionId: string) {
    this.projectId = projectId;
    this.sessionId = sessionId;
    this.sessionDir = getSessionDir(projectId, sessionId);
    this.messagesPath = getMessagesPath(this.sessionDir);
    this.indexPath = getIndexPath(this.sessionDir);
    this.summaryPath = getSummaryPath(this.sessionDir);
    
    // 初始化 async-lock，按 sessionId 锁定
    this.lock = new AsyncLock({ timeout: LOCK_TIMEOUT });
  }

  /**
   * 初始化会话存储
   * 
   * 创建目录和初始文件
   */
  async initialize(): Promise<void> {
    // 创建会话目录
    await fs.mkdir(this.sessionDir, { recursive: true });
    
    // 创建空的 messages.jsonl（如果不存在）
    try {
      await fs.access(this.messagesPath);
    } catch {
      await fs.writeFile(this.messagesPath, '', 'utf-8');
    }
    
    // 创建初始 index.json（如果不存在）
    const initialIndex: MessageIndex = {
      sessionId: this.sessionId,
      projectId: this.projectId,
      messageCount: 0,
      nodeIdRanges: {},
      lastActivity: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    
    try {
      await fs.access(this.indexPath);
    } catch {
      await fs.writeFile(
        this.indexPath,
        JSON.stringify(initialIndex, null, 2),
        'utf-8'
      );
    }
    
    // 创建初始 summary.json（如果不存在）
    const initialSummary: MessageSummary = {
      sessionId: this.sessionId,
      summary: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
    };
    
    try {
      await fs.access(this.summaryPath);
    } catch {
      await fs.writeFile(
        this.summaryPath,
        JSON.stringify(initialSummary, null, 2),
        'utf-8'
      );
    }
  }

  /**
   * 追加消息（使用 async-lock 并发控制）
   * 
   * @param message 消息数据（不含 id 和 timestamp）
   * @returns 创建的消息（含 id 和 timestamp）
   */
  async appendMessage(
    message: Omit<EvaluationMessage, 'id' | 'sessionId' | 'timestamp'>
  ): Promise<EvaluationMessage> {
    // 使用 async-lock 按 sessionId 锁定
    return this.lock.acquire(this.sessionId, async () => {
      const fullMessage: EvaluationMessage = {
        id: generateMessageId(),
        sessionId: this.sessionId,
        timestamp: new Date().toISOString(),
        ...message,
      };
      
      // 追加到 messages.jsonl
      const line = JSON.stringify(fullMessage) + '\n';
      await fs.appendFile(this.messagesPath, line, 'utf-8');
      
      // 更新 index.json
      await this.updateIndex(fullMessage);
      
      return fullMessage;
    });
  }

  /**
   * 更新索引文件
   * 
   * @param newMessage 新追加的消息
   */
  private async updateIndex(newMessage: EvaluationMessage): Promise<void> {
    // 读取当前索引
    const indexContent = await fs.readFile(this.indexPath, 'utf-8');
    const index: MessageIndex = JSON.parse(indexContent);
    
    // 更新消息计数
    index.messageCount += 1;
    index.lastActivity = new Date().toISOString();
    
    // 更新 nodeIdRanges
    const nodeId = newMessage.nodeId;
    if (!index.nodeIdRanges[nodeId]) {
      index.nodeIdRanges[nodeId] = { start: index.messageCount - 1, end: index.messageCount - 1 };
    } else {
      index.nodeIdRanges[nodeId].end = index.messageCount - 1;
    }
    
    // 写回索引
    await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }

  /**
   * 获取消息列表（流式读取）
   * 
   * 使用 readline + for await 模式，不加载全部消息到内存。
   * 如果指定 nodeId，使用 nodeIdRanges 只读取指定范围行。
   * 
   * @param options 查询选项
   * @returns 消息列表和分页信息
   */
  async getMessages(options?: {
    nodeId?: string;
    agentCallMsgId?: string;
    offset?: number;
    limit?: number;
  }): Promise<EvaluationMessagesResult> {
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 100;
    
    // 检查文件是否存在
    try {
      await fs.access(this.messagesPath);
    } catch {
      return {
        messages: [],
        total: 0,
        hasMore: false,
        offset,
        limit,
      };
    }
    
    // 读取索引获取 nodeIdRanges
    const indexContent = await fs.readFile(this.indexPath, 'utf-8');
    const index: MessageIndex = JSON.parse(indexContent);
    
    // 如果指定 nodeId 且存在范围，使用范围优化
    const useRangeOptimization = options?.nodeId && index.nodeIdRanges[options.nodeId];
    
    try {
      const fileStream = await fs.open(this.messagesPath, 'r');
      const rl = readline.createInterface({
        input: fileStream.createReadStream(),
        crlfDelay: Infinity,
      });
      
      const messages: EvaluationMessage[] = [];
      let lineIndex = 0;
      let totalFiltered = 0;
      
      // 获取范围（如果使用范围优化）
      const range = useRangeOptimization 
        ? index.nodeIdRanges[options!.nodeId!] 
        : null;
      
      // 构建缓存（首次读取时）
      if (!this.cacheBuilt) {
        this.messageIdCache.clear();
      }
      
      for await (const line of rl) {
        if (!line.trim()) {
          lineIndex++;
          continue;
        }
        
        // 范围优化：跳过不在范围内的行
        if (range && (lineIndex < range.start || lineIndex > range.end)) {
          lineIndex++;
          continue;
        }
        
        try {
          const msg: EvaluationMessage = JSON.parse(line);
          
          // 构建缓存
          if (!this.cacheBuilt) {
            this.messageIdCache.set(msg.id, lineIndex);
          }
          
          // 过滤条件
          let matches = true;
          
          if (options?.nodeId && msg.nodeId !== options.nodeId) {
            matches = false;
          }
          
          if (options?.agentCallMsgId && msg.agentCallMsgId !== options.agentCallMsgId) {
            matches = false;
          }
          
          if (matches) {
            totalFiltered++;
            
            // 分页：只收集范围内的消息
            if (totalFiltered > offset && totalFiltered <= offset + limit) {
              messages.push(msg);
            }
          }
        } catch (parseError) {
          // 跳过格式错误的行
        }
        
        lineIndex++;
      }
      
      // 标记缓存已构建
      this.cacheBuilt = true;
      
      await fileStream.close();
      
      return {
        messages,
        total: totalFiltered,
        hasMore: totalFiltered > offset + limit,
        offset,
        limit,
      };
    } catch (error) {
      console.error('Error reading messages:', error);
      return {
        messages: [],
        total: 0,
        hasMore: false,
        offset,
        limit,
      };
    }
  }

  /**
   * 获取单条消息（使用缓存定位优化）
   * 
   * 如果缓存已构建，直接定位到指定行读取。
   * 如果缓存未构建，先构建缓存再查找。
   * 
   * @param messageId 消息 ID
   * @returns 消息或 null
   */
  async getMessageById(messageId: string): Promise<EvaluationMessage | null> {
    // 检查文件是否存在
    try {
      await fs.access(this.messagesPath);
    } catch {
      return null;
    }
    
    // 如果缓存已构建且有该消息的索引，直接定位读取
    if (this.cacheBuilt && this.messageIdCache.has(messageId)) {
      const lineIndex = this.messageIdCache.get(messageId)!;
      return this.readMessageAtLine(lineIndex);
    }
    
    // 缓存未构建，需要流式查找并构建缓存
    try {
      const fileStream = await fs.open(this.messagesPath, 'r');
      const rl = readline.createInterface({
        input: fileStream.createReadStream(),
        crlfDelay: Infinity,
      });
      
      let lineIndex = 0;
      let foundMessage: EvaluationMessage | null = null;
      
      // 清空并重建缓存
      this.messageIdCache.clear();
      
      for await (const line of rl) {
        if (!line.trim()) {
          lineIndex++;
          continue;
        }
        
        try {
          const msg: EvaluationMessage = JSON.parse(line);
          
          // 添加到缓存
          this.messageIdCache.set(msg.id, lineIndex);
          
          // 检查是否是目标消息
          if (msg.id === messageId) {
            foundMessage = msg;
          }
        } catch (parseError) {
          // 跳过格式错误的行
        }
        
        lineIndex++;
      }
      
      // 标记缓存已构建
      this.cacheBuilt = true;
      
      await fileStream.close();
      
      return foundMessage;
    } catch (error) {
      console.error('Error finding message by ID:', error);
      return null;
    }
  }
  
  /**
   * 读取指定行的消息（内部方法）
   * 
   * @param lineIndex 行索引（0-based）
   * @returns 消息或 null
   */
  private async readMessageAtLine(lineIndex: number): Promise<EvaluationMessage | null> {
    try {
      const fileStream = await fs.open(this.messagesPath, 'r');
      const rl = readline.createInterface({
        input: fileStream.createReadStream(),
        crlfDelay: Infinity,
      });
      
      let currentIndex = 0;
      let foundMessage: EvaluationMessage | null = null;
      
      for await (const line of rl) {
        if (currentIndex === lineIndex && line.trim()) {
          try {
            foundMessage = JSON.parse(line);
            break; // 找到目标行，提前退出
          } catch (parseError) {
            // 格式错误
          }
        }
        currentIndex++;
        
        // 如果已经超过目标行，提前退出
        if (currentIndex > lineIndex) {
          break;
        }
      }
      
      await fileStream.close();
      
      return foundMessage;
    } catch (error) {
      console.error('Error reading message at line:', error);
      return null;
    }
  }
  
  /**
   * 清除缓存（用于重新加载）
   */
  clearCache(): void {
    this.messageIdCache.clear();
    this.cacheBuilt = false;
  }

  /**
   * 获取消息总数
   */
  async getMessageCount(): Promise<number> {
    const indexContent = await fs.readFile(this.indexPath, 'utf-8');
    const index: MessageIndex = JSON.parse(indexContent);
    return index.messageCount;
  }

  /**
   * 获取索引信息
   */
  async getIndex(): Promise<MessageIndex> {
    const indexContent = await fs.readFile(this.indexPath, 'utf-8');
    return JSON.parse(indexContent);
  }

  /**
   * 获取摘要信息
   */
  async getSummary(): Promise<MessageSummary> {
    const summaryContent = await fs.readFile(this.summaryPath, 'utf-8');
    return JSON.parse(summaryContent);
  }

  /**
   * 更新摘要
   * 
   * @param summary 摘要文本
   */
  async updateSummary(summary: string): Promise<void> {
    const summaryData = await this.getSummary();
    summaryData.summary = summary;
    summaryData.updatedAt = new Date().toISOString();
    
    await fs.writeFile(
      this.summaryPath,
      JSON.stringify(summaryData, null, 2),
      'utf-8'
    );
  }

  /**
   * 删除会话存储
   * 
   * 删除整个会话目录
   */
  async delete(): Promise<void> {
    await fs.rm(this.sessionDir, { recursive: true, force: true });
  }

  /**
   * 检查会话是否存在
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.sessionDir);
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================
// 导出工厂函数
// ============================================

/**
 * 创建 EvaluationMessageStore 实例
 * 
 * @param projectId 项目 ID
 * @param sessionId 会话 ID
 * @returns EvaluationMessageStore 实例
 */
export function createEvaluationMessageStore(
  projectId: string,
  sessionId: string
): EvaluationMessageStore {
  return new EvaluationMessageStore(projectId, sessionId);
}