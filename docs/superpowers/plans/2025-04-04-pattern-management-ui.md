# 漏洞模式管理前端实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现完整的漏洞模式管理前端功能，包括模式列表页面增强、创建模式页面、编辑模式页面，以及删除功能。

**Architecture:** 遵循现有 Next.js App Router + React 19 + TypeScript 架构，使用 Tailwind CSS 4 进行样式设计，调用已有的后端 API 完成数据操作。

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, Lucide Icons

---

## 文件结构

```
src/app/dashboard/admin/patterns/
├── page.tsx                    # 修改：增强列表页面（添加删除、分类筛选）
├── create/
│   └── page.tsx                # 新增：创建模式页面
└── [id]/
    └── page.tsx                # 新增：编辑模式页面

src/components/patterns/
└── PatternForm.tsx             # 新增：模式表单组件（创建/编辑共用）
```

---

## Task 1: 创建模式表单组件

**Files:**
- Create: `src/components/patterns/PatternForm.tsx`

**说明:** 创建一个可复用的模式表单组件，用于创建和编辑漏洞模式。包含所有必填和可选字段，支持表单验证。

- [ ] **Step 1: 创建组件目录和文件**

```bash
mkdir -p src/components/patterns
```

- [ ] **Step 2: 创建模式表单组件**

```typescript
// src/components/patterns/PatternForm.tsx

'use client';

import { useState } from 'react';
import { X, Plus } from 'lucide-react';

export interface PatternFormData {
  name: string;
  displayName: string;
  description: string;
  category: string;
  cwe: string;
  cve: string;
  patterns: string[];
  languages: string[];
  exampleVulnerable: string;
  exampleFixed: string;
  fixGuidance: string;
  isActive: boolean;
}

interface PatternFormProps {
  initialData?: Partial<PatternFormData>;
  onSubmit: (data: PatternFormData) => Promise<void>;
  onCancel: () => void;
  isEditing?: boolean;
  isBuiltin?: boolean;
}

const categoryOptions = [
  { value: 'code-audit', label: '代码安全审计' },
  { value: 'auth', label: '认证与授权' },
  { value: 'sensitive', label: '敏感信息泄露' },
  { value: 'api', label: 'API 安全' },
  { value: 'config', label: '依赖与配置' },
  { value: 'crypto', label: '加密与数据' },
  { value: 'web', label: 'Web 安全' },
  { value: 'business', label: '业务逻辑' },
  { value: 'client', label: '客户端安全' },
  { value: 'cloud', label: '云与容器安全' },
];

const languageOptions = [
  'JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust', 'C', 'C++',
  'PHP', 'Ruby', 'Swift', 'Kotlin', 'C#', 'SQL', 'Bash', 'YAML', 'JSON',
];

export default function PatternForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  isBuiltin = false,
}: PatternFormProps) {
  const [formData, setFormData] = useState<PatternFormData>({
    name: initialData?.name || '',
    displayName: initialData?.displayName || '',
    description: initialData?.description || '',
    category: initialData?.category || 'code-audit',
    cwe: initialData?.cwe || '',
    cve: initialData?.cve || '',
    patterns: initialData?.patterns || [],
    languages: initialData?.languages || [],
    exampleVulnerable: initialData?.exampleVulnerable || '',
    exampleFixed: initialData?.exampleFixed || '',
    fixGuidance: initialData?.fixGuidance || '',
    isActive: initialData?.isActive ?? true,
  });

  const [newPattern, setNewPattern] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      setFormData((prev) => ({
        ...prev,
        [name]: (e.target as HTMLInputElement).checked,
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        [name]: value,
      }));
    }
  };

  const handleAddPattern = () => {
    if (newPattern.trim() && !formData.patterns.includes(newPattern.trim())) {
      setFormData((prev) => ({
        ...prev,
        patterns: [...prev.patterns, newPattern.trim()],
      }));
      setNewPattern('');
    }
  };

  const handleRemovePattern = (pattern: string) => {
    setFormData((prev) => ({
      ...prev,
      patterns: prev.patterns.filter((p) => p !== pattern),
    }));
  };

  const handleLanguageToggle = (language: string) => {
    setFormData((prev) => ({
      ...prev,
      languages: prev.languages.includes(language)
        ? prev.languages.filter((l) => l !== language)
        : [...prev.languages, language],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      setError('模式名称不能为空');
      return;
    }
    if (!formData.displayName.trim()) {
      setError('显示名称不能为空');
      return;
    }
    if (!formData.description.trim()) {
      setError('描述不能为空');
      return;
    }
    if (formData.languages.length === 0) {
      setError('请至少选择一种编程语言');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await onSubmit(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* 基本信息 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">基本信息</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              模式名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              disabled={isEditing && isBuiltin}
              placeholder="例如：sql-injection"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
            <p className="mt-1 text-xs text-gray-500">唯一标识符，使用小写字母和连字符</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              显示名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="displayName"
              value={formData.displayName}
              onChange={handleChange}
              placeholder="例如：SQL 注入漏洞"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              分类 <span className="text-red-500">*</span>
            </label>
            <select
              name="category"
              value={formData.category}
              onChange={handleChange}
              disabled={isEditing && isBuiltin}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              {categoryOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">启用状态</label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                name="isActive"
                checked={formData.isActive}
                onChange={handleChange}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <span className="text-sm text-gray-700">启用此模式</span>
            </label>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              描述 <span className="text-red-500">*</span>
            </label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              rows={3}
              placeholder="描述此漏洞模式的特点和危害"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* CWE/CVE 映射 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">CWE/CVE 映射</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CWE 编号</label>
            <input
              type="text"
              name="cwe"
              value={formData.cwe}
              onChange={handleChange}
              placeholder="例如：CWE-89"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CVE 编号</label>
            <input
              type="text"
              name="cve"
              value={formData.cve}
              onChange={handleChange}
              placeholder="例如：CVE-2023-12345"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* 检测规则 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">检测模式</h3>
        <p className="text-sm text-gray-600 mb-4">
          添加用于检测此漏洞的模式字符串（如正则表达式、关键词等）
        </p>

        <div className="flex space-x-2 mb-4">
          <input
            type="text"
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            placeholder="输入检测模式"
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddPattern())}
          />
          <button
            type="button"
            onClick={handleAddPattern}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus size={20} />
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {formData.patterns.map((pattern) => (
            <span
              key={pattern}
              className="inline-flex items-center px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm"
            >
              {pattern}
              <button
                type="button"
                onClick={() => handleRemovePattern(pattern)}
                className="ml-2 text-blue-500 hover:text-blue-700"
              >
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* 适用语言 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          适用语言 <span className="text-red-500">*</span>
        </h3>

        <div className="flex flex-wrap gap-2">
          {languageOptions.map((language) => (
            <button
              key={language}
              type="button"
              onClick={() => handleLanguageToggle(language)}
              className={`px-3 py-1 rounded-full text-sm transition-colors ${
                formData.languages.includes(language)
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {language}
            </button>
          ))}
        </div>
      </div>

      {/* 代码示例 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">代码示例</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              漏洞示例代码
            </label>
            <textarea
              name="exampleVulnerable"
              value={formData.exampleVulnerable}
              onChange={handleChange}
              rows={6}
              placeholder="// 存在漏洞的代码示例"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              修复示例代码
            </label>
            <textarea
              name="exampleFixed"
              value={formData.exampleFixed}
              onChange={handleChange}
              rows={6}
              placeholder="// 修复后的代码示例"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
            />
          </div>
        </div>
      </div>

      {/* 修复建议 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">修复建议</h3>

        <textarea
          name="fixGuidance"
          value={formData.fixGuidance}
          onChange={handleChange}
          rows={4}
          placeholder="提供修复此漏洞的详细建议和最佳实践"
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* 提交按钮 */}
      <div className="flex justify-end space-x-4">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? '保存中...' : isEditing ? '更新模式' : '创建模式'}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: 提交**

