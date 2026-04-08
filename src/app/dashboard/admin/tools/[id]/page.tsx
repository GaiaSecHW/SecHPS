'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft,
  Save,
  Cog,
  Trash2,
  Power,
} from 'lucide-react';

const CATEGORIES = [
  { value: 'file', label: '文件操作' },
  { value: 'code', label: '代码分析' },
  { value: 'security', label: '安全检测' },
  { value: 'network', label: '网络请求' },
  { value: 'system', label: '系统命令' },
];

const EXECUTORS = [
  { value: 'http', label: 'HTTP 请求' },
  { value: 'script', label: '脚本执行' },
  { value: 'builtin', label: '内置函数' },
  { value: 'mcp', label: 'MCP 工具' },
];

export default function EditToolPage() {
  const router = useRouter();
  const params = useParams();
  const toolId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tool, setTool] = useState<any>(null);

  const [formData, setFormData] = useState({
    displayName: '',
    description: '',
    category: 'file',
    parameters: '{}',
    executor: 'http',
    executorConfig: '{}',
    requiresPermission: false,
    allowedInSandbox: true,
    timeout: 30000,
    isActive: true,
  });

  useEffect(() => {
    fetchTool();
  }, [toolId]);

  const fetchTool = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/tools/${toolId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取工具信息失败');
      }

      const data = await response.json();
      setTool(data.tool);
      setFormData({
        displayName: data.tool.displayName,
        description: data.tool.description,
        category: data.tool.category,
        parameters: JSON.stringify(data.tool.parameters, null, 2),
        executor: data.tool.executor,
        executorConfig: data.tool.executorConfig ? JSON.stringify(data.tool.executorConfig, null, 2) : '{}',
        requiresPermission: data.tool.requiresPermission,
        allowedInSandbox: data.tool.allowedInSandbox,
        timeout: data.tool.timeout,
        isActive: data.tool.isActive,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.push('/login');
        return;
      }

      // 验证 JSON 格式
      let parameters, executorConfig;
      try {
        parameters = JSON.parse(formData.parameters);
        executorConfig = formData.executorConfig ? JSON.parse(formData.executorConfig) : null;
      } catch (err) {
        throw new Error('参数或执行器配置必须是有效的 JSON 格式');
      }

      const response = await fetch(`/api/tools/${toolId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          displayName: formData.displayName,
          description: formData.description,
          category: formData.category,
          parameters,
          executor: formData.executor,
          executorConfig,
          requiresPermission: formData.requiresPermission,
          allowedInSandbox: formData.allowedInSandbox,
          timeout: formData.timeout,
          isActive: formData.isActive,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '更新失败');
      }

      router.push('/dashboard/admin/tools');
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('确定要删除这个工具吗？此操作不可恢复。')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/tools/${toolId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '删除失败');
      }

      router.push('/dashboard/admin/tools');
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleToggleActive = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/tools/${toolId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          isActive: !formData.isActive,
        }),
      });

      if (!response.ok) {
        throw new Error('更新状态失败');
      }

      setFormData({ ...formData, isActive: !formData.isActive });
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新状态失败');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!tool) {
    return (
      <div className="p-6">
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded">
          工具不存在或已被删除
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* 头部 */}
      <div className="mb-6">
        <button
          onClick={() => router.back()}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft size={20} className="mr-2" />
          返回
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">编辑工具</h1>
            <p className="text-gray-600 mt-1">
              {tool.name} {tool.isBuiltin && <span className="text-purple-600">(内置)</span>}
            </p>
          </div>
          <div className="flex items-center space-x-3">
            {!tool.isBuiltin && (
              <button
                onClick={handleDelete}
                className="inline-flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                <Trash2 size={16} className="mr-2" />
                删除
              </button>
            )}
            <button
              onClick={handleToggleActive}
              className={`inline-flex items-center px-4 py-2 rounded-lg transition-colors ${
                formData.isActive
                  ? 'bg-yellow-600 text-white hover:bg-yellow-700'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              <Power size={16} className="mr-2" />
              {formData.isActive ? '禁用' : '启用'}
            </button>
          </div>
        </div>
      </div>

      {/* 表单 */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {/* 基本信息 */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Cog size={20} className="mr-2" />
            基本信息
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 工具名称（不可编辑） */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                工具名称
              </label>
              <input
                type="text"
                value={tool.name}
                disabled
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500"
              />
              <p className="mt-1 text-sm text-gray-500">工具名称不可修改</p>
            </div>

            {/* 显示名称 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                显示名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            {/* 分类 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                分类 <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 执行器 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                执行器 <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.executor}
                onChange={(e) => setFormData({ ...formData, executor: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={tool.isBuiltin}
              >
                {EXECUTORS.map((exec) => (
                  <option key={exec.value} value={exec.value}>
                    {exec.label}
                  </option>
                ))}
              </select>
              {tool.isBuiltin && (
                <p className="mt-1 text-sm text-gray-500">内置工具的执行器不可修改</p>
              )}
            </div>

            {/* 描述 */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                描述 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                required
              />
            </div>

            {/* 超时时间 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                超时时间（毫秒）
              </label>
              <input
                type="number"
                value={formData.timeout}
                onChange={(e) => setFormData({ ...formData, timeout: parseInt(e.target.value) || 30000 })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                min={1000}
                step={1000}
              />
            </div>
          </div>
        </div>

        {/* 参数定义 */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">参数定义</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              参数 Schema (JSON) <span className="text-red-500">*</span>
            </label>
            <textarea
              value={formData.parameters}
              onChange={(e) => setFormData({ ...formData, parameters: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              rows={8}
              disabled={tool.isBuiltin}
              required
            />
            {tool.isBuiltin && (
              <p className="mt-1 text-sm text-gray-500">内置工具的参数定义不可修改</p>
            )}
          </div>
        </div>

        {/* 执行器配置 */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">执行器配置</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              执行器配置 (JSON)
            </label>
            <textarea
              value={formData.executorConfig}
              onChange={(e) => setFormData({ ...formData, executorConfig: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              rows={8}
              disabled={tool.isBuiltin}
            />
            {tool.isBuiltin && (
              <p className="mt-1 text-sm text-gray-500">内置工具的执行器配置不可修改</p>
            )}
          </div>
        </div>

        {/* 权限设置 */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">权限设置</h2>
          <div className="space-y-4">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={formData.requiresPermission}
                onChange={(e) => setFormData({ ...formData, requiresPermission: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="ml-2 text-sm text-gray-700">
                需要用户授权
              </span>
            </label>
            <p className="text-sm text-gray-500">
              勾选后，工具执行时需要用户明确授权
            </p>

            <label className="flex items-center">
              <input
                type="checkbox"
                checked={formData.allowedInSandbox}
                onChange={(e) => setFormData({ ...formData, allowedInSandbox: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="ml-2 text-sm text-gray-700">
                允许在沙箱环境执行
              </span>
            </label>
            <p className="text-sm text-gray-500">
              勾选后，工具可以在隔离的沙箱环境中执行
            </p>
          </div>
        </div>

        {/* 提交按钮 */}
        <div className="flex justify-between">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            {saving ? (
              <>
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></span>
                保存中...
              </>
            ) : (
              <>
                <Save size={16} className="mr-2" />
                保存修改
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
