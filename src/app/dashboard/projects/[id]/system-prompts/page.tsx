'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  FileText,
  Edit,
  Trash2,
  Code,
  Sparkles,
  Loader2,
} from 'lucide-react';

interface SystemPrompt {
  id: string;
  name: string;
  type: 'preset' | 'custom';
  content: string;
  isEnabled: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export default function SystemPromptsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<SystemPrompt | null>(null);

  // 表单状态
  const [formData, setFormData] = useState({
    name: '',
    type: 'custom' as 'preset' | 'custom',
    content: '',
    isEnabled: true,
    priority: 0,
  });

  const fetchPrompts = async () => {
    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/projects/${projectId}/system-prompts`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取系统提示词列表失败');
      }

      const data = await response.json();
      setPrompts(data.prompts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrompts();
  }, [projectId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const token = localStorage.getItem('token');
      const url = editingPrompt
        ? `/api/projects/${projectId}/system-prompts/${editingPrompt.id}`
        : `/api/projects/${projectId}/system-prompts`;

      const method = editingPrompt ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '保存失败');
      }

      setShowForm(false);
      setEditingPrompt(null);
      resetForm();
      fetchPrompts();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    }
  };

  const handleDelete = async (promptId: string) => {
    if (!confirm('确定要删除此系统提示词吗？')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `/api/projects/${projectId}/system-prompts/${promptId}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error('删除失败');
      }

      fetchPrompts();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleEdit = (prompt: SystemPrompt) => {
    setEditingPrompt(prompt);
    setFormData({
      name: prompt.name,
      type: prompt.type,
      content: prompt.content,
      isEnabled: prompt.isEnabled,
      priority: prompt.priority,
    });
    setShowForm(true);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'custom',
      content: '',
      isEnabled: true,
      priority: 0,
    });
  };

  const getTypeBadge = (type: 'preset' | 'custom') => {
    if (type === 'preset') {
      return (
        <span className="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-purple-500/15 text-purple-400 border border-purple-500/20">
          <Sparkles className="w-3 h-3 mr-1" />
          预设
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full bg-dark-surface-hover text-gray-300">
        <Code className="w-3 h-3 mr-1" />
        自定义
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center text-gray-400 hover:text-gray-100"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          返回项目列表
        </Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">系统提示词管理</h1>
          <p className="text-sm text-gray-500 mt-1">
            配置自定义系统提示词或使用预设模板
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setEditingPrompt(null);
            setShowForm(true);
          }}
          className="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
        >
          <Plus className="w-4 h-4 mr-2" />
          添加提示词
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-900/20 border border-red-800/40 text-red-300 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {showForm && (
        <div className="mb-6 bg-dark-surface rounded-lg shadow p-6 border border-gray-700/50">
          <h2 className="text-lg font-semibold mb-4 text-gray-100">
            {editingPrompt ? '编辑系统提示词' : '添加系统提示词'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  名称 *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="例如: 代码审查提示词"
                  className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 text-gray-100 placeholder-gray-500 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  类型 *
                </label>
                <select
                  value={formData.type}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      type: e.target.value as 'preset' | 'custom',
                    })
                  }
                  className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 text-gray-100 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="custom">自定义</option>
                  <option value="preset">预设</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                提示词内容 *
              </label>
              <textarea
                value={formData.content}
                onChange={(e) =>
                  setFormData({ ...formData, content: e.target.value })
                }
                placeholder="输入系统提示词内容（支持 Markdown 格式）"
                rows={8}
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 text-gray-100 placeholder-gray-500 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  优先级
                </label>
                <input
                  type="number"
                  value={formData.priority}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      priority: parseInt(e.target.value) || 0,
                    })
                  }
                  placeholder="数字越大优先级越高"
                  className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 text-gray-100 placeholder-gray-500 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div className="flex items-center pt-6">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.isEnabled}
                    onChange={(e) =>
                      setFormData({ ...formData, isEnabled: e.target.checked })
                    }
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-600 rounded"
                  />
                  <span className="ml-2 text-sm text-gray-300">启用</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setEditingPrompt(null);
                  resetForm();
                }}
                className="px-4 py-2 bg-dark-surface border border-gray-600 text-gray-300 rounded-md hover:bg-dark-surface-hover"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
              >
                {editingPrompt ? '更新' : '创建'}
              </button>
            </div>
          </form>
        </div>
      )}

      {prompts.length === 0 ? (
        <div className="bg-dark-surface rounded-lg shadow p-8 text-center border border-gray-700/50">
          <FileText className="w-12 h-12 text-gray-500 mx-auto mb-4" />
          <p className="text-gray-400 mb-4">暂无系统提示词</p>
          <button
            onClick={() => setShowForm(true)}
            className="text-primary-400 hover:text-primary-300"
          >
            添加第一个提示词
          </button>
        </div>
      ) : (
        <div className="bg-dark-surface rounded-lg shadow overflow-hidden border border-gray-700/50">
          <table className="min-w-full divide-y divide-gray-700/50">
            <thead className="bg-[#162032]">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  名称
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  类型
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  优先级
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  状态
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {prompts.map((prompt) => (
                <tr key={prompt.id} className="hover:bg-dark-surface-hover">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <FileText className="w-5 h-5 text-gray-500 mr-2" />
                      <span className="text-sm font-medium text-gray-100">
                        {prompt.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getTypeBadge(prompt.type)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-400">{prompt.priority}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        prompt.isEnabled
                          ? 'bg-green-500/15 text-green-400 border border-green-500/20'
                          : 'bg-dark-surface-hover text-gray-400'
                      }`}
                    >
                      {prompt.isEnabled ? '启用' : '禁用'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleEdit(prompt)}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(prompt.id)}
                        className="text-red-400 hover:text-red-300"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
