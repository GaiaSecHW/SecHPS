/**
 * 插件系统类型定义
 */

// 插件类型
export type PluginType = 'ui-tab' | 'backend-service' | 'integration' | 'tool';

// 插件状态
export type PluginStatus = 'active' | 'inactive' | 'error';

// 插件信息（数据库模型）
export interface Plugin {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  author: string;
  type: PluginType;
  status: PluginStatus;
  config?: Record<string, any>;
  pluginPath?: string;
  isEnabled: boolean;
  isBuiltin: boolean;
  icon?: string;
  homepage?: string;
  repository?: string;
  createdAt: string;
  updatedAt: string;
}

// 插件清单（用于安装）
export interface PluginManifest {
  name: string;
  displayName: string;
  description: string;
  version: string;
  author: string;
  type: PluginType;
  main: string;
  icon?: string;
  homepage?: string;
  repository?: string;
  configSchema?: Record<string, any>;
  dependencies?: string[];
}

// 插件配置 Schema
export interface PluginConfigSchema {
  type: 'object';
  properties: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    title: string;
    description?: string;
    default?: any;
    required?: boolean;
    enum?: string[];
  }>;
  required?: string[];
}

// 插件 API 响应
export interface PluginResponse {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  author: string;
  type: PluginType;
  status: PluginStatus;
  config?: Record<string, any>;
  isEnabled: boolean;
  isBuiltin: boolean;
  icon?: string;
  homepage?: string;
  repository?: string;
  createdAt: string;
  updatedAt: string;
}

// 插件列表响应
export interface PluginListResponse {
  plugins: PluginResponse[];
  total: number;
}

// 安装插件请求
export interface InstallPluginRequest {
  manifest: PluginManifest;
  pluginPath?: string;
}

// 切换插件状态请求
export interface TogglePluginRequest {
  enabled: boolean;
}

// 更新插件配置请求
export interface UpdatePluginConfigRequest {
  config: Record<string, any>;
}

// 插件执行上下文
export interface PluginExecutionContext {
  projectId?: string;
  evaluationId?: string;
  userId: string;
  config?: Record<string, any>;
  env?: Record<string, string>;
}

// 插件执行结果
export interface PluginExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  duration: number; // 执行时长（毫秒）
  logs?: string[];
}

// 插件执行器接口
export interface PluginExecutor {
  type: PluginType;
  execute(
    plugin: PluginResponse,
    context: PluginExecutionContext
  ): Promise<PluginExecutionResult>;
  validate(plugin: PluginResponse): Promise<boolean>;
  load(plugin: PluginResponse): Promise<void>;
  unload(plugin: PluginResponse): Promise<void>;
}

// 插件安装源
export interface PluginInstallSource {
  type: 'local' | 'url' | 'npm';
  path?: string; // 本地路径
  url?: string;  // 远程 URL
  package?: string; // npm 包名
}

// 安装插件请求（扩展）
export interface InstallPluginFromUrlRequest {
  url: string; // 插件 manifest.json 的 URL 或压缩包 URL
  name?: string; // 可选：指定插件名称
}

// 插件运行时状态
export interface PluginRuntimeState {
  pluginId: string;
  status: 'idle' | 'loading' | 'running' | 'error' | 'unloaded';
  lastExecution?: Date;
  executionCount: number;
  errorCount: number;
  lastError?: string;
}
