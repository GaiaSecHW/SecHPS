'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Save,
  X,
  Loader2,
} from 'lucide-react';
import { PERMISSIONS } from '@/types/permissions';
import { hasPermission } from '@/lib/auth';
import { getCategories, Category } from '@/lib/categories';
import { useTechStackOptions } from '@/hooks/useTechStackOptions';

const DEFAULT_TEMPLATE = `# Skill 名称

## 描述
简要描述这个 Skill 的作用和检测目标...

## CWE 编号
（可选，如 CWE-89）

## 系统提示词
你是一个专业的安全代码审计专家...

## 用户提示词
请分析以下代码...

## 工具
- read_file
- search_pattern
`;

export default function CreateSkillPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [content, setContent] = useState(DEFAULT_TEMPLATE);
  const [isPublic, setIsPublic] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [techStack, setTechStack] = useState<string[]>([]);
  const [techStackSearch, setTechStackSearch] = useState('');
  const [showTechStackDropdown, setShowTechStackDropdown] = useState(false);
  
  // 使用 Hook 获取技术栈选项
  const { options: techStackOptions, loading: loadingTechStack } = useTechStackOptions();

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
  }, []);

  useEffect(() => {
    // 加载分类
    getCategories().then((cats) => {
      setCategories(cats);
      if (cats.length > 0 && !category) {
        setCategory(cats[0].value);
      }
    });
  }, [category]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('请输入 Skill 名称');
      return;
    }

    if (!content.trim()) {
      setError('请输入 Skill 内容');
      return;
    }

    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      const response = await fetch('/api/skills', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim(),
          displayName: name.trim(),
          description: name.trim(),
          category,
          techStack,
          content,
          cwe: null,
          isPublic,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '创建失败');
      }

      router.push('/dashboard/skills');
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setLoading(false);
    }
  };

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
            <h1 className="text-2xl font-bold text-gray-900">创建新 Skill</h1>
            <p className="text-sm text-gray-600">定义一个新的 AI 漏洞检测技能</p>
          </div>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <div className="bg-white rounded-lg shadow border border-gray-200 p-6 space-y-6">
          {/* 基本信息 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Skill 名称 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Skill 名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：SQL注入检测"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            {/* 漏洞分类 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                漏洞分类 <span className="text-red-500">*</span>
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {categories.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 技术栈 */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                适合的技术栈
              </label>
              <div className="relative">
                <div className="flex flex-wrap gap-2 mb-2">
                  {techStack.map((ts) => (
                    <span
                      key={ts}
                      className="inline-flex items-center px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                    >
                      {ts}
                      <button
                        type="button"
                        onClick={() => setTechStack(techStack.filter((t) => t !== ts))}
                        className="ml-2 text-blue-600 hover:text-blue-800"
                      >
                        <X size={14} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={techStackSearch}
                    onChange={(e) => {
                      setTechStackSearch(e.target.value);
                      setShowTechStackDropdown(true);
                    }}
                    onFocus={() => setShowTechStackDropdown(true)}
                    placeholder={loadingTechStack ? "加载中..." : "搜索并选择技术栈..."}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={loadingTechStack}
                  />
                  {showTechStackDropdown && !loadingTechStack && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                      {techStackOptions
                        .filter((option) => 
                          option.toLowerCase().includes(techStackSearch.toLowerCase()) &&
                          !techStack.includes(option)
                        )
                        .slice(0, 20)
                        .map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => {
                              setTechStack([...techStack, option]);
                              setTechStackSearch('');
                              setShowTechStackDropdown(false);
                            }}
                            className="w-full px-4 py-2 text-left hover:bg-gray-100 text-sm"
                          >
                            {option}
                          </button>
                        ))}
                      {techStackOptions.filter((option) => 
                        option.toLowerCase().includes(techStackSearch.toLowerCase()) &&
                        !techStack.includes(option)
                      ).length === 0 && (
                        <div className="px-4 py-2 text-sm text-gray-500">
                          无匹配选项
                        </div>
                      )}
                    </div>
                  )}
                  {loadingTechStack && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-3">
                      <div className="flex items-center justify-center">
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        <span className="text-sm text-gray-500">加载中...</span>
                      </div>
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  可选择多个技术栈，表示此Skill适用于这些技术
                </p>
              </div>
            </div>
          </div>

          {/* 是否公开 */}
          {isAdmin && (
            <div>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-700">
                  公开 Skill（所有用户可见）
                </span>
              </label>
            </div>
          )}

          {/* Markdown 内容 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Skill 内容（Markdown 格式）<span className="text-red-500">*</span>
              </label>
              <button
                type="button"
                onClick={() => setContent(DEFAULT_TEMPLATE)}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                重置模板
              </button>
            </div>
            <div className="mb-3 bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="text-sm text-gray-600 mb-2">格式建议：</p>
              <div className="text-xs text-gray-500 font-mono space-y-1">
                <p># Skill 名称</p>
                <p>## 描述</p>
                <p>## CWE 编号</p>
                <p>## 系统提示词</p>
                <p>## 用户提示词</p>
                <p>## 工具 (使用 - 列表)</p>
              </div>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full h-[500px] px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
              placeholder="输入 Markdown 格式的 Skill 定义..."
              required
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                创建中...
              </>
            ) : (
              <>
                <Save size={16} className="mr-2" />
                创建 Skill
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