```bash
git add src/components/patterns/PatternForm.tsx
git commit -m "feat(components): add PatternForm component for pattern management"
```

---

## Task 2: 创建模式创建页面

**Files:**
- Create: `src/app/dashboard/admin/patterns/create/page.tsx`

- [ ] **Step 1: 创建目录和页面文件**

```typescript
// src/app/dashboard/admin/patterns/create/page.tsx

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import PatternForm, { PatternFormData } from '@/components/patterns/PatternForm';

export default function CreatePatternPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (data: PatternFormData) => {
    try {
      setError(null);
      const token = localStorage.getItem('token');
      
      const response = await fetch('/api/patterns', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || '创建失败');
      }

      router.push('/dashboard/admin/patterns');
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
      throw err;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <button
          onClick={() => router.back()}
          className="p-2 hover:bg-gray-100 rounded-lg"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">创建漏洞模式</h1>
          <p className="mt-1 text-sm text-gray-600">
            添加新的漏洞检测模式到模式库
          </p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Form */}
      <PatternForm
        onSubmit={handleSubmit}
        onCancel={() => router.push('/dashboard/admin/patterns')}
      />
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add src/app/dashboard/admin/patterns/create/page.tsx
git commit -m "feat(ui): add pattern creation page"
```

---

## Task 3: 创建模式编辑页面

**Files:**
- Create: `src/app/dashboard/admin/patterns/[id]/page.tsx`

