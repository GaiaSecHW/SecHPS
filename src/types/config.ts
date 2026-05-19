// Configuration types for SecHPS 测试平台

export interface MCPServer {
  id: string;
  name: string;
  type: 'local' | 'sse' | 'http';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  isActive: boolean;
  createdAt?: string;
}

export interface ModelPreference {
  id: string;
  provider: string;
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
  taskDescription?: string;
  description?: string;
  isActive: boolean;
  modelPreferences?: string;
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
  modelPreferences?: string;
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
  modelPreferences?: string;
}

export type ConfigModalMode = 'create' | 'edit';

export interface ConfigModalState {
  isOpen: boolean;
  mode: ConfigModalMode;
  config?: OpencodeConfig;
}
