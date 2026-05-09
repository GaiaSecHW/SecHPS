'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Save,
  Cog,
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

export default function CreateToolPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    displayName: '',
    description: '',
    category: 'file',
    parameters: '{}',
    executor: 'http',
    executorConfig: '{}',
    requiresPermission: false,
    allowedInSandbox: true,
    timeout: 30000,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

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

      const response = await fetch('/api/tools', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: formData.name,
          displayName: formData.displayName,
          description: formData.description,
          category: formData.category,
          parameters,
          executor: formData.executor,
          executorConfig,
          requiresPermission: formData.requiresPermission,
          allowedInSandbox: formData.allowedInSandbox,
          timeout: formData.timeout,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '创建失败');
      }

      // 跳转到工具列表页
      router.push('/dashboard/admin/tools');
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      {/* 头部 */}
      <div className="mb-6">
        <button
          onClick={() => router.back()}
          className="flex items-center text-gray-400 hover:text-gray-100 mb-4"
        >
          <ArrowLeft size={20} className="mr-2" />
          返回
        </button>
        <h1 className="text-2xl font-bold text-gray-100">创建工具</h1>
        <p className="text-gray-400 mt-1">创建一个新的工具供 Skills 使用</p>
      </div>

      {/* 表单 */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-900/20 border border-red-800/40 text-red-300 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {/* 基本信息 */}
        <div className="bg-dark-surface shadow rounded-lg p-6 border border-gray-700/50">
          <h2 className="text-lg font-semibold text-gray-100 mb-4 flex items-center">
            <Cog size={20} className="mr-2" />
            基本信息
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 工具名称 */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                工具名称 <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 text-gray-100 placeholder-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="例如：read_file"
                required
              />
              <p className="mt-1 text-sm text-gray-500">唯一标识符，使用小写字母和下划线</p>
            </div>

            {/* 显示名称 */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                显示名称 <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 text-gray-100 placeholder-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="例如：读取文件"
                required
              />
            </div>

            {/* 分类 */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                分类 <span className="text-red-400">*</span>
              </label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
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
              <label className="block text-sm font-medium text-gray-300 mb-2">
                执行器 <span className="text-red-400">*</span>
              </label>
              <select
                value={formData.executor}
                onChange={(e) => setFormData({ ...formData, executor: e.target.value })}
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {EXECUTORS.map((exec) => (
                  <option key={exec.value} value={exec.value}>
                    {exec.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 描述 */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                描述 <span className="text-red-400">*</span>
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 text-gray-100 placeholder-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                rows={3}
                placeholder="描述这个工具的功能和用途"
                required
              />
            </div>

            {/* 超时时间 */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                超时时间（毫秒）
              </label>
              <input
                type="number"
                value={formData.timeout}
                onChange={(e) => setFormData({ ...formData, timeout: parseInt(e.target.value) || 30000 })}
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 text-gray-100 placeholder-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                min={1000}
                step={1000}
              />
              <p className="mt-1 text-sm text-gray-500">工具执行的最大等待时间</p>
            </div>
          </div>
        </div>

        {/* 参数定义 */}
        <div className="bg-dark-surface shadow rounded-lg p-6 border border-gray-700/50">
          <h2 className="text-lg font-semibold text-gray-100 mb-4">参数定义</h2>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              参数 Schema (JSON) <span className="text-red-400">*</span>
            </label>
            <textarea
              value={formData.parameters}
              onChange={(e) => setFormData({ ...formData, parameters: e.target.value })}
              className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 text-gray-100 placeholder-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
              rows={8}
              placeholder={`{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string",
      "description": "文件路径"
    }
  },
  "required": ["file_path"]
}`}
              required
            />
            <p className="mt-1 text-sm text-gray-500">
              使用 JSON Schema 定义工具接受的参数
            </p>
          </div>
        </div>

        {/* 执行器配置 */}
        <div className="bg-dark-surface shadow rounded-lg p-6 border border-gray-700/50">
          <h2 className="text-lg font-semibold text-gray-100 mb-4">执行器配置</h2>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              执行器配置 (JSON)
            </label>
            <textarea
              value={formData.executorConfig}
              onChange={(e) => setFormData({ ...formData, executorConfig: e.target.value })}
              className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 text-gray-100 placeholder-gray-500 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
              rows={8}
              placeholder={`{
  "url": "http://example.com/api",
  "method": "POST",
  "headers": {
    "Content-Type": "application/json"
  }
}`}
            />
            <p className="mt-1 text-sm text-gray-500">
              根据执行器类型配置不同的参数（HTTP URL、脚本路径等）
            </p>
          </div>
        </div>

        {/* 权限设置 */}
        <div className="bg-dark-surface shadow rounded-lg p-6 border border-gray-700/50">
          <h2 className="text-lg font-semibold text-gray-100 mb-4">权限设置</h2>
          <div className="space-y-4">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={formData.requiresPermission}
                onChange={(e) => setFormData({ ...formData, requiresPermission: e.target.checked })}
                className="rounded border-gray-600 text-primary-600 focus:ring-primary-500"
              />
              <span className="ml-2 text-sm text-gray-300">
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
                className="rounded border-gray-600 text-primary-600 focus:ring-primary-500"
              />
              <span className="ml-2 text-sm text-gray-300">
                允许在沙箱环境执行
              </span>
            </label>
            <p className="text-sm text-gray-500">
              勾选后，工具可以在隔离的沙箱环境中执行
            </p>
          </div>
        </div>

        {/* 提交按钮 */}
        <div className="flex justify-end space-x-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-2 bg-dark-surface border border-gray-600 text-gray-300 rounded-md hover:bg-dark-surface-hover"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            {loading ? (
              <>
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></span>
                创建中...
              </>
            ) : (
              <>
                <Save size={16} className="mr-2" />
                创建工具
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
