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
  Key,
  List,
  Save,
  X,
  Play,
} from 'lucide-react';

// ModelConfig 数据结构
interface ModelConfig {
  id: string;
  name: string;
  providerType: 'claude' | 'openai';
  apiBaseUrl: string;
  apiKey: string;
  models: string[];  // 解析后的数组
  routeType: string | null;  // 路由类型：default, think, background, longContext, webSearch
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

// 代理类型标签
const PROVIDER_TYPE_LABELS: Record<string, string> = {
  claude: 'Claude API',
  openai: 'OpenAI API',
};

// 路由类型映射
const ROUTE_TYPE_OPTIONS = [
  { value: 'default', label: '默认路由' },
  { value: 'think', label: '思考模型' },
  { value: 'background', label: '后台任务' },
  { value: 'longContext', label: '长上下文' },
  { value: 'webSearch', label: '网络搜索' },
];

// 表单数据类型
interface ModelFormData {
  name: string;
  providerType: 'claude' | 'openai';
  apiBaseUrl: string;
  apiKey: string;
  models: string;
  routeType: string;
  isActive: boolean;
  isDefault: boolean;
}

export default function ModelsPage() {
  const [user, setUser] = useState<any>(null);
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
    timestamp: number;
    response?: string;
  }>>({});

  // 表单数据
  const [formData, setFormData] = useState<ModelFormData>({
    name: '',
    providerType: 'openai',
    apiBaseUrl: '',
    apiKey: '',
    models: '',
    routeType: '',
    isActive: true,
    isDefault: false,
  });