- [ ] **Step 1: 创建编辑页面**

```typescript
// src/app/dashboard/admin/patterns/[id]/page.tsx

'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import PatternForm, { PatternFormData } from '@/components/patterns/PatternForm';

interface Pattern {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  cwe: string | null;
  cve: string | null;
  patterns: string[];
  languages: string[];
  exampleVulnerable: string | null;
  exampleFixed: string | null;
  fixGuidance: string | null;
  isActive: boolean;
  isBuiltin: boolean;
}

export default function EditPatternPage() {
  const router = useRouter();
  const params = useParams();
  const patternId = params.id as string;

  const [pattern, setPattern] = useState<Pattern | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPattern();
  }, [patternId]);

  const fetchPattern = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/patterns/${patternId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error('获取模式详情失败');
      }

      const data = await response.json();
      setPattern(data.pattern);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (data: PatternFormData) => {
    try {
      setError(null);
      const token = localStorage.getItem('token');

      const response = await fetch(`/api/patterns/${patternId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || '更新失败');
      }

      router.push('/dashboard/admin/patterns');
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
      throw err;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!pattern) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">模式不存在</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <button
          onClick={() => router.back()}
          className="p-2 hover:bg-gray-100 rounded-lg"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">编辑漏洞模式</h1>
          <p className="mt-1 text-sm text-gray-600">
            {pattern.isBuiltin ? '内置模式只能修改启用状态' : '修改漏洞检测模式配置'}
          </p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Form */}
      <PatternForm
        initialData={{
          name: pattern.name,
          displayName: pattern.displayName,
          description: pattern.description,
          category: pattern.category,
          cwe: pattern.cwe || '',
          cve: pattern.cve || '',
          patterns: pattern.patterns,
          languages: pattern.languages,
          exampleVulnerable: pattern.exampleVulnerable || '',
          exampleFixed: pattern.exampleFixed || '',
          fixGuidance: pattern.fixGuidance || '',
          isActive: pattern.isActive,
        }}
        onSubmit={handleSubmit}
        onCancel={() => router.push('/dashboard/admin/patterns')}
        isEditing
        isBuiltin={pattern.isBuiltin}
      />
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add src/app/dashboard/admin/patterns/[id]/page.tsx
git commit -m "feat(ui): add pattern edit page with builtin protection"
```

---

## Task 4: 增强模式列表页面

**Files:**
- Modify: `src/app/dashboard/admin/patterns/page.tsx`

**说明:** 增强现有的模式列表页面，添加以下功能：
1. 分类筛选
2. 删除模式功能
3. 编辑和创建按钮链接
4. 分页支持

- [ ] **Step 1: 更新模式列表页面**

```typescript
// src/app/dashboard/admin/patterns/page.tsx

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Shield,
  Plus,
  Search,
  Edit,
  Trash2,
  Filter,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface Pattern {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  cwe: string | null;
  cve: string | null;
  patterns: string[];
  languages: string[];
  isActive: boolean;
  isBuiltin: boolean;
  createdAt: string;
}

const categoryLabels: Record<string, string> = {
  'code-audit': '代码安全审计',
  'auth': '认证与授权',
  'sensitive': '敏感信息泄露',
  'api': 'API 安全',
  'config': '依赖与配置',
  'crypto': '加密与数据',
  'web': 'Web 安全',
  'business': '业务逻辑',
  'client': '客户端安全',
  'cloud': '云与容器安全',
};

