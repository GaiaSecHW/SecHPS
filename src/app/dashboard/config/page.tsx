'use client';

import { useEffect, useState } from 'react';
import {
  Settings,
  Save,
  Cpu,
  Server,
  Check,
  AlertCircle,
  Loader2,
  RefreshCw,
  FolderOpen,
  FileText,
} from 'lucide-react';
import { PERMISSIONS } from '@/types/permissions';

// OpenCode 提供商和模型类型
interface OpenCodeModel {
  id: string;
  name: string;
  contextLimit: number;
  outputLimit: number;
  supportsAttachment: boolean;
  supportsReasoning: boolean;
  supportsTemperature: boolean;
  supportsToolCall: boolean;
  cost?: {
    input: number;
    output: number;
    cache_read?: number;
    cache_write?: number;
  };
}

interface OpenCodeProvider {
  id: string;
  name: string;
  models: OpenCodeModel[];
}

interface OpenCodeConfigInfo {
  model?: string;
  smallModel?: string;
  mcpServers: { name: string; type: 'local' | 'remote'; enabled: boolean }[];
  theme?: string;
  username?: string;
  autoupdate?: boolean;
}

interface Config {
  id: string;
  name: string;
  projectUploadDir: string | null;
  taskDescription: string | null;
  modelPreferences: string | null;
  workflowConfig: string | null;
  isActive: boolean;
}

