'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, GripVertical, Save, Loader2, ArrowLeft, AlertCircle, CheckCircle } from 'lucide-react';
import { PERMISSIONS } from '@/types/permissions';
import { hasPermission } from '@/lib/permissions';

interface Category {
  value: string;
  label: string;
}

export default function CategoriesManagementPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setIsAdmin(hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE));
      } catch (error) {
        console.error('解析 token 失败:', error);
      }
    }
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/categories', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取分类失败');
      }

      const data = await response.json();
      setCategories(data.categories || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取分类失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAddCategory = () => {
    setCategories([...categories, { value: '', label: '' }]);
  };

  const handleRemoveCategory = (index: number) => {
    setCategories(categories.filter((_, i) => i !== index));
  };

  const handleCategoryChange = (index: number, field: 'value' | 'label', value: string) => {
    const newCategories = [...categories];
    newCategories[index] = { ...newCategories[index], [field]: value };
    setCategories(newCategories);
  };

  const handleSave = async () => {
    // 验证
    for (const cat of categories) {
      if (!cat.value.trim() || !cat.label.trim()) {
        setError('所有分类的值和标签都必须填写');
        return;
      }
    }

    // 检查重复
    const values = categories.map(c => c.value);
    const uniqueValues = new Set(values);
    if (values.length !== uniqueValues.size) {
      setError('分类值不能重复');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const token = localStorage.getItem('token');
      
      const response = await fetch('/api/admin/categories', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ categories }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '保存失败');
      }

      setSuccess('分类保存成功');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-8">
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg">
          您没有权限访问此页面
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">漏洞分类管理</h1>
            <p className="text-sm text-gray-600">管理 Skills 的漏洞分类列表</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleAddCategory}
            className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Plus size={16} className="mr-2" />
            添加分类
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Save size={16} className="mr-2" />
                保存更改
              </>
            )}
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <CheckCircle size={16} />
          {success}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="animate-spin text-blue-600" size={32} />
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="mb-4 text-sm text-gray-600">
            管理漏洞分类列表，这些分类将在创建和编辑 Skill 时使用。
            <br />
            <strong>分类值</strong>用于存储（英文，如 code-audit），
            <strong>分类标签</strong>用于显示（中文，如 代码审计）。
          </div>

          <div className="space-y-3">
            {categories.map((category, index) => (
              <div
                key={index}
                className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
              >
                <GripVertical size={18} className="text-gray-400 cursor-move flex-shrink-0" />
                
                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">
                      分类值（英文）
                    </label>
                    <input
                      type="text"
                      value={category.value}
                      onChange={(e) => handleCategoryChange(index, 'value', e.target.value)}
                      placeholder="例如: code-audit"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">
                      分类标签（中文）
                    </label>
                    <input
                      type="text"
                      value={category.label}
                      onChange={(e) => handleCategoryChange(index, 'label', e.target.value)}
                      placeholder="例如: 代码审计"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>

                <button
                  onClick={() => handleRemoveCategory(index)}
                  className="p-2 text-red-600 hover:bg-red-50 rounded-md transition-colors flex-shrink-0"
                  title="删除分类"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}

            {categories.length === 0 && (
              <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                暂无分类，点击"添加分类"按钮创建新分类
              </div>
            )}
          </div>

          {/* Summary */}
          {categories.length > 0 && (
            <div className="mt-6 pt-4 border-t border-gray-200 text-sm text-gray-600">
              共 {categories.length} 个分类
            </div>
          )}
        </div>
      )}
    </div>
  );
}
