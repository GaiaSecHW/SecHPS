/**
 * MCP Client - 直接调用 MCP 服务器工具
 * 
 * 使用 JSON-RPC 2.0 协议通过 stdio 与 MCP 服务器通信
 * 用于在评估启动前调用 MCP 工具（如 AI4Java 的 decompileProject）
 */

import { spawn, ChildProcess } from 'child_process';
import { logger, LOG_MODULES } from './logger';

// MCP 服务器配置
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number; // 超时时间（毫秒），默认 5 分钟
}

// MCP 工具调用结果
export interface McpToolResult {
  success: boolean;
  content?: unknown[];
  error?: string;
  isError?: boolean;
}

// JSON-RPC 请求
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

// JSON-RPC 响应
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * MCP 客户端类
 * 管理 MCP 服务器的生命周期和工具调用
 */
export class McpClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests: Map<number, {
    resolve: (value: JsonRpcResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private buffer = '';
  private initialized = false;
  private config: McpServerConfig;
  private serverName: string;

  constructor(serverName: string, config: McpServerConfig) {
    this.serverName = serverName;
    this.config = {
      timeout: 5 * 60 * 1000, // 默认 5 分钟超时
      ...config,
    };
  }

  /**
   * 启动 MCP 服务器并初始化连接
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        logger.debug(LOG_MODULES.MCP, `启动 MCP 服务器: ${this.serverName}`, {
          command: this.config.command,
          args: this.config.args,
        });

        // 合并环境变量
        const env = {
          ...process.env,
          ...this.config.env,
        };

        // 启动子进程
        this.process = spawn(this.config.command, this.config.args || [], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env,
          windowsHide: true,
        });

        // 处理 stdout（JSON-RPC 响应）
        this.process.stdout?.on('data', (data: Buffer) => {
          this.handleData(data.toString());
        });

        // 处理 stderr（日志输出）
        this.process.stderr?.on('data', (data: Buffer) => {
          logger.debug(LOG_MODULES.MCP, `[${this.serverName}] stderr:`, { output: data.toString() });
        });

        // 处理进程退出
        this.process.on('close', (code) => {
          logger.debug(LOG_MODULES.MCP, `MCP 服务器 ${this.serverName} 已退出`, { code });
          this.process = null;
          // 拒绝所有待处理的请求
          for (const [id, pending] of this.pendingRequests) {
            clearTimeout(pending.timeout);
            pending.reject(new Error(`MCP 服务器已关闭 (code: ${code})`));
          }
          this.pendingRequests.clear();
        });

        // 处理错误
        this.process.on('error', (error) => {
          logger.errorNoUser(LOG_MODULES.MCP, `MCP 服务器 ${this.serverName} 错误:`, error);
          reject(error);
        });

        // 发送初始化请求
        this.sendRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          clientInfo: {
            name: 'ai4web-mcp-client',
            version: '1.0.0',
          },
        })
          .then((response) => {
            logger.debug(LOG_MODULES.MCP, `MCP 服务器 ${this.serverName} 初始化成功`, { result: response.result });
            // 发送 initialized 通知
            this.sendNotification('notifications/initialized', {});
            this.initialized = true;
            resolve();
          })
          .catch(reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 调用 MCP 工具
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<McpToolResult> {
    if (!this.initialized) {
      throw new Error('MCP 客户端未初始化，请先调用 connect()');
    }

    try {
      logger.debug(LOG_MODULES.MCP, `调用 MCP 工具: ${toolName}`, { args });

      const response = await this.sendRequest('tools/call', {
        name: toolName,
        arguments: args,
      });

      if (response.error) {
        return {
          success: false,
          error: response.error.message,
          isError: true,
        };
      }

      const result = response.result as { content?: unknown[]; isError?: boolean };
      
      return {
        success: !result.isError,
        content: result.content,
        error: result.isError ? '工具执行失败' : undefined,
        isError: result.isError,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  }

  /**
   * 列出可用工具
   */
  async listTools(): Promise<unknown[]> {
    if (!this.initialized) {
      throw new Error('MCP 客户端未初始化，请先调用 connect()');
    }

    const response = await this.sendRequest('tools/list', {});
    return (response.result as { tools: unknown[] })?.tools || [];
  }

  /**
   * 关闭 MCP 服务器连接
   */
  async close(): Promise<void> {
    if (this.process) {
      logger.debug(LOG_MODULES.MCP, `关闭 MCP 服务器: ${this.serverName}`);
      
      // 清理待处理请求
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('MCP 客户端已关闭'));
      }
      this.pendingRequests.clear();

      // 发送 shutdown 请求
      try {
        await this.sendRequest('shutdown', {}, 5000);
        this.sendNotification('notifications/exit', {});
      } catch {
        // 忽略关闭时的错误
      }

      // 强制关闭进程
      this.process.kill();
      this.process = null;
      this.initialized = false;
    }
  }

  /**
   * 发送 JSON-RPC 请求
   */
  private sendRequest(
    method: string,
    params: Record<string, unknown>,
    timeout = this.config.timeout
  ): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('MCP 服务器未启动'));
        return;
      }

      const id = ++this.requestId;
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      // 设置超时
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`请求超时: ${method}`));
      }, timeout);

      // 保存待处理请求
      this.pendingRequests.set(id, {
        resolve,
        reject,
        timeout: timeoutHandle,
      });

      // 发送请求
      const message = JSON.stringify(request) + '\n';
      logger.debug(LOG_MODULES.MCP, `发送请求: ${method}`, { id });
      this.process.stdin.write(message);
    });
  }

  /**
   * 发送 JSON-RPC 通知（不需要响应）
   */
  private sendNotification(method: string, params: Record<string, unknown>): void {
    if (!this.process?.stdin) {
      return;
    }

    const notification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const message = JSON.stringify(notification) + '\n';
    this.process.stdin.write(message);
  }

  /**
   * 处理接收到的数据
   */
  private handleData(data: string): void {
    this.buffer += data;

    // 尝试解析完整的 JSON 消息
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // 保留最后一个不完整的行

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      try {
        const response: JsonRpcResponse = JSON.parse(line);
        
        // 查找对应的待处理请求
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(response.id);
          pending.resolve(response);
        } else {
          logger.warn(LOG_MODULES.MCP, `收到未知请求 ID 的响应: ${response.id}`);
        }
      } catch (error) {
        logger.warn(LOG_MODULES.MCP, `解析 JSON-RPC 响应失败:`, { line, error });
      }
    }
  }
}

/**
 * 快捷方法：调用 MCP 工具
 * 
 * @param serverName MCP 服务器名称（用于日志）
 * @param config MCP 服务器配置
 * @param toolName 工具名称
 * @param args 工具参数
 * @returns 工具调用结果
 */
export async function callMcpTool(
  serverName: string,
  config: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const client = new McpClient(serverName, config);
  
  try {
    await client.connect();
    const result = await client.callTool(toolName, args);
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  } finally {
    await client.close();
  }
}

/**
 * 快捷方法：调用 AI4Java 的 decompileProject 工具
 * 
 * @param serverConfig AI4Java MCP 服务器配置
 * @param projectRoot 项目根目录
 * @returns 反编译结果
 */
export async function callAi4JavaDecompile(
  serverConfig: McpServerConfig,
  projectRoot: string
): Promise<McpToolResult> {
  logger.info(LOG_MODULES.MCP, '调用 AI4Java decompileProject', { projectRoot });
  
  return callMcpTool(
    'ai4java',
    serverConfig,
    'decompileProject',
    { projectRoot }
  );
}
