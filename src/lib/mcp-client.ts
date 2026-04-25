/**
 * MCP Client - 直接调用 MCP 服务器工具
 * 
 * 支持两种 MCP 类型：
 * 1. Local MCP（Stdio）- 通过子进程 stdin/stdout JSON-RPC 通信
 * 2. Remote MCP（SSE）- 通过 HTTP/SSE 直接通信
 * 
 * 不经过大模型/SDK，直接调用工具
 */

import { spawn, ChildProcess } from 'child_process';
import { logger, LOG_MODULES } from './logger';

// 动态导入 EventSource（避免 Next.js ESM 兼容问题）
let EventSourceClass: typeof import('eventsource').EventSource;
async function getEventSource() {
  if (!EventSourceClass) {
    const module = await import('eventsource');
    EventSourceClass = module.EventSource;
  }
  return EventSourceClass;
}

// MCP 服务器配置（统一接口）
export interface McpConfig {
  name: string;
  type: 'local' | 'remote';
  command?: string;  // local 类型必填
  args?: string[];
  url?: string;      // remote 类型必填
  env?: Record<string, string>;
  timeout?: number;  // 超时时间（毫秒），默认 10 分钟
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

// ========================================
// Local MCP Client（Stdio 方式）
// ========================================

/**
 * Local MCP 客户端类
 * 通过 stdin/stdout JSON-RPC 与本地 MCP 服务器通信
 */
export class LocalMcpClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests: Map<number, {
    resolve: (value: JsonRpcResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private buffer = '';
  private initialized = false;
  private config: { command: string; args?: string[]; env?: Record<string, string>; timeout: number };
  private serverName: string;

  constructor(serverName: string, config: { command: string; args?: string[]; env?: Record<string, string>; timeout?: number }) {
    this.serverName = serverName;
    this.config = {
      timeout: 10 * 60 * 1000, // 默认 10 分钟超时
      ...config,
    };
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        logger.info(LOG_MODULES.MCP, `[Local] 启动 MCP 服务器: ${this.serverName}`, {
          command: this.config.command,
          args: this.config.args,
        });

        const env = { ...process.env, ...this.config.env };

        this.process = spawn(this.config.command, this.config.args || [], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env,
          windowsHide: true,
        });

        this.process.stdout?.on('data', (data: Buffer) => {
          this.handleData(data.toString());
        });

        this.process.stderr?.on('data', (data: Buffer) => {
          logger.debug(LOG_MODULES.MCP, `[${this.serverName}] stderr:`, { output: data.toString() });
        });

        this.process.on('close', (code) => {
          logger.info(LOG_MODULES.MCP, `[Local] MCP 服务器 ${this.serverName} 已退出`, { code });
          this.process = null;
          for (const [id, pending] of this.pendingRequests) {
            clearTimeout(pending.timeout);
            pending.reject(new Error(`MCP 服务器已关闭 (code: ${code})`));
          }
          this.pendingRequests.clear();
        });

        this.process.on('error', (error) => {
          logger.errorNoUser(LOG_MODULES.MCP, `[Local] MCP 服务器 ${this.serverName} 错误:`, error);
          reject(error);
        });

        // MCP 协议初始化
        this.sendRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          clientInfo: { name: 'ai4web-mcp-client', version: '1.0.0' },
        })
          .then((response) => {
            logger.info(LOG_MODULES.MCP, `[Local] MCP 服务器 ${this.serverName} 初始化成功`);
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

  async callTool(toolName: string, args: Record<string, unknown>): Promise<McpToolResult> {
    if (!this.initialized) {
      throw new Error('MCP 客户端未初始化');
    }

    try {
      logger.info(LOG_MODULES.MCP, `[Local] 调用工具: ${toolName}`, { args });

      const response = await this.sendRequest('tools/call', {
        name: toolName,
        arguments: args,
      });

      if (response.error) {
        return { success: false, error: response.error.message, isError: true };
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

  async close(): Promise<void> {
    if (this.process) {
      logger.info(LOG_MODULES.MCP, `[Local] 关闭 MCP 服务器: ${this.serverName}`);
      
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('MCP 客户端已关闭'));
      }
      this.pendingRequests.clear();

      try {
        await this.sendRequest('shutdown', {}, 5000);
        this.sendNotification('notifications/exit', {});
      } catch { }

      this.process.kill();
      this.process = null;
      this.initialized = false;
    }
  }

  /**
   * 获取 MCP 服务器提供的工具列表
   * @returns 工具列表 [{name, description, inputSchema}]
   */
  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: any }>> {
    if (!this.initialized) {
      throw new Error('MCP 客户端未初始化');
    }

    try {
      logger.info(LOG_MODULES.MCP, `[Local] 获取工具列表: ${this.serverName}`);

      const response = await this.sendRequest('tools/list', {});

      if (response.error) {
        logger.warn(LOG_MODULES.MCP, `[Local] 获取工具列表失败`, { error: response.error.message });
        return [];
      }

      const result = response.result as { tools?: Array<{ name: string; description?: string; inputSchema?: any }> };
      const tools = result.tools || [];
      
      logger.info(LOG_MODULES.MCP, `[Local] 工具列表获取成功`, { count: tools.length, tools: tools.map(t => t.name) });
      
      return tools;
    } catch (error) {
      logger.errorNoUser(LOG_MODULES.MCP, `[Local] 获取工具列表异常`, { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  private sendRequest(method: string, params: Record<string, unknown>, timeout?: number): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('MCP 服务器未启动'));
        return;
      }

      const id = ++this.requestId;
      const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`请求超时: ${method}`));
      }, timeout || this.config.timeout);

