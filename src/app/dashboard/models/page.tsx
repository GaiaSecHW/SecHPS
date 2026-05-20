'use client';

import { useEffect, useState } from 'react';
import {
  Cpu,
  Plus,
  Edit2,
  Trash2,
  Check,
  AlertCircle,
  Loader2,
  RefreshCw,
  Globe,
  Lock,
  Save,
  X,
  Play,
  Eye,
  EyeOff,
  User,
  Key,
  Brain,
} from 'lucide-react';

// ModelConfig 数据结构
interface ModelConfig {
  id: string;
  userId: string | null;
  userName: string | null;  // 创建者姓名
  userUsername: string | null;  // 创建者用户名
  name: string;
  providerType: 'claude' | 'openai';
  apiBaseUrl: string;
  apiKey?: string;  // 可选，仅在确认修改时使用
  hasApiKey: boolean;  // 是否有 API Key
  models: string[];
  routeType: string | null;
  maxTokens: number;      // 最大输出 token 数
  temperature: number;    // 温度参数
  isActive: boolean;
  isDefault: boolean;
  isPublic: boolean;
  contextWindow: number;  // 学习到的上下文窗口大小
  createdAt: string;
  updatedAt: string;
}

// API类型标签
const PROVIDER_TYPE_LABELS: Record<string, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
};

// 表单数据类型
interface ModelFormData {
  name: string;
  providerType: 'claude' | 'openai';
  apiBaseUrl: string;
  apiKey: string;
  models: string;
  maxTokens: number;      // 最大输出 token 数
  temperature: number;    // 温度参数
  isActive: boolean;
  isPublic: boolean;
  isSystemModel: boolean;  // 系统模型（仅管理员可设置）
  isDefault: boolean;      // 默认模型（仅系统模型可设置）
  changeApiKey: boolean;   // 确认修改 API Key
}

