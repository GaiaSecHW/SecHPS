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
  isActive: boolean;
  isDefault: boolean;
  isPublic: boolean;
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
  isPublic: boolean;
  isSystemModel: boolean;  // 系统模型（仅管理员可设置）
  isDefault: boolean;      // 默认模型（仅系统模型可设置）
  changeApiKey: boolean;   // 确认修改 API Key
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
      routeType: '',
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
    if (!user?.roles?.includes('admin') && model.userId !== user?.id && model.userId !== null) {
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
      routeType: model.routeType || '',
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
      routeType: '',
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
        routeType: formData.providerType === 'openai' ? formData.routeType || undefined : undefined,
        isActive: formData.isActive,
        isPublic: formData.isPublic,
        // 管理员专属字段
        isSystemModel: user?.roles?.includes('admin') ? formData.isSystemModel : undefined,
        isDefault: user?.roles?.includes('admin') && formData.isSystemModel ? formData.isDefault : undefined,
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
    if (!user?.roles?.includes('admin') && model.userId !== user?.id) {
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
          timestamp: Date.now(),
        },
      });

      if (data.success) {
        setSuccess(`模型 "${model.name}" 连接测试成功`);
        setTimeout(() => setSuccess(null), 5000);
      } else {
        setError(data.message || '连接失败');
        setTimeout(() => setError(null), 5000);
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

  // 检查是否可以编辑/删除模型
  const canEditModel = (model: ModelConfig) => {
    return user?.roles?.includes('admin') || model.userId === user?.id;
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
            我的模型
          </h1>
          <p className="text-gray-600 mt-1">
            管理您创建的大模型配置。设置公开后，其他用户在评估时也可使用。
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
          <h2 className="text-lg font-semibold text-gray-900">
            {user?.roles?.includes('admin') ? '所有模型配置' : '我的模型配置'}
          </h2>
          <div className="flex items-center gap-3">
            {/* 过滤器 */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">全部</option>
              <option value="active">启用</option>
              <option value="inactive">禁用</option>
              <option value="public">公开</option>
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
                {user?.roles?.includes('admin') && (
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    创建者
                  </th>
                )}
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
                  公开
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
                  <td colSpan={user?.roles?.includes('admin') ? 9 : 8} className="px-4 py-8 text-center text-gray-500">
                    暨无模型配置，点击"添加模型"创建您的第一个模型
                  </td>
                </tr>
              ) : (
                filteredModels.map((model) => {
                  const modelList = parseModels(model.models);
                  const isOwner = model.userId === user?.id || model.userId === null;
                  return (
                    <tr key={model.id} className="hover:bg-gray-50">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <Cpu size={16} className="text-gray-400" />
                          <span className="font-medium text-gray-900">{model.name}</span>
                          {model.isDefault && (
                            <span className="px-1.5 py-0.5 text-xs font-medium bg-orange-100 text-orange-800 rounded">
                              默认
                            </span>
                          )}
                          {model.userId === null && (
                            <span className="text-xs text-gray-500">(系统)</span>
                          )}
                        </div>
                      </td>
                      {user?.roles?.includes('admin') && (
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            <User size={16} className="text-gray-400" />
                            {model.userId === null ? (
                              <span className="text-sm text-gray-600">系统模型</span>
                            ) : (
                              <span className="text-sm text-gray-600">
                                {model.userName || model.userUsername || '未知用户'}
                              </span>
                            )}
                          </div>
                        </td>
                      )}
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
                              className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded"
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
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${
                            model.isPublic
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {model.isPublic ? <Globe size={12} /> : <Lock size={12} />}
                          {model.isPublic ? '公开' : '私有'}
                        </span>
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
                          {canEditModel(model) && (
                            <button
                              onClick={() => handleOpenEditModal(model)}
                              className="p-1.5 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                              title="编辑"
                            >
                              <Edit2 size={16} />
                            </button>
                          )}
                          {canEditModel(model) && (
                            <button
                              onClick={() => handleDeleteClick(model)}
                              className="p-1.5 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
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
                {/* 新建时直接显示输入框 */}
                {!editingModel ? (
                  <>
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
                  </>
                ) : (
                  <>
                    {/* 编辑时需要确认才能修改 */}
                    <div className="flex items-center gap-2 mb-2">
                      <Key size={16} className="text-gray-400" />
                      <span className="text-sm text-gray-700">
                        API Key: {editingModel.hasApiKey ? (
                          <span className="text-green-600 font-medium">已设置</span>
                        ) : (
                          <span className="text-red-600 font-medium">未设置</span>
                        )}
                      </span>
                    </div>
                    
                    <label className="flex items-center gap-2 cursor-pointer mb-2">
                      <input
                        type="checkbox"
                        checked={formData.changeApiKey}
                        onChange={(e) => setFormData({ ...formData, changeApiKey: e.target.checked })}
                        className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
                      />
                      <span className="text-sm text-orange-700 font-medium">修改 API Key</span>
                    </label>

                    {formData.changeApiKey && (
                      <input
                        type="password"
                        value={formData.apiKey}
                        onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                        className="w-full px-3 py-2 border border-orange-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 font-mono text-sm"
                        placeholder="输入新的 API Key"
                      />
                    )}
                    
                    {formData.changeApiKey && (
                      <p className="text-xs text-orange-600 mt-1">
                        请输入新的 API Key，原有 Key 将被替换
                      </p>
                    )}
                  </>
                )}
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
              <div className="flex flex-col gap-3">
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
                      checked={formData.isPublic}
                      onChange={(e) => setFormData({ ...formData, isPublic: e.target.checked })}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">公开（其他用户可使用）</span>
                  </label>
                </div>

                {/* 管理员专属选项 */}
                {user?.roles?.includes('admin') && (
                  <div className="flex items-center gap-6 pt-2 border-t border-gray-200">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.isSystemModel}
                        onChange={(e) => setFormData({ ...formData, isSystemModel: e.target.checked, isDefault: e.target.checked ? formData.isDefault : false })}
                        className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                      />
                      <span className="text-sm text-purple-700 font-medium">系统模型（所有用户可见）</span>
                    </label>

                    {formData.isSystemModel && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.isDefault}
                          onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                          className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
                        />
                        <span className="text-sm text-orange-700 font-medium">默认模型</span>
                      </label>
                    )}
                  </div>
                )}
              </div>

              {formData.isPublic && (
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                  <p className="text-sm text-blue-800">
                    <Globe size={16} className="inline mr-1" />
                    公开的模型将出现在所有用户的评估模型选择列表中。请确保 API Key 安全。
                  </p>
                </div>
              )}
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
                  认删除
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