export default function ConfigPage() {
  const [user, setUser] = useState<any>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 表单数据
  const [projectUploadDir, setProjectUploadDir] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  
  // 工作流配置
  const [startNodeLabel, setStartNodeLabel] = useState('开始');
  const [startNodeDescription, setStartNodeDescription] = useState('工作流的起始点');
  const [endNodeLabel, setEndNodeLabel] = useState('结束');
  const [endNodeDescription, setEndNodeDescription] = useState('工作流的结束点');

  // OpenCode 数据
  const [providers, setProviders] = useState<OpenCodeProvider[]>([]);
  const [openCodeConfig, setOpenCodeConfig] = useState<OpenCodeConfigInfo | null>(null);
  const [loadingProviders, setLoadingProviders] = useState(false);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    }
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/config', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取配置失败');
      }

      const data = await response.json();
      const activeConfig = data.configs.find((c: any) => c.isActive);
      
      if (activeConfig) {
        setConfig(activeConfig);
        setProjectUploadDir(activeConfig.projectUploadDir || '');
        setTaskDescription(activeConfig.taskDescription || '');
        setSelectedModel(activeConfig.modelPreferences || '');
        
        // 解析工作流配置
        if (activeConfig.workflowConfig) {
          try {
            const workflowConfig = JSON.parse(activeConfig.workflowConfig);
            setStartNodeLabel(workflowConfig.startNodeLabel || '开始');
            setStartNodeDescription(workflowConfig.startNodeDescription || '工作流的起始点');
            setEndNodeLabel(workflowConfig.endNodeLabel || '结束');
            setEndNodeDescription(workflowConfig.endNodeDescription || '工作流的结束点');
          } catch (e) {
            console.error('Failed to parse workflow config:', e);
          }
        }
      }
    } catch (err) {
      setError('加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  const hasPermission = (permission: string) => {
    return user?.permissions?.includes(permission) || user?.roles?.includes('admin');
  };

  // 从 OpenCode 获取可用模型和当前配置
  const fetchOpenCodeData = async () => {
    try {
      setLoadingProviders(true);
      const token = localStorage.getItem('token');

      // 获取可用模型
      const providersResponse = await fetch('/api/opencode/providers', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (providersResponse.ok) {
        const data = await providersResponse.json();
        setProviders(data.providers || []);
      }

      // 获取当前配置（包括 MCP 服务器）
      const configResponse = await fetch('/api/opencode/config', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (configResponse.ok) {
        const data = await configResponse.json();
        setOpenCodeConfig(data);
        // 如果有默认模型，设置到 formData
        if (data.model && !selectedModel) {
          setSelectedModel(data.model);
        }
      }

      setSuccess('成功获取模型列表和配置信息');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to fetch OpenCode data:', err);
      setError('获取模型列表失败，请确保 OpenCode 服务正在运行');
      setTimeout(() => setError(null), 5000);
    } finally {
      setLoadingProviders(false);
    }
  };

  const handleSave = async () => {
    if (!config) {
      setError('未找到配置');
      return;
    }

    try {
      setSaving(true);
      const token = localStorage.getItem('token');
      
      // 构建工作流配置
      const workflowConfig = JSON.stringify({
        startNodeLabel,
        startNodeDescription,
        endNodeLabel,
        endNodeDescription,
      });
      
      const response = await fetch(`/api/config/${config.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectUploadDir,
          taskDescription,
          modelPreferences: selectedModel,
          workflowConfig,
        }),
      });

      if (!response.ok) {
        throw new Error('保存配置失败');
      }

      setSuccess('配置保存成功');
      fetchConfig();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('保存配置失败');
      setTimeout(() => setError(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  // 获取所有可用模型的扁平列表
  const getAllModels = () => {
    const models: { providerId: string; providerName: string; modelId: string; modelName: string }[] = [];
    providers.forEach(provider => {
      provider.models.forEach(model => {
        models.push({
          providerId: provider.id,
          providerName: provider.name || provider.id,
          modelId: model.id,
          modelName: model.name || model.id,
        });
      });
    });
    return models;
  };

  if (!hasPermission(PERMISSIONS.CONFIG_READ)) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            访问被拒绝
          </h2>
          <p className="text-gray-600">
            您没有查看配置的权限。
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            未找到配置
          </h2>
          <p className="text-gray-600">
            请联系管理员创建默认配置。
          </p>
        </div>
      </div>
    );
  }

  const allModels = getAllModels();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Settings className="h-6 w-6" />
            配置管理
          </h1>
          <p className="text-gray-600 mt-1">
            管理您的 OpenCode 配置
          </p>
        </div>
        {hasPermission(PERMISSIONS.CONFIG_UPDATE) && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Save size={18} />
                保存配置
              </>
            )}
          </button>
        )}
      </div>

      {/* Success/Error Messages */}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-md flex items-center gap-2">
          <Check className="h-5 w-5" />
          {success}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      )}

      {/* Configuration Form */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
        {/* Model Selection */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
              <Cpu size={20} />
              模型选择
            </h3>
            <button
              onClick={fetchOpenCodeData}
              disabled={loadingProviders}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 transition-colors disabled:opacity-50"
              title="从 OpenCode 服务获取模型列表"
            >
              <RefreshCw size={14} className={loadingProviders ? 'animate-spin' : ''} />
              获取模型列表
            </button>
          </div>

          {loadingProviders && (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
              <Loader2 size={16} className="animate-spin" />
              正在从 OpenCode 服务获取可用模型...
            </div>
          )}

          {!loadingProviders && providers.length === 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 text-sm text-yellow-700">
              点击"获取模型列表"按钮从 OpenCode 服务获取可用模型
            </div>
          )}

          {providers.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                选择模型
              </label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- 请选择模型 --</option>
                {providers.map(provider => (
                  <optgroup key={provider.id} label={provider.name || provider.id}>
                    {provider.models.map(model => (
                      <option key={`${provider.id}/${model.id}`} value={`${provider.id}/${model.id}`}>
                        {model.name || model.id}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                选择启动项目评估时使用的模型
              </p>
            </div>
          )}

          {selectedModel && (
            <div className="bg-gray-50 rounded-md p-3">
              <p className="text-sm text-gray-600">
                当前选择：<span className="font-mono font-medium text-gray-900">{selectedModel}</span>
              </p>
            </div>
          )}
        </div>

        {/* Project Upload Directory */}
        <div className="space-y-4 border-t border-gray-200 pt-6">
          <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
            <FolderOpen size={20} />
            项目上传目录
          </h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              目录路径
            </label>
            <input
              type="text"
              value={projectUploadDir}
              onChange={(e) => setProjectUploadDir(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="例如 /data/projects 或 D:\projects"
            />
            <p className="text-xs text-gray-500 mt-1">
              项目文件将上传到此目录，每个项目会创建一个独立的子目录
            </p>
          </div>
        </div>

        {/* Task Description */}
        <div className="space-y-4 border-t border-gray-200 pt-6">
          <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
            <FileText size={20} />
            任务描述
          </h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              描述内容
            </label>
            <textarea
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              rows={10}
              placeholder="在此输入任务描述，支持 Markdown 格式。&#10;&#10;例如：&#10;# 任务要求&#10;- 分析项目代码结构&#10;- 找出潜在的安全问题&#10;- 提供优化建议"
            />
            <p className="text-xs text-gray-500 mt-1">
              此描述将作为项目评估时发送给 AI 的第一个消息
            </p>
          </div>
        </div>

        {/* MCP Servers */}
        {openCodeConfig && openCodeConfig.mcpServers.length > 0 && (
          <div className="space-y-4 border-t border-gray-200 pt-6">
            <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
              <Server size={20} />
              MCP 服务器
            </h3>
            <p className="text-sm text-gray-500">
              以下 MCP 服务器由 OpenCode 服务端配置，在此仅展示不可编辑
            </p>
            <div className="bg-gray-50 rounded-md p-3 space-y-2">
              {openCodeConfig.mcpServers.map((server, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between text-sm py-1"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        server.enabled ? 'bg-green-500' : 'bg-gray-400'
                      }`}
                    />
                    <span className="text-gray-700">{server.name}</span>
                  </div>
                  <span className="text-gray-500 text-xs">{server.type}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Save Button (Bottom) */}
      {hasPermission(PERMISSIONS.CONFIG_UPDATE) && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Save size={18} />
                保存配置
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
