'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, GripVertical, Save, Loader2 } from 'lucide-react';

interface Category {
  value: string;
  label: string;
}

export default function SkillCategoriesSection() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
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

  if (loading) {
    return (
      <div className="space-y-4 border-t border-gray-200 pt-6">
        <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
          漏洞分类管理
        </h3>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-blue-600" size={24} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 border-t border-gray-200 pt-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
          漏洞分类管理
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAddCategory}
            className="inline-flex items-center px-3 py-1.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
          >
            <Plus size={16} className="mr-1" />
            添加分类
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 size={16} className="mr-1 animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Save size={16} className="mr-1" />
                保存
              </>
            )}
          </button>
        </div>
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

      <p className="text-sm text-gray-600">
        管理漏洞分类列表，这些分类将在创建和编辑 Skill 时使用。分类值用于存储，分类标签用于显示。
      </p>

      <div className="space-y-3">
        {categories.map((category, index) => (
          <div
            key={index}
            className="flex items-center gap-3 p-3 bg-gray-50 rounded-md border border-gray-200"
          >
            <GripVertical size={16} className="text-gray-400 cursor-move" />
            
            <div className="flex-1 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  分类值（英文）
                </label>
                <input
                  type="text"
                  value={category.value}
                  onChange={(e) => handleCategoryChange(index, 'value', e.target.value)}
                  placeholder="例如: code-audit"
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  分类标签（中文）
                </label>
                <input
                  type="text"
                  value={category.label}
                  onChange={(e) => handleCategoryChange(index, 'label', e.target.value)}
                  placeholder="例如: 代码审计"
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <button
              onClick={() => handleRemoveCategory(index)}
              className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
              title="删除分类"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}

        {categories.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            暂无分类，点击"添加分类"按钮创建新分类
          </div>
        )}
      </div>
    </div>
  );
}
