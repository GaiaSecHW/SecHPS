// src/types/tool.ts

/**
 * 工具分类
 */
export type ToolCategory = 'file' | 'code' | 'security' | 'network' | 'system';

/**
 * 工具执行器类型
 */
export type ToolExecutor = 'http' | 'script' | 'builtin' | 'mcp';

/**
 * 工具参数定义
 */
export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
  properties?: Record<string, ToolParameter>;
}

/**
 * 工具参数 Schema
 */
export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, ToolParameter>;
  required?: string[];
}

/**
 * 工具执行器配置 - HTTP
 */
export interface HTTPExecutorConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * 工具执行器配置 - Script
 */
export interface ScriptExecutorConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

/**
 * 工具执行器配置 - MCP
 */
export interface MCPExecutorConfig {
  serverName: string;
  toolName: string;
}

/**
 * 工具执行器配置联合类型
 */
export type ToolExecutorConfig = 
  | HTTPExecutorConfig 
  | ScriptExecutorConfig 
  | MCPExecutorConfig
  | null;

/**
 * 工具信息（前端显示）
 */
export interface Tool {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: ToolCategory;
  parameters: ToolParameterSchema;
  executor: ToolExecutor;
  executorConfig: ToolExecutorConfig;
  requiresPermission: boolean;
  allowedInSandbox: boolean;
  isActive: boolean;
  isBuiltin: boolean;
  timeout: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 创建工具请求
 */
export interface CreateToolRequest {
  name: string;
  displayName: string;
  description: string;
  category: ToolCategory;
  parameters: ToolParameterSchema;
  executor: ToolExecutor;
  executorConfig?: ToolExecutorConfig;
  requiresPermission?: boolean;
  allowedInSandbox?: boolean;
  timeout?: number;
}

/**
 * 更新工具请求
 */
export interface UpdateToolRequest {
  displayName?: string;
  description?: string;
  category?: ToolCategory;
  parameters?: ToolParameterSchema;
  executor?: ToolExecutor;
  executorConfig?: ToolExecutorConfig;
  requiresPermission?: boolean;
  allowedInSandbox?: boolean;
  isActive?: boolean;
  timeout?: number;
}

/**
 * 工具执行请求
 */
export interface ExecuteToolRequest {
  parameters: Record<string, unknown>;
  projectId?: string;
}

/**
 * 工具执行结果
 */
export interface ExecuteToolResult {
  success: boolean;
  output?: unknown;
  error?: string;
  duration?: number;
}

/**
 * 工具验证请求
 */
export interface ValidateToolRequest {
  parameters: Record<string, unknown>;
}

/**
 * 工具验证结果
 */
export interface ValidateToolResult {
  valid: boolean;
  errors?: Array<{
    field: string;
    message: string;
  }>;
}

/**
 * 工具分类标签
 */
export const TOOL_CATEGORY_LABELS: Record<ToolCategory, string> = {
  file: '文件操作',
  code: '代码分析',
  security: '安全检测',
  network: '网络请求',
  system: '系统命令',
};

/**
 * 工具执行器标签
 */
export const TOOL_EXECUTOR_LABELS: Record<ToolExecutor, string> = {
  http: 'HTTP 请求',
  script: '脚本执行',
  builtin: '内置函数',
  mcp: 'MCP 工具',
};