  // 过滤状态
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    }
    fetchModels();
  }, []);

  const fetchModels = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/models', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取模型列表失败');
      }

      const data = await response.json();
      setModels(data.models || []);
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
      routeType: '',
      isActive: true,
      isDefault: false,
    });
    setShowModal(true);
  };

  const handleOpenEditModal = (model: ModelConfig) => {
    setEditingModel(model);
    setFormData({
      name: model.name,
      providerType: model.providerType,
      apiBaseUrl: model.apiBaseUrl,
      apiKey: model.apiKey,
      // models 是数组，取第一个元素作为字符串
      models: Array.isArray(model.models) ? (model.models[0] || '') : model.models,
      routeType: model.routeType || '',
      isActive: model.isActive,
      isDefault: model.isDefault,
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
      routeType: '',
      isActive: true,
      isDefault: false,
    });
  };

  const handleSaveModel = async () => {
    // 表单验证
    if (!formData.name || !formData.apiBaseUrl || !formData.apiKey || !formData.models) {
      setError('请填写必填字段');
      setTimeout(() => setError(null), 3000);
      return;
    }

    try {
      setSaving(true);
      const token = localStorage.getItem('token');

      const url = editingModel
        ? `/api/admin/models/${editingModel.id}`
        : '/api/admin/models';

      const method = editingModel ? 'PUT' : 'POST';

      // 将模型名称作为单元素数组发送
      const body = {
        name: formData.name,
        providerType: formData.providerType,
        apiBaseUrl: formData.apiBaseUrl,
        apiKey: formData.apiKey,
        models: [formData.models],  // 单个模型名称转为数组
        routeType: formData.providerType === 'openai' ? formData.routeType || undefined : undefined,
        isActive: formData.isActive,
        isDefault: formData.isDefault,
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
    setDeletingModel(model);
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingModel) return;

    try {
      setSaving(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/admin/models/${deletingModel.id}`, {
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
      const response = await fetch(`/api/admin/models/${model.id}/test`, {
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
          timestamp: Date.now(),
          response: data.response?.body,
        },
      });

      if (data.success) {
        const responseInfo = data.response?.body 
          ? `\n\n响应内容:\n${data.response.body.substring(0, 500)}`
          : '';
        setSuccess(`模型 "${model.name}" 连接测试成功${responseInfo}`);
        setTimeout(() => setSuccess(null), 5000);
      } else {
        // 构建详细的错误信息
        let errorMsg = data.message || '连接失败';
        if (data.url) {
          errorMsg += `\n\n请求地址: ${data.url}`;
        }
        if (data.error) {
          errorMsg += `\n\n${data.error}`;
        }
        if (data.details) {
          errorMsg += `\n\n响应内容:\n${data.details}`;
        }
        setError(errorMsg);
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

  // 过滤模型
  const filteredModels = models.filter((model) => {
    if (filterStatus === 'active') return model.isActive;
    if (filterStatus === 'inactive') return !model.isActive;
    return true;
  });

  // 解析模型列表
  const parseModels = (modelsData: string[] | string): string[] => {
    if (Array.isArray(modelsData)) return modelsData;
    try {
      return JSON.parse(modelsData);
    } catch (e) {
      // JSON解析失败，返回空数组
      console.warn('[Models] Failed to parse models data:', modelsData, e);
      return [];
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Cpu className="h-6 w-6" />
            模型管理
          </h1>
          <p className="text-gray-600 mt-1">
            管理大模型配置和路由设置
          </p>
        </div>
        <button
          onClick={fetchModels}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
        >
          <RefreshCw size={16} />
          刷新
        </button>
      </div>

      {/* Success/Error Messages */}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-md flex items-start gap-2">
          <Check className="h-5 w-5 flex-shrink-0 mt-0.5" />
          <pre className="whitespace-pre-wrap text-sm font-mono overflow-auto max-h-60">{success}</pre>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md flex items-start gap-2">
          <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
          <pre className="whitespace-pre-wrap text-sm font-mono">{error}</pre>
        </div>
      )}

      {/* 模型列表 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">模型配置</h2>
          <div className="flex items-center gap-3">
            {/* 过滤器 */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">全部状态</option>
              <option value="active">启用</option>
              <option value="inactive">禁用</option>
            </select>
            <button
              onClick={handleOpenAddModal}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              <Plus size={18} />
              添加模型
            </button>
          </div>
        </div>

        {/* 表格 */}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  名称
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  代理类型
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  API 地址
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  模型列表
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  状态
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  默认
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  连接状态
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredModels.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    暂无模型配置
                  </td>
                </tr>
              ) : (
                filteredModels.map((model) => {
                  const modelList = parseModels(model.models);
                  return (
                    <tr key={model.id} className="hover:bg-gray-50">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <Cpu size={16} className="text-gray-400" />
                          <span className="font-medium text-gray-900">{model.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          model.providerType === 'claude'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-green-100 text-green-800'
                        }`}>
                          {PROVIDER_TYPE_LABELS[model.providerType] || model.providerType}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <Globe size={16} className="text-gray-400" />
                          <span className="text-sm text-gray-600 font-mono max-w-xs truncate">
                            {model.apiBaseUrl}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-1">
                          {modelList.slice(0, 3).map((m, i) => (
                            <span
                              key={i}
                              className="px-2 py-11 bg-gray-100 text-gray-700 text-xs rounded"
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
                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${
                            model.isActive
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              model.isActive ? 'bg-green-500' : 'bg-gray-500'
                            }`}
                          />
                          {model.isActive ? '启用' : '禁用'}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        {model.isDefault && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                            <Check size={12} />
                            默认
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {testResults[model.id] ? (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${
                              testResults[model.id].success
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {testResults[model.id].success ? (
                              <Check size={12} />
                            ) : (
                              <AlertCircle size={12} />
                            )}
                            {testResults[model.id].success ? '正常' : '异常'}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">未测试</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleTestModel(model)}
                            disabled={testingModelId === model.id}
                            className={`p-1.5 rounded-md transition-colors ${
                              testingModelId === model.id
                                ? 'text-blue-600 bg-blue-50 cursor-wait'
                                : 'text-gray-600 hover:text-green-600 hover:bg-green-50'
                            }`}
                            title="测试连接"
                          >
                            {testingModelId === model.id ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <Play size={16} />
                            )}
                          </button>
                          <button
                            onClick={() => handleOpenEditModal(model)}
                            className="p-1.5 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                            title="编辑"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleDeleteClick(model)}
                            className="p-1.5 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                            title="删除"
                          >
                            <Trash2 size={16} />
                          </button>
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
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingModel ? '编辑模型' : '添加模型'}
              </h3>
              <button
                onClick={handleCloseModal}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* 名称 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例如：内部大模型 或 Claude"
                />
              </div>

              {/* 代理类型 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  代理类型 <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.providerType}
                  onChange={(e) => {
                    const providerType = e.target.value as 'claude' | 'openai';
                    // 根据代理类型设置默认 API 地址
                    const defaultBaseUrl = providerType === 'claude'
                      ? 'https://api.anthropic.com/v1/messages'
                      : formData.apiBaseUrl;
                    setFormData({ ...formData, providerType, apiBaseUrl: formData.apiBaseUrl || defaultBaseUrl });
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="openai">OpenAI API（内部大模型）</option>
                  <option value="claude">Claude API（原生）</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {formData.providerType === 'claude'
                    ? '直接调用 Anthropic Claude API，无需格式转换'
                    : '调用内部大模型，需要 Anthropic ↔ OpenAI 格式转换'}
                </p>
              </div>

              {/* 路由类型 - 仅 OpenAI 类型显示 */}
              {formData.providerType === 'openai' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    路由类型
                  </label>
                  <select
                    value={formData.routeType}
                    onChange={(e) => setFormData({ ...formData, routeType: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-- 不指定（使用默认路由）--</option>
                    {ROUTE_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    选择此模型用于哪种路由场景。不指定则使用默认路由。
                  </p>
                </div>
              )}

              {/* API 地址 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  API 地址 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.apiBaseUrl}
                  onChange={(e) => setFormData({ ...formData, apiBaseUrl: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  placeholder={formData.providerType === 'claude' 
                    ? 'https://api.anthropic.com/v1/messages'
                    : 'http://192.168.1.100:8000/v1/chat/completions'}
                />
              </div>

              {/* API Key */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  API Key <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={formData.apiKey}
                  onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  placeholder="输入 API Key"
                />
              </div>

              {/* 模型名称 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  模型名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.models}
                  onChange={(e) => setFormData({ ...formData, models: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例如：gpt-4、claude-3-opus-20240229"
                />
                <p className="text-xs text-gray-500 mt-1">
                  输入单个模型名称
                </p>
              </div>

              {/* 开关 */}
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">启用</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isDefault}
                    onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">设为默认</span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
              <button
                onClick={handleCloseModal}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSaveModel}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
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
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <AlertCircle className="h-6 w-6 text-red-500" />
                <h3 className="text-lg font-semibold text-gray-900">
                  确认删除
                </h3>
              </div>
              <p className="text-gray-600 mb-6">
                确定要删除模型 <span className="font-semibold">{deletingModel.name}</span> 吗？
                此操作无法撤销。
              </p>
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeletingModel(null);
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
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
