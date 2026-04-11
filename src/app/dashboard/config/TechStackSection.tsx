// src/app/dashboard/config/TechStackSection.tsx
'use client';

import { useState, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Edit2,
  X,
  Check,
  Loader2,
  Code,
  Boxes,
  Database,
  Server,
  Cloud,
} from 'lucide-react';

interface TechStackOption {
  id: string;
  name: string;
  category: string;
  description: string | null;
  isActive: boolean;
  isBuiltin: boolean;
  sortOrder: number;
}

const CATEGORY_LABELS: Record<string, { label: string; icon: any }> = {
  language: { label: '编程语言', icon: Code },
  framework: { label: '框架', icon: Boxes },
  database: { label: '数据库', icon: Database },
  middleware: { label: '中间件', icon: Server },
  cloud: { label: '云服务', icon: Cloud },
};

const CATEGORY_OPTIONS = [
  { value: 'language', label: '编程语言' },
  { value: 'framework', label: '框架' },
  { value: 'database', label: '数据库' },
  { value: 'middleware', label: '中间件' },
  { value: 'cloud', label: '云服务' },
];

interface TechStackSectionProps {
  token: string;
}

export default function TechStackSection({ token }: TechStackSectionProps) {
  const [options, setOptions] = useState<TechStackOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 新增/编辑状态
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    category: 'language',
    description: '',
    sortOrder: 0,
  });

  // 加载技术栈选项
  const fetchOptions = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/techstack', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error('获取失败');

      const data = await response.json();
      setOptions(data.options || []);
    } catch (err) {
      setError('加载技术栈选项失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOptions();
  }, [token]);

  // 重置表单
  const resetForm = () => {
    setFormData({
      name: '',
      category: 'language',
      description: '',
      sortOrder: 0,
    });
    setEditingId(null);
  };

  // 打开新增模态框
  const handleAdd = () => {
    resetForm();
    setShowAddModal(true);
  };

  // 打开编辑模态框
  const handleEdit = (option: TechStackOption) => {
    setFormData({
      name: option.name,
      category: option.category,
      description: option.description || '',
      sortOrder: option.sortOrder,
    });
    setEditingId(option.id);
    setShowAddModal(true);
  };

  // 保存
  const handleSave = async () => {
    if (!formData.name.trim()) {
      setError('请输入技术栈名称');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const url = editingId ? `/api/techstack/${editingId}` : '/api/techstack';
      const method = editingId ? 'PATCH' : 'POST';

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

      setSuccess(editingId ? '更新成功' : '创建成功');
      setShowAddModal(false);
      resetForm();
      fetchOptions();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 删除
  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个技术栈选项吗？')) return;

    try {
      const response = await fetch(`/api/techstack/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '删除失败');
      }

      setSuccess('删除成功');
      fetchOptions();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  // 切换激活状态
  const handleToggleActive = async (option: TechStackOption) => {
    try {
      const response = await fetch(`/api/techstack/${option.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isActive: !option.isActive }),
      });

      if (!response.ok) throw new Error('更新失败');

      fetchOptions();
    } catch (err) {
      setError('更新状态失败');
    }
  };

  // 按类别分组
  const groupedOptions = options.reduce((acc, opt) => {
    if (!acc[opt.category]) acc[opt.category] = [];
    acc[opt.category].push(opt);
    return acc;
  }, {} as Record<string, TechStackOption[]>);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900">技术栈选项</h3>
        <button
          onClick={handleAdd}
          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          <Plus size={16} />
          添加技术栈
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md">
          {success}
        </div>
      )}

      {/* 按类别显示 */}
      <div className="space-y-6">
        {Object.entries(groupedOptions).map(([category, opts]) => {
          const categoryInfo = CATEGORY_LABELS[category] || { label: category, icon: Code };
          const Icon = categoryInfo.icon;

          return (
            <div key={category}>
              <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                <Icon size={16} />
                {categoryInfo.label}
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {opts.map((opt) => (
                  <div
                    key={opt.id}
                    className={`flex items-center justify-between px-3 py-2 rounded-md border ${
                      opt.isActive
                        ? 'bg-white border-gray-200'
                        : 'bg-gray-50 border-gray-100 text-gray-400'
                    }`}
                  >
                    <span className="text-sm truncate">{opt.name}</span>
                    <div className="flex items-center gap-1 ml-2">
                      <button
                        onClick={() => handleEdit(opt)}
                        className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                        title="编辑"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(opt.id)}
                        className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                        title="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                      <button
                        onClick={() => handleToggleActive(opt)}
                        className={`p-1 rounded ${
                          opt.isActive
                            ? 'text-green-600 hover:bg-green-50'
                            : 'text-gray-400 hover:bg-gray-100'
                        }`}
                        title={opt.isActive ? '禁用' : '启用'}
                      >
                        {opt.isActive ? <Check size={14} /> : <X size={14} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* 新增/编辑模态框 */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingId ? '编辑技术栈' : '添加技术栈'}
              </h3>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  resetForm();
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例如：Java、Spring、MySQL"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  分类 <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  描述
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="可选描述"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  resetForm();
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