      this.pendingRequests.set(id, { resolve, reject, timeout: timeoutHandle });

      const message = JSON.stringify(request) + '\n';
      this.process.stdin.write(message);
    });
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    if (!this.process?.stdin) return;
    const notification = { jsonrpc: '2.0', method, params };
    this.process.stdin.write(JSON.stringify(notification) + '\n');
  }

  private handleData(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response: JsonRpcResponse = JSON.parse(line);
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(response.id);
          pending.resolve(response);
        }
      } catch (error) {
        logger.warn(LOG_MODULES.MCP, `[Local] 解析响应失败:`, { line, error });
      }
    }
  }
}

// ========================================
// Remote MCP Client（SSE 方式）
// ========================================

/**
 * Remote MCP 客户端类
 * 通过 HTTP/SSE 与远程 MCP 服务器通信
 * 
 * MCP SSE 协议：
 * - GET /sse - 建立 SSE 连接，接收响应
 * - POST /message - 发送 JSON-RPC 请求
 */
export class RemoteMcpClient {
  private eventSource: any = null;  // EventSource 类型（动态导入）
  private baseUrl: string;
  private sseUrl: string;
  private messageUrl: string;
  private requestId = 0;
  private pendingRequests: Map<number, {
    resolve: (value: JsonRpcResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private initialized = false;
  private serverName: string;
  private timeout: number;

  constructor(serverName: string, config: { url: string; timeout?: number }) {
    this.serverName = serverName;
    this.timeout = config.timeout || 10 * 60 * 1000;
    
    // 解析 URL，构建 SSE 和 Message 端点
    // MCP SSE 协议标准：
    // - SSE 端点: /sse
    // - Message 端点: /message
    this.baseUrl = config.url.replace(/\/sse$/, '').replace(/\/$/, '');
    this.sseUrl = `${this.baseUrl}/sse`;
    this.messageUrl = `${this.baseUrl}/message`;
  }

  async connect(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        logger.info(LOG_MODULES.MCP, `[Remote] 连接 MCP 服务器: ${this.serverName}`, {
          sseUrl: this.sseUrl,
          messageUrl: this.messageUrl,
        });

        // 动态获取 EventSource 类
        const EventSource = await getEventSource();

        // 建立 SSE 连接
        this.eventSource = new EventSource(this.sseUrl);

        this.eventSource.onopen = () => {
          logger.info(LOG_MODULES.MCP, `[Remote] SSE 连接已建立: ${this.serverName}`);
        };

        // 监听 message 事件（JSON-RPC 响应）
        this.eventSource.onmessage = (event: any) => {
          this.handleMessage(event.data);
        };

        // 监听 endpoint 事件（获取 message 端点）
        this.eventSource.addEventListener('endpoint', (event: any) => {
          logger.info(LOG_MODULES.MCP, `[Remote] 收到 endpoint 事件`, { data: event.data });
          // MCP 服务器返回的 endpoint 可能是相对路径或完整 URL
          if (event.data) {
            const endpoint = event.data as string;
            // 判断是否为相对路径（不以 http:// 或 https:// 开头）
            if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
              this.messageUrl = endpoint;
            } else {
              // 相对路径，拼接 baseUrl
              this.messageUrl = `${this.baseUrl}${endpoint}`;
            }
            logger.info(LOG_MODULES.MCP, `[Remote] Message URL`, { messageUrl: this.messageUrl });
          }
          
          // 发送初始化请求
          this.sendRequest('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            clientInfo: { name: 'ai4web-mcp-client', version: '1.0.0' },
          })
            .then((response) => {
              logger.info(LOG_MODULES.MCP, `[Remote] MCP 服务器 ${this.serverName} 初始化成功`);
              this.sendNotification('notifications/initialized', {});
              this.initialized = true;
              resolve();
            })
            .catch(reject);
        });

        this.eventSource.onerror = (error: any) => {
          logger.errorNoUser(LOG_MODULES.MCP, `[Remote] SSE 连接错误: ${this.serverName}`, { error });
          if (!this.initialized) {
            reject(new Error('SSE 连接失败'));
          }
        };

        // 超时处理
        setTimeout(() => {
          if (!this.initialized) {
            this.close();
            reject(new Error('连接超时'));
          }
        }, 30000); // 30秒连接超时
      } catch (error) {
        reject(error);
      }
    });
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<McpToolResult> {
    if (!this.initialized) {
      throw new Error('MCP 客户端未初始化');
    }

    try {
      logger.info(LOG_MODULES.MCP, `[Remote] 调用工具: ${toolName}`, { args });

      const response = await this.sendRequest('tools/call', {
        name: toolName,
        arguments: args,
      });

      if (response.error) {
        return { success: false, error: response.error.message, isError: true };
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

  async close(): Promise<void> {
    if (this.eventSource) {
      logger.info(LOG_MODULES.MCP, `[Remote] 关闭 MCP 连接: ${this.serverName}`);
      
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('MCP 客户端已关闭'));
      }
      this.pendingRequests.clear();

      this.eventSource.close();
      this.eventSource = null;
      this.initialized = false;
    }
  }

  /**
   * 获取 MCP 服务器提供的工具列表
   * @returns 工具列表 [{name, description, inputSchema}]
   */
  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: any }>> {
    if (!this.initialized) {
      throw new Error('MCP 客户端未初始化');
    }

    try {
      logger.info(LOG_MODULES.MCP, `[Remote] 获取工具列表: ${this.serverName}`);

      const response = await this.sendRequest('tools/list', {});

      if (response.error) {
        logger.warn(LOG_MODULES.MCP, `[Remote] 获取工具列表失败`, { error: response.error.message });
        return [];
      }

      const result = response.result as { tools?: Array<{ name: string; description?: string; inputSchema?: any }> };
      const tools = result.tools || [];
      
      logger.info(LOG_MODULES.MCP, `[Remote] 工具列表获取成功`, { count: tools.length, tools: tools.map(t => t.name) });
      
      return tools;
    } catch (error) {
      logger.errorNoUser(LOG_MODULES.MCP, `[Remote] 获取工具列表异常`, { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  private sendRequest(method: string, params: Record<string, unknown>, timeout?: number): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`请求超时: ${method}`));
      }, timeout || this.timeout);

      this.pendingRequests.set(id, { resolve, reject, timeout: timeoutHandle });

      // 通过 HTTP POST 发送请求
      fetch(this.messageUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
        .then((response) => {
          if (!response.ok) {
            reject(new Error(`HTTP 错误: ${response.status}`));
          }
          // 响应会通过 SSE 返回，不需要处理 HTTP 响应体
        })
        .catch((error) => {
          clearTimeout(timeoutHandle);
          this.pendingRequests.delete(id);
          reject(error);
        });
    });
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    const notification = { jsonrpc: '2.0', method, params };
    
    fetch(this.messageUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notification),
    }).catch((error) => {
      logger.warn(LOG_MODULES.MCP, `[Remote] 发送通知失败:`, { method, error });
    });
  }

  private handleMessage(data: string): void {
    try {
      const response: JsonRpcResponse = JSON.parse(data);
      
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.id);
        pending.resolve(response);
      }
    } catch (error) {
      logger.warn(LOG_MODULES.MCP, `[Remote] 解析响应失败:`, { data, error });
    }
  }
}