export default function PatternsPage() {
  const router = useRouter();
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [user, setUser] = useState<{ roles?: string[] } | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    }
  }, []);

  useEffect(() => {
    fetchPatterns();
  }, [page, categoryFilter]);

  const fetchPatterns = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
      });
      if (categoryFilter) {
        params.set('category', categoryFilter);
      }

      const response = await fetch(`/api/patterns?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取模式列表失败');
      }

      const data = await response.json();
      setPatterns(data.patterns || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (pattern: Pattern) => {
    if (pattern.isBuiltin) {
      alert('内置模式不能删除');
      return;
    }

    if (!confirm(`确定要删除模式 "${pattern.displayName}" 吗？`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/patterns/${pattern.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '删除失败');
      }

      fetchPatterns();
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleToggleActive = async (pattern: Pattern) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/patterns/${pattern.id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isActive: !pattern.isActive }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '更新失败');
      }

      fetchPatterns();
    } catch (err) {
      alert(err instanceof Error ? err.message : '更新失败');
    }
  };

  const filteredPatterns = patterns.filter(
    (pattern) =>
      pattern.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      pattern.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      pattern.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const isAdmin = user?.roles?.includes('admin');
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">漏洞模式库</h1>
          <p className="mt-1 text-sm text-gray-600">
            管理漏洞检测模式库，共 {total} 个模式
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => router.push('/dashboard/admin/patterns/create')}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={20} className="mr-2" />
            创建模式
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="搜索模式..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="flex items-center space-x-2">
          <Filter size={20} className="text-gray-400" />
          <select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">全部分类</option>
            {Object.entries(categoryLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      )}

      {/* Patterns List */}
      {!loading && (
        <div className="space-y-4">
          {filteredPatterns.length === 0 ? (
            <div className="bg-white rounded-lg shadow border border-gray-200 p-12">
              <div className="text-center">
                <Shield className="mx-auto h-16 w-16 text-gray-400" />
                <h3 className="mt-4 text-lg font-medium text-gray-900">暂无漏洞模式</h3>
                <p className="mt-2 text-sm text-gray-600">
                  {categoryFilter ? '当前分类下没有模式，请尝试其他分类' : '漏洞模式库为空，请添加检测模式'}
                </p>
              </div>
            </div>
          ) : (
            filteredPatterns.map((pattern) => (
              <div
                key={pattern.id}
                className="bg-white rounded-lg shadow border border-gray-200 p-4 hover:border-gray-300 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <h3 className="font-semibold text-gray-900">{pattern.displayName}</h3>
                      {pattern.isBuiltin && (
                        <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-800 rounded-full">
                          内置
                        </span>
                      )}
                      {!pattern.isActive && (
                        <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                          已禁用
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-600">{pattern.description}</p>
                    <div className="mt-2 flex items-center space-x-4 text-sm text-gray-500">
                      <span>{categoryLabels[pattern.category] || pattern.category}</span>
                      {pattern.cwe && <span>CWE: {pattern.cwe}</span>}
                      {pattern.cve && <span>CVE: {pattern.cve}</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {pattern.languages.slice(0, 5).map((lang) => (
                        <span key={lang} className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded">
                          {lang}
                        </span>
                      ))}
                      {pattern.languages.length > 5 && (
                        <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                          +{pattern.languages.length - 5}
                        </span>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center space-x-2 ml-4">
                      <button
                        onClick={() => handleToggleActive(pattern)}
                        className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                          pattern.isActive
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {pattern.isActive ? '已启用' : '已禁用'}
                      </button>
                      <button
                        onClick={() => router.push(`/dashboard/admin/patterns/${pattern.id}`)}
                        className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
                        title="编辑"
                      >
                        <Edit size={18} />
                      </button>
                      {!pattern.isBuiltin && (
                        <button
                          onClick={() => handleDelete(pattern)}
                          className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg"
                          title="删除"
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white rounded-lg shadow border border-gray-200 px-4 py-3">
          <div className="text-sm text-gray-600">
            显示第 {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, total)} 条，共 {total} 条
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm text-gray-600">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add src/app/dashboard/admin/patterns/page.tsx
git commit -m "feat(ui): enhance patterns list page with filter, pagination and delete"
```

---

## Task 5: 验证和最终提交

- [ ] **Step 1: 运行构建验证**

```bash
cd D:/claude-web-platform && npm run build
```

Expected: 构建成功，包含以下路由：
- `/dashboard/admin/patterns`
- `/dashboard/admin/patterns/create`
- `/dashboard/admin/patterns/[id]`

- [ ] **Step 2: 验证路由输出**

检查构建输出包含：
```
○ /dashboard/admin/patterns
○ /dashboard/admin/patterns/create
ƒ /dashboard/admin/patterns/[id]
```

- [ ] **Step 3: 最终提交**

```bash
git add -A
git commit -m "feat(ui): implement pattern management UI

- Add PatternForm reusable component
- Add pattern creation page
- Add pattern edit page with builtin protection
- Enhance patterns list with filter, pagination, delete
- Support toggle active status

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## 完成检查清单

- [ ] PatternForm 组件创建完成
- [ ] 创建模式页面完成
- [ ] 编辑模式页面完成
- [ ] 列表页面增强完成
- [ ] TypeScript 类型检查通过
- [ ] 构建成功
- [ ] 所有更改已提交

---

## 测试说明

1. **创建模式测试**:
   - 访问 `/dashboard/admin/patterns/create`
   - 填写所有必填字段（名称、显示名称、描述、语言）
   - 提交后应跳转到列表页

2. **编辑模式测试**:
   - 在列表页点击编辑按钮
   - 修改字段并保存
   - 内置模式只能修改启用状态

3. **删除模式测试**:
   - 点击删除按钮
   - 确认删除
   - 内置模式不应显示删除按钮

4. **筛选和分页测试**:
   - 使用分类筛选
   - 使用搜索框搜索
   - 测试分页导航
