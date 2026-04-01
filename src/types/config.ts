// Configuration types for AI4WEB 测试平台

export interface MCPServer {
  id: string;
  name: string;
  type: 'local' | 'remote';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  isActive: boolean;
  createdAt?: string;
}

export interface ModelPreference {
  id: string;
  provider: string; // e.g., 'openai', 'anthropic', 'local'
  model: string;
  isDefault: boolean;
  settings?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    [key: string]: any;
  };
}

export interface OpencodeConfig {
  id: string;
  userId: string;
  name: string;
  baseURL: string;
  projectUploadDir?: string;
  taskDescription?: string; // 任务描述（Markdown格式）
  description?: string;
  isActive: boolean;
  mcpServers?: MCPServer[];
  modelPreferences?: string; // 格式: "providerID/modelID"
  createdAt: string;
  updatedAt: string;
}

export interface CreateConfigRequest {
  name: string;
  baseURL?: string;
  projectUploadDir?: string;
  taskDescription?: string;
  description?: string;
  isActive?: boolean;
  mcpServers?: MCPServer[];
  modelPreferences?: string; // 格式: "providerID/modelID"
}

export interface UpdateConfigRequest extends Partial<CreateConfigRequest> {
  id: string;
}

export interface ConfigFormData {
  name: string;
  baseURL: string;
  projectUploadDir?: string;
  taskDescription?: string;
  description: string;
  isActive: boolean;
  mcpServers: MCPServer[];
  modelPreferences?: string; // 格式: "providerID/modelID"
}

export type ConfigModalMode = 'create' | 'edit';

export interface ConfigModalState {
  isOpen: boolean;
  mode: ConfigModalMode;
  config?: OpencodeConfig;
}