export default function ModelsPage() {
  const [user, setUser] = useState<any>(null);
  const [isIcsOrAdmin, setIsIcsOrAdmin] = useState(false);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 模态框状态
  const [showModal, setShowModal] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelConfig | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingModel, setDeletingModel] = useState<ModelConfig | null>(null);

  // 测试状态
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, {
    success: boolean;
    message: string;
    response?: string;      // 模型返回的内容
    usage?: {               // Token 使用量
      inputTokens: number;
      outputTokens: number;
    };
    duration?: number;      // 响应时间(ms)
    timestamp: number;
  }>>({});

  // Context Window 复位状态
  const [resettingContextWindow, setResettingContextWindow] = useState<string | null>(null);

  // 表单数据
  const [formData, setFormData] = useState<ModelFormData>({
    name: '',
    providerType: 'openai',
    apiBaseUrl: '',
    apiKey: '',
    models: '',
    maxTokens: 32000,
    temperature: 0.3,  // 默认温度 0.3
    isActive: true,
    isPublic: false,
    isSystemModel: false,
    isDefault: false,
    changeApiKey: false,
  });

  // 过滤状态
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive' | 'public'>('all');

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    }
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setIsIcsOrAdmin(payload.isIcsTenant === true || (Array.isArray(payload.roles) && payload.roles.includes('admin')));
      } catch (e) {
        console.error('解析 token 失败:', e);
      }
    }
    fetchModels();
  }, []);

  const fetchModels = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/models', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取模型列表失败');
      }

      const data = await response.json();
      // 处理 hasApiKey 字段
      setModels((data.models || []).map((m: any) => ({
        ...m,
        hasApiKey: m.hasApiKey ?? !!m.apiKey,
      })));
    } catch (err) {
      setError('加载模型列表失败');
      setTimeout(() => setError(null), 3000);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAddModal = () => {
    setEditingModel(null);
    setFormData({
      name: '',
      providerType: 'openai',
      apiBaseUrl: '',
      apiKey: '',
      models: '',
      maxTokens: 32000,
      temperature: 0.3,
      isActive: true,
      isPublic: false,
      isSystemModel: false,
      isDefault: false,
      changeApiKey: true,  // 新建时默认需要输入 API Key
    });
    setShowModal(true);
  };

  const handleOpenEditModal = (model: ModelConfig) => {
    // 只能编辑自己创建的模型，管理员可编辑所有
    if (!isIcsOrAdmin && model.userId !== user?.id && model.userId !== null) {
      setError('只能编辑自己创建的模型');
      setTimeout(() => setError(null), 3000);
      return;
    }
    
    setEditingModel(model);
    setFormData({
      name: model.name,
      providerType: model.providerType,
      apiBaseUrl: model.apiBaseUrl,
      apiKey: '',  // 编辑时不显示原有 API Key，需要确认才能修改
      models: Array.isArray(model.models) ? (model.models[0] || '') : model.models,
      maxTokens: model.maxTokens || 4096,
      temperature: model.temperature ?? 0.7,
      isActive: model.isActive,
      isPublic: model.isPublic,
      isSystemModel: model.userId === null,  // userId为null表示系统模型
      isDefault: model.isDefault,
      changeApiKey: false,  // 编辑时默认不修改 API Key
    });
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingModel(null);
    setFormData({
      name: '',
      providerType: 'openai',
      apiBaseUrl: '',
      apiKey: '',
      models: '',
      maxTokens: 32000,
      temperature: 0.3,
      isActive: true,
      isPublic: false,
      isSystemModel: false,
      isDefault: false,
      changeApiKey: false,
    });
  };

  const handleSaveModel = async () => {
    // 表单验证
    if (!formData.name || !formData.apiBaseUrl || !formData.models) {
      setError('请填写必填字段');
      setTimeout(() => setError(null), 3000);
      return;
    }

    // 新建时必须填写 API Key
    if (!editingModel && !formData.apiKey) {
      setError('请填写 API Key');
      setTimeout(() => setError(null), 3000);
      return;
    }

    // 编辑时如果确认修改 API Key，必须填写
    if (editingModel && formData.changeApiKey && !formData.apiKey) {
      setError('请填写新的 API Key');
      setTimeout(() => setError(null), 3000);
      return;
    }

    try {
      setSaving(true);
      const token = localStorage.getItem('token');

      const url = editingModel
        ? `/api/models/${editingModel.id}`
        : '/api/models';

      const method = editingModel ? 'PUT' : 'POST';

      const body = {
        name: formData.name,
        providerType: formData.providerType,
        apiBaseUrl: formData.apiBaseUrl,
        // 只有新建或确认修改时才发送 apiKey
        apiKey: !editingModel || formData.changeApiKey ? formData.apiKey : undefined,
        models: [formData.models],
        maxTokens: formData.maxTokens,
        temperature: formData.temperature,
        isActive: formData.isActive,
        isPublic: formData.isPublic,
        // 管理员专属字段
        isSystemModel: isIcsOrAdmin ? formData.isSystemModel : undefined,
        isDefault: isIcsOrAdmin && formData.isSystemModel ? formData.isDefault : undefined,
      };

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || '保存模型失败');
      }

      setSuccess(editingModel ? '模型更新成功' : '模型创建成功');
      setTimeout(() => setSuccess(null), 3000);
      handleCloseModal();
      fetchModels();
    } catch (err) {
      setError('保存模型失败');
      setTimeout(() => setError(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClick = (model: ModelConfig) => {
    // 只能删除自己创建的模型
    if (!isIcsOrAdmin && model.userId !== user?.id) {
      setError('只能删除自己创建的模型');
      setTimeout(() => setError(null), 3000);
      return;
    }
    
    setDeletingModel(model);
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingModel) return;

    try {
      setSaving(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/models/${deletingModel.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('删除模型失败');
      }

      setSuccess('模型删除成功');
      setTimeout(() => setSuccess(null), 3000);
      setShowDeleteConfirm(false);
      setDeletingModel(null);
      fetchModels();
    } catch (err) {
      setError('删除模型失败');
      setTimeout(() => setError(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleTestModel = async (model: ModelConfig) => {
    try {
      setTestingModelId(model.id);
      setError(null);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/models/${model.id}/test`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok && !data.success) {
        throw new Error(data.error || data.message || '测试失败');
      }

      setTestResults({
        ...testResults,
        [model.id]: {
          success: data.success,
          message: data.message || (data.success ? '连接成功' : '连接失败'),
          response: data.response,      // 保存模型返回的内容
          usage: data.usage,            // 保存 Token 使用量
          duration: data.duration,      // 保存响应时间
          timestamp: Date.now(),
        },
      });

      if (data.success) {
        setSuccess(`模型 "${model.name}" 连接测试成功${data.response ? `: ${data.response.substring(0, 100)}${data.response.length > 100 ? '...' : ''}` : ''}`);
        setTimeout(() => setSuccess(null), 10000);  // 延长到10秒
      } else {
        setError(data.message || '连接失败');
        setTimeout(() => setError(null), 10000);
      }
    } catch (err: any) {
      const errorMsg = err.message || '模型连接测试失败';
      setError(errorMsg);
      setTimeout(() => setError(null), 5000);
      setTestResults({
        ...testResults,
        [model.id]: {
          success: false,
          message: errorMsg,
          timestamp: Date.now(),
        },
      });
    } finally {
      setTestingModelId(null);
    }
  };

  // 复位 Context Window
  const handleResetContextWindow = async (modelId: string) => {
    try {
      setResettingContextWindow(modelId);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/models/${modelId}/reset-context-window`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('复位失败');
      setModels(models.map(m => m.id === modelId ? { ...m, contextWindow: 0 } : m));
      if (editingModel?.id === modelId) setEditingModel({ ...editingModel, contextWindow: 0 });
      setSuccess('Context Window 已复位');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message);
      setTimeout(() => setError(null), 3000);
    } finally {
      setResettingContextWindow(null);
    }
  };

  // 检查是否可以编辑/删除模型
  const canEditModel = (model: ModelConfig) => {
    return isIcsOrAdmin || model.userId === user?.id;
  };

  // 过滤模型
  const filteredModels = models.filter((model) => {
    if (filterStatus === 'active') return model.isActive;
    if (filterStatus === 'inactive') return !model.isActive;
    if (filterStatus === 'public') return model.isPublic;
    return true;
  });

  // 解析模型列表
  const parseModels = (modelsData: string[] | string): string[] => {
    if (Array.isArray(modelsData)) return modelsData;
    try {
      return JSON.parse(modelsData);
    } catch (e) {
      console.warn('[Models] Failed to parse models data:', modelsData, e);
      return [];
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
            <Brain size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">我的模型</h1>
            <p className="text-sm text-gray-400 mt-0.5">管理大模型配置，公开后其他用户也可使用</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchModels}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300 bg-dark-surface-hover border border-gray-700/50 rounded-lg hover:bg-gray-700 transition-colors"
          >
            <RefreshCw size={16} />
            刷新
          </button>
          <button
            onClick={handleOpenAddModal}
            className="group flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 bg-primary-500 text-white shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:bg-primary-400"
          >
            <Plus size={16} className="transition-transform group-hover:rotate-90 duration-200" />
            添加模型
          </button>
        </div>
      </div>

      {/* Success/Error Messages */}
      {success && (
        <div className="bg-green-900/20 border border-green-800/40 text-green-300 px-4 py-3 rounded-md flex items-start gap-2">
          <Check className="h-5 w-5 flex-shrink-0 mt-0.5" />
          <pre className="whitespace-pre-wrap text-sm font-mono overflow-auto max-h-60">{success}</pre>
        </div>
      )}

      {error && (
        <div className="bg-red-900/20 border border-red-800/40 text-red-300 px-4 py-3 rounded-md flex items-start gap-2">
          <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
          <pre className="whitespace-pre-wrap text-sm font-mono">{error}</pre>
        </div>
      )}

      {/* 模型列表 */}
      <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-100">
            {isIcsOrAdmin ? '所有模型配置' : '我的模型配置'}
          </h2>
          <div className="flex items-center gap-3">
            {/* 过滤器 */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="w-[100px] px-3 py-2 border border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">全部</option>
              <option value="active">启用</option>
              <option value="inactive">禁用</option>
              <option value="public">公开</option>
            </select>
          </div>
        </div>

        {/* 表格 */}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-700/50">
            <thead className="bg-[#162032]">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  名称
                </th>
                {isIcsOrAdmin && (
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[120px] w-[120px]">
                    创建者
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[120px] w-[120px]">
                  代理类型
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  API 地址
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[200px]">
                  模型列表
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px] w-[100px]">
                  状态
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px] w-[100px]">
                  公开
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px] w-[100px]">
                  连接状态
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-dark-surface divide-y divide-gray-700/50">
              {filteredModels.length === 0 ? (
                <tr>
                  <td colSpan={isIcsOrAdmin ? 9 : 8} className="px-4 py-8 text-center text-gray-500">
                    暨无模型配置，点击"添加模型"创建您的第一个模型
                  </td>
                </tr>
              ) : (
                filteredModels.map((model) => {
                  const modelList = parseModels(model.models);
                  const isOwner = model.userId === user?.id || model.userId === null;
                  return (
                    <tr key={model.id} className="hover:bg-[#0F172A]">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2 overflow-hidden">
                          <Cpu size={16} className="text-gray-400 shrink-0" />
                          <span className="font-medium text-gray-100 truncate" title={model.name}>{model.name}</span>
                          {model.isDefault && (
                            <span className="px-1.5 py-0.5 text-xs font-medium bg-orange-500/15 text-orange-400 rounded shrink-0">
                              默认
                            </span>
                          )}
                          {model.userId === null && (
                            <span className="text-xs text-gray-500 shrink-0">(系统)</span>
                          )}
                        </div>
                      </td>
                      {isIcsOrAdmin && (
                        <td className="px-4 py-4 min-w-[120px] w-[120px]">
                          <div className="flex items-center gap-2">
                            <User size={16} className="text-gray-400" />
                            {model.userId === null ? (
                              <span className="text-sm text-gray-400">系统模型</span>
                            ) : (
                              <span className="text-sm text-gray-400 truncate">
                                {model.userName || model.userUsername || '未知用户'}
                              </span>
                            )}
                          </div>
                        </td>
                      )}
                      <td className="px-4 py-4 min-w-[120px] w-[120px]">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          model.providerType === 'claude'
                            ? 'bg-purple-500/15 text-purple-400'
                            : 'bg-green-500/15 text-green-400'
                        }`}>
                          {PROVIDER_TYPE_LABELS[model.providerType] || model.providerType}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <Globe size={16} className="text-gray-400" />
                          <span className="text-sm text-gray-400 font-mono max-w-xs truncate">
                            {model.apiBaseUrl}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4 min-w-[200px]">
                        <div className="flex flex-wrap gap-1 overflow-hidden" title={modelList.join(', ')}>
                          {modelList.slice(0, 3).map((m, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 bg-dark-surface-hover text-gray-300 text-xs rounded"
                            >
                              {m}
                            </span>
                          ))}
                          {modelList.length > 3 && (
                            <span className="text-xs text-gray-500">
                              +{modelList.length - 3}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 min-w-[100px] w-[100px]">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${
                            model.isActive
                              ? 'bg-green-500/15 text-green-400'
                              : 'bg-dark-surface-hover text-gray-200'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              model.isActive ? 'bg-green-600' : 'bg-[#0F172A]0'
                            }`}
                          />
                          {model.isActive ? '启用' : '禁用'}
                        </span>
                      </td>
                      <td className="px-4 py-4 min-w-[100px] w-[100px]">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${
                            model.isPublic
                              ? 'bg-blue-500/15 text-blue-400'
                              : 'bg-dark-surface-hover text-gray-400'
                          }`}
                        >
                          {model.isPublic ? <Globe size={12} /> : <Lock size={12} />}
                          {model.isPublic ? '公开' : '私有'}
                        </span>
                      </td>
                      <td className="px-4 py-4 min-w-[100px] w-[100px]">
                        {testResults[model.id] ? (
                          <div className="space-y-1">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${
                                testResults[model.id].success
                                  ? 'bg-green-500/15 text-green-400'
                                  : 'bg-red-500/15 text-red-400'
                              }`}
                            >
                              {testResults[model.id].success ? (
                                <Check size={12} />
                              ) : (
                                <AlertCircle size={12} />
                              )}
                              {testResults[model.id].success ? '正常' : '异常'}
                              {testResults[model.id].duration && (
                                <span className="ml-1 text-gray-500">({testResults[model.id].duration}ms)</span>
                              )}
                            </span>
                            {testResults[model.id].response && (
                              <div className="mt-1 p-2 bg-[#0F172A] rounded text-xs text-gray-300 max-w-xs overflow-hidden">
                                <div className="font-medium text-gray-500 mb-1">模型响应:</div>
                                <div className="break-words">{testResults[model.id].response}</div>
                                {testResults[model.id].usage && (
                                  <div className="mt-1 text-gray-400">
                                    Token: {testResults[model.id].usage!.inputTokens} + {testResults[model.id].usage!.outputTokens}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">未测试</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleTestModel(model)}
                            disabled={testingModelId === model.id}
                            className={`p-1.5 rounded-md transition-colors ${
                              testingModelId === model.id
                                ? 'text-blue-400 bg-blue-600/10 cursor-wait'
                                : 'text-gray-400 hover:text-green-400 hover:bg-green-600/100/10'
                            }`}
                            title="测试连接"
                          >
                            {testingModelId === model.id ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <Play size={16} />
                            )}
                          </button>
                          {canEditModel(model) && (
                            <button
                              onClick={() => handleOpenEditModal(model)}
                              className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-blue-600/100/100/10 rounded-md transition-colors"
                              title="编辑"
                            >
                              <Edit2 size={16} />
                            </button>
                          )}
                          {canEditModel(model) && (
                            <button
                              onClick={() => handleDeleteClick(model)}
                              className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-600/100/100/10 rounded-md transition-colors"
                              title="删除"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 添加/编辑模型模态框 */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-surface rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-700/50">
              <h3 className="text-lg font-semibold text-gray-100">
                {editingModel ? '编辑模型' : '添加模型'}
              </h3>
              <button
                onClick={handleCloseModal}
                className="p-1 text-gray-400 hover:text-gray-400 hover:bg-dark-surface-hover rounded-md transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* 名称 */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="例如：内部大模型 或 Claude"
                />
              </div>

              {/* API类型 */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  API类型 <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.providerType}
                  onChange={(e) => {
                    const providerType = e.target.value as 'claude' | 'openai';
                    const defaultBaseUrl = providerType === 'claude'
                      ? ''  // Claude 原生需要用户手动填写 apiBaseUrl
                      : formData.apiBaseUrl;
                    setFormData({ ...formData, providerType, apiBaseUrl: formData.apiBaseUrl || defaultBaseUrl });
                  }}
                  className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="openai">OpenAI</option>
                  <option value="claude">Claude</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {formData.providerType === 'claude'
                    ? '直接调用 Anthropic Claude API，无需格式转换'
                    : '调用内部大模型，需要 Anthropic ↔ OpenAI 格式转换'}
                </p>
              </div>

              {/* API 地址 */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  API 地址 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.apiBaseUrl}
                  onChange={(e) => setFormData({ ...formData, apiBaseUrl: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                  placeholder={formData.providerType === 'claude'
                    ? '请输入 Claude API 地址（如 https://api.anthropic.com/v1/messages）'
                    : 'http://192.168.1.100:8000/v1/chat/completions'}
                />
              </div>

              {/* API Key */}
              <div>
                {/* 新建时直接显示输入框 */}
                {!editingModel ? (
                  <>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      API Key <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      value={formData.apiKey}
                      onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                      placeholder="输入 API Key"
                    />
                  </>
                ) : (
                  <>
                    {/* 编辑时需要确认才能修改 */}
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Key size={16} className="text-gray-400" />
                        <span className="text-sm text-gray-300">
                          API Key: {editingModel.hasApiKey ? (
                            <span className="text-green-400 font-medium">已设置</span>
                          ) : (
                            <span className="text-red-400 font-medium">未设置</span>
                          )}
                        </span>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.changeApiKey}
                          onChange={(e) => setFormData({ ...formData, changeApiKey: e.target.checked })}
                          className="w-4 h-4 text-orange-600 border-gray-600 rounded focus:ring-orange-500"
                        />
                        <span className="text-sm text-orange-400 font-medium">修改</span>
                      </label>
                    </div>

                    {formData.changeApiKey && (
                      <div className="mt-2">
                        <input
                          type="password"
                          value={formData.apiKey}
                          onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                          className="w-full px-3 py-2 border border-orange-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono text-sm"
                          placeholder="输入新的 API Key"
                        />
                        <p className="text-xs text-orange-400 mt-1">
                          请输入新的 API Key，原有 Key 将被替换
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* 模型名称 */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  模型名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.models}
                  onChange={(e) => setFormData({ ...formData, models: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="例如：gpt-4、claude-3-opus-20240229"
                />
                <p className="text-xs text-gray-500 mt-1">
                  输入单个模型名称
                </p>
              </div>

              {/* 高级参数 */}
              <div className="grid grid-cols-2 gap-4">
                {/* 最大输出 Token */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    最大输出 Token
                  </label>
                  <input
                    type="number"
                    value={formData.maxTokens}
                    onChange={(e) => setFormData({ ...formData, maxTokens: parseInt(e.target.value) || 32000 })}
                    className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    min={256}
                    max={192000}
                    step={256}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    默认 32000，建议 4096-32000
                  </p>
                </div>

                {/* 温度参数 */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    温度 (Temperature)
                  </label>
                  <input
                    type="number"
                    value={formData.temperature}
                    onChange={(e) => setFormData({ ...formData, temperature: parseFloat(e.target.value) || 0.7 })}
                    className="w-full px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    min={0}
                    max={2}
                    step={0.1}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    默认 0.3，越高越随机
                  </p>
                </div>
              </div>

              {/* Context Window - 只读显示（仅编辑模式） */}
              {editingModel && (
                <div className="bg-dark-bg border border-gray-700/50 rounded-md px-3 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-medium text-gray-300">Context Window</span>
                    <span className="text-sm text-gray-100">{editingModel?.contextWindow ?? 0} tokens</span>
                    <span className="text-xs text-gray-500">
                      {editingModel?.contextWindow > 0 ? '已学习' : '未设置，调用超限时自动学习'}
                    </span>
                  </div>
                  {editingModel?.contextWindow > 0 && (
                    <button 
                      onClick={() => handleResetContextWindow(editingModel.id)} 
                      disabled={resettingContextWindow === editingModel.id}
                      className="h-7 px-2 text-xs text-orange-400 bg-orange-600/10 border border-orange-500/20 rounded-md hover:bg-orange-600/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {resettingContextWindow === editingModel.id ? '复位中...' : '复位'}
                    </button>
                  )}
                </div>
              )}

              {/* 开关 */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.isActive}
                      onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                      className="w-4 h-4 text-blue-400 border-gray-600 rounded focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-300">启用</span>
                  </label>

                  {isIcsOrAdmin && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.isPublic}
                        onChange={(e) => setFormData({ ...formData, isPublic: e.target.checked })}
                        className="w-4 h-4 text-blue-400 border-gray-600 rounded focus:ring-primary-500"
                      />
                      <span className="text-sm text-gray-300">公开（跨租户共享）</span>
                    </label>
                  )}
                </div>

                {/* 管理员专属选项 */}
                {isIcsOrAdmin && (
                  <div className="flex items-center gap-6 pt-2 border-t border-gray-700/50">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.isSystemModel}
                        onChange={(e) => setFormData({ ...formData, isSystemModel: e.target.checked, isDefault: e.target.checked ? formData.isDefault : false })}
                        className="w-4 h-4 text-purple-600 border-gray-600 rounded focus:ring-purple-500"
                      />
                      <span className="text-sm text-purple-400 font-medium">系统模型（所有用户可见）</span>
                    </label>

                    {formData.isSystemModel && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.isDefault}
                          onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                          className="w-4 h-4 text-orange-600 border-gray-600 rounded focus:ring-orange-500"
                        />
                        <span className="text-sm text-orange-400 font-medium">默认模型</span>
                      </label>
                    )}
                  </div>
                )}
              </div>

              {formData.isPublic && (
                <div className="bg-blue-900/20 border border-blue-800/40 rounded-md p-3">
                  <p className="text-sm text-blue-300">
                    <Globe size={16} className="inline mr-1" />
                    公开的模型将出现在所有用户的评估模型选择列表中。请确保 API Key 安全。
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-700/50">
              <button
                onClick={handleCloseModal}
                className="px-4 py-2 text-gray-300 bg-dark-surface-hover rounded-md hover:bg-gray-700 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSaveModel}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    <Save size={16} />
                    保存
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认对话框 */}
      {showDeleteConfirm && deletingModel && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-surface rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <AlertCircle className="h-6 w-6 text-red-500" />
                <h3 className="text-lg font-semibold text-gray-100">
                  认删除
                </h3>
              </div>
              <p className="text-gray-400 mb-6">
                确定要删除模型 <span className="font-semibold">{deletingModel.name}</span> 吗？
                此操作无法撤销。
              </p>
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeletingModel(null);
                  }}
                  className="px-4 py-2 text-gray-300 bg-dark-surface-hover rounded-md hover:bg-gray-700 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
                >
                  {saving ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      删除中...
                    </>
                  ) : (
                    <>
                      <Trash2 size={16} />
                      删除
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}