// ========================================
// 统一调用函数
// ========================================

/**
 * 直接调用 MCP 工具（不经过大模型）
 * 
 * 根据 type 自动选择 Local 或 Remote 客户端
 * 
 * @param config MCP 服务器配置
 * @param toolName 工具名称
 * @param toolArgs 工具参数
 * @returns 工具调用结果
 */
export async function callMcpToolDirect(
  config: McpConfig,
  toolName: string,
  toolArgs: Record<string, unknown>
): Promise<McpToolResult> {
  const startTime = Date.now();
  
  logger.info(LOG_MODULES.MCP, `[Direct] 开始调用 MCP 工具`, {
    serverName: config.name,
    serverType: config.type,
    toolName,
    toolArgs,
  });

  try {
    let client: LocalMcpClient | RemoteMcpClient;

    if (config.type === 'local') {
      if (!config.command) {
        return { success: false, error: 'local 类型缺少 command 配置', isError: true };
      }
      client = new LocalMcpClient(config.name, {
        command: config.command,
        args: config.args,
        env: config.env,
        timeout: config.timeout,
      });
    } else if (config.type === 'remote') {
      if (!config.url) {
        return { success: false, error: 'remote 类型缺少 url 配置', isError: true };
      }
      client = new RemoteMcpClient(config.name, {
        url: config.url,
        timeout: config.timeout,
      });
    } else {
      return { success: false, error: `不支持的 MCP 类型: ${config.type}`, isError: true };
    }

    await client.connect();
    const result = await client.callTool(toolName, toolArgs);
    await client.close();

    const duration = Date.now() - startTime;
    logger.info(LOG_MODULES.MCP, `[Direct] MCP 工具调用完成`, {
      success: result.success,
      duration: `${duration}ms`,
      durationSeconds: (duration / 1000).toFixed(2),
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    logger.errorNoUser(LOG_MODULES.MCP, `[Direct] MCP 工具调用异常`, {
      error: errorMsg,
      duration: `${duration}ms`,
    });

    return {
      success: false,
      error: errorMsg,
      isError: true,
    };
  }
}

/**
 * 直接调用 AI4Java 的 decompileProject 工具
 * 
 * @param config AI4Java MCP 配置（从数据库获取）
 * @param projectRoot 项目根目录
 * @returns 反编译结果
 */
export async function callAi4JavaDecompileDirect(
  config: McpConfig,
  projectRoot: string
): Promise<McpToolResult> {
  logger.info(LOG_MODULES.MCP, `[Direct] 调用 AI4Java decompileProject`, {
    serverName: config.name,
    serverType: config.type,
    projectRoot,
  });

  // 参数名使用 path（MCP 工具定义的参数名）
  return callMcpToolDirect(config, 'decompileProject', { path: projectRoot });
}

/**
 * 获取 MCP 服务器工具列表
 * 
 * @param config MCP 服务器配置
 * @returns 工具列表和连接状态
 */
export async function listMcpToolsDirect(
  config: McpConfig
): Promise<{ success: boolean; tools: Array<{ name: string; description?: string; inputSchema?: any }>; error?: string }> {
  const startTime = Date.now();
  
  logger.info(LOG_MODULES.MCP, `[Direct] 获取 MCP 工具列表`, {
    serverName: config.name,
    serverType: config.type,
  });

  try {
    let client: LocalMcpClient | RemoteMcpClient;

    if (config.type === 'local') {
      if (!config.command) {
        return { success: false, tools: [], error: 'local 类型缺少 command 配置' };
      }
      client = new LocalMcpClient(config.name, {
        command: config.command,
        args: config.args,
        env: config.env,
        timeout: config.timeout || 60000,  // 测试连接默认 60 秒超时
      });
    } else if (config.type === 'remote') {
      if (!config.url) {
        return { success: false, tools: [], error: 'remote 类型缺少 url 配置' };
      }
      client = new RemoteMcpClient(config.name, {
        url: config.url,
        timeout: config.timeout || 60000,
      });
    } else {
      return { success: false, tools: [], error: `不支持的 MCP 类型: ${config.type}` };
    }

    await client.connect();
    const tools = await client.listTools();
    await client.close();

    const duration = Date.now() - startTime;
    logger.info(LOG_MODULES.MCP, `[Direct] 工具列表获取完成`, {
      success: true,
      toolCount: tools.length,
      duration: `${duration}ms`,
      durationSeconds: (duration / 1000).toFixed(2),
    });

    return { success: true, tools };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    logger.errorNoUser(LOG_MODULES.MCP, `[Direct] 工具列表获取异常`, {
      error: errorMsg,
      duration: `${duration}ms`,
    });

    return {
      success: false,
      tools: [],
      error: errorMsg,
    };
  }
}

// ========================================
// 兼容旧接口（仅支持 local）
// ========================================

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeout?: number;
}

export async function callMcpTool(
  serverName: string,
  config: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  return callMcpToolDirect(
    { name: serverName, type: 'local', ...config },
    toolName,
    args
  );
}

export async function callAi4JavaDecompile(
  serverConfig: McpServerConfig,
  projectRoot: string
): Promise<McpToolResult> {
  return callMcpToolDirect(
    { name: 'ai4java', type: 'local', ...serverConfig },
    'decompileProject',
    { projectRoot }
  );
}