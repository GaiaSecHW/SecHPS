'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import toast from 'react-hot-toast';
import { ExternalLink } from 'lucide-react';
import {
  Award,
  Plus,
  Search,
  Filter,
  Play,
  Edit,
  Trash2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Save,
  RefreshCw,
  X,
  Code,
  ChevronLeft,
  ChevronRight,
  Download,
  Upload,
  Globe,
  Lock,
} from 'lucide-react';
import { useTechStackOptionsWithIds } from '@/hooks/useTechStackOptionsWithIds';

interface Skill {
  id: string;
  name: string;
  displayName: string;
  description: string;
  techStackId: string | null;
  techStackName: string | null;
  vulnerabilityPatternId: string | null;
  vulnerabilityPatternName: string | null;
  vulnerabilityPatternCategory: string | null;
  cwe: string | null;
  content: string;
  isActive: boolean;
  isBuiltin: boolean;
  isPublic: boolean;
  version: number;
  parentId: string | null;
  isLatest: boolean;
  successRate: number | null;
  avgDuration: number | null;
  execCount: number;
  vulnerabilityCount: number;
  createdAt: string;
  updatedAt: string;
  userId: string | null;
  userName: string | null;
  userUsername: string | null;
}


function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
    </div>
  );
}

export default function SkillsPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <SkillsPageContent />
    </Suspense>
  );
}

function SkillsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  
  const [skills, setSkills] = useState<Skill[]>([]);
  const [totalSkills, setTotalSkills] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 从 URL 参数初始化状态
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '');
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || '');
  const [selectedTechStack, setSelectedTechStack] = useState(searchParams.get('techStackId') || '');
  const [selectedActiveStatus, setSelectedActiveStatus] = useState(searchParams.get('isActive') || '');
  
  const [categories, setCategories] = useState<{ name: string; label: string; count: number }[]>([]);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [user, setUser] = useState<{ id?: string; roles?: string[] } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [batchOperating, setBatchOperating] = useState(false);
  
  // 导出/导入状态
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useState<HTMLInputElement | null>(null);
  
  // 分页状态 - 从 URL 参数初始化
  const [currentPage, setCurrentPage] = useState(Number(searchParams.get('page') || '1'));
  const [pageSize, setPageSize] = useState(Number(searchParams.get('limit') || '20'));
  const [totalPages, setTotalPages] = useState(1);
  
  // 搜索输入框的值（用于输入）
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');
  
  // 技术栈选项
  const { options: techStackOptions } = useTechStackOptionsWithIds();

  // 启用/禁用状态选项
  const activeStatusOptions = [
    { value: 'true', label: '已启用' },
    { value: 'false', label: '已禁用' },
  ];

  // 更新 URL 参数（保持分页和过滤状态）
  const updateUrlParams = (updates: Record<string, string | number | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '') {
        params.delete(key);
      } else if (key === 'page' && value === 1) {
        // 页码为 1 时不需要显示在 URL 中
        params.delete(key);
      } else {
        params.set(key, String(value));
      }
    });
    
    const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(newUrl, { scroll: false });
  };

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    }
  }, []);

  useEffect(() => {
    fetchSkills();
    fetchCategories();
  }, [selectedCategory, selectedTechStack, selectedActiveStatus, currentPage, pageSize, searchTerm]);
  
  // 执行搜索
  const handleSearch = () => {
    setCurrentPage(1);
    updateUrlParams({ search: searchInput || null, page: null });
    setSearchTerm(searchInput);
  };
  
  // 按回车搜索
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };
  
  // 清除搜索
  const handleClearSearch = () => {
    setSearchInput('');
    setSearchTerm('');
    setCurrentPage(1);
    updateUrlParams({ search: null, page: null });
  };

  const fetchSkills = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      // 构建 URL 参数
      const params = new URLSearchParams();
      // 管理页面：只看自己创建的技能
      params.append('scope', 'mine');
      if (selectedCategory) params.append('category', selectedCategory);
      if (selectedTechStack) params.append('techStackId', selectedTechStack);
      if (selectedActiveStatus) params.append('isActive', selectedActiveStatus);
      if (searchTerm) params.append('search', searchTerm);
      params.append('page', currentPage.toString());
      params.append('limit', pageSize.toString());
      
      const url = `/api/skills?${params.toString()}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取 Skills 列表失败');
      }

      const data = await response.json();
      // API returns { data: [...], pagination: {...} }
      setSkills(data.data || []);
      setTotalSkills(data.pagination?.total || 0);
      setTotalPages(data.pagination?.totalPages || 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/skills/categories', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setCategories(data.categories || []);
      }
    } catch (err) {
      console.error('获取分类失败:', err);
    }
  };

  const handleSyncToDisk = async () => {
    if (!confirm('确定要将所有 Skills 同步到磁盘吗？此操作将更新 data/skills/ 目录。')) {
      return;
    }

    try {
      setSyncing(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/sync/skills', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'sync' }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '同步失败');
      }

      const data = await response.json();
toast.success(`同步成功！\n\n总计: ${data.total}\n成功: ${data.success}\n失败: ${data.failed}`);
      
      // 刷新列表
      fetchSkills();
    } catch (err) {
toast.error(err instanceof Error ? err.message : '同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const handleDelete = async (skillId: string, skillName: string) => {
    if (!confirm(`确定要删除 Skill "${skillName}" 吗？`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${skillId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '删除失败');
      }

      fetchSkills();
    } catch (err) {
toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleToggleActive = async (skillId: string, currentActive: boolean) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${skillId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isActive: !currentActive }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '更新失败');
      }

      fetchSkills();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败');
    }
  };

  // 切换分享状态
  const handleToggleShare = async (skillId: string, currentPublic: boolean) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${skillId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isPublic: !currentPublic }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '更新失败');
      }

      fetchSkills();
      toast.success(currentPublic ? '已取消分享' : '已分享给其他用户');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  // 批量选择相关函数
  const handleSelectSkill = (skillId: string) => {
    const newSelected = new Set(selectedSkills);
    if (newSelected.has(skillId)) {
      newSelected.delete(skillId);
    } else {
      newSelected.add(skillId);
    }
    setSelectedSkills(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedSkills.size === filteredSkills.length) {
      setSelectedSkills(new Set());
    } else {
      setSelectedSkills(new Set(filteredSkills.map(s => s.id)));
    }
  };

  const handleBatchOperation = async (action: 'enable' | 'disable' | 'delete') => {
    if (selectedSkills.size === 0) {
      toast.error('请先选择要操作的 Skill');
      return;
    }

    const actionText = action === 'enable' ? '启用' : action === 'disable' ? '禁用' : '删除';
    if (!confirm(`确定要批量${actionText} ${selectedSkills.size} 个 Skill 吗？`)) {
      return;
    }

    try {
      setBatchOperating(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/skills/batch', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action,
          skillIds: Array.from(selectedSkills),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '操作失败');
      }

      setSelectedSkills(new Set());
      fetchSkills();
      toast.success(`成功${actionText} ${selectedSkills.size} 个 Skill`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBatchOperating(false);
    }
  };

  // 导出所有 Skills
  const handleExportSkills = async () => {
    if (!confirm('确定要导出所有 Skills 吗？')) {
      return;
    }

    try {
      setExporting(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/skills/export', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '导出失败');
      }

      const data = await response.json();
      
      // 创建下载文件
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `skills-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success(`导出成功！共 ${data.totalCount} 个 Skills`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  // 导入 Skills
  const handleImportSkills = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setImporting(true);
      const token = localStorage.getItem('token');
      
      const text = await file.text();
      const data = JSON.parse(text);

      const response = await fetch('/api/skills/import', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || '导入失败');
      }

      const result = await response.json();
      
      // 显示导入结果
      const { results } = result;
      let message = `导入完成！\n\n`;
      message += `总计: ${results.total}\n`;
      message += `成功: ${results.success}\n`;
      message += `跳过: ${results.skipped}\n`;
      message += `失败: ${results.failed}`;
      
      if (results.errors.length > 0) {
        message += `\n\n详细信息:\n${results.errors.slice(0, 10).join('\n')}`;
        if (results.errors.length > 10) {
          message += `\n... 还有 ${results.errors.length - 10} 条`;
        }
      }

      toast(message, { icon: '📋', duration: 6000 });
      
      // 刷新列表
      fetchSkills();
      fetchCategories();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入失败');
    } finally {
      setImporting(false);
      // 清空 input
      if (e.target) {
        e.target.value = '';
      }
    }
  };

  // 服务端已经过滤，直接使用 skills
  const filteredSkills = skills;

  const isAdmin = user?.roles?.includes('admin');

  // 生成 SKILL.md 格式内容 - 直接返回 content 字段
  const generateSkillMd = (skill: Skill): string => {
    return skill.content || '';  // 直接返回完整的 Markdown 内容
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Skills 管理</h1>
          <p className="mt-1 text-sm text-gray-600">
            管理 AI 漏洞检测技能，共 {totalSkills} 个 Skills
          </p>
        </div>
        <div className="flex items-center gap-3">
            {/* 管理员专用按钮 */}
            {isAdmin && (
              <>
                {/* 批量操作按钮 */}
                {selectedSkills.size > 0 && (
                  <>
                    <span className="text-sm text-gray-600">
                      已选择 {selectedSkills.size} 项
                    </span>
                    <button
                      onClick={() => handleBatchOperation('enable')}
                      disabled={batchOperating}
                      className="inline-flex items-center px-3 py-2 bg-green-100 text-green-800 rounded-lg hover:bg-green-200 transition-colors disabled:opacity-50"
                      title="批量启用选中的 Skills"
                    >
                      <CheckCircle size={16} className="mr-1" />
                      批量启用
                    </button>
                    <button
                      onClick={() => handleBatchOperation('disable')}
                      disabled={batchOperating}
                      className="inline-flex items-center px-3 py-2 bg-yellow-100 text-yellow-800 rounded-lg hover:bg-yellow-200 transition-colors disabled:opacity-50"
                      title="批量禁用选中的 Skills"
                    >
                      <XCircle size={16} className="mr-1" />
                      批量禁用
                    </button>
                    <button
                      onClick={() => handleBatchOperation('delete')}
                      disabled={batchOperating}
                      className="inline-flex items-center px-3 py-2 bg-red-100 text-red-800 rounded-lg hover:bg-red-200 transition-colors disabled:opacity-50"
                      title="批量删除选中的 Skills"
                    >
                      <Trash2 size={16} className="mr-1" />
                      批量删除
                    </button>
                  </>
                )}
                <button
                  onClick={handleSyncToDisk}
                  disabled={syncing}
                  className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="将所有 Skills 同步到磁盘存储"
                >
                  {syncing ? (
                    <>
                      <RefreshCw size={20} className="mr-2 animate-spin" />
                      同步中...
                    </>
                  ) : (
                    <>
                      <Save size={20} className="mr-2" />
                      同步到磁盘
                    </>
                  )}
                </button>
                {/* 导出按钮 */}
                <button
                  onClick={handleExportSkills}
                  disabled={exporting}
                  className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="导出所有 Skills 为 JSON 文件"
                >
                  {exporting ? (
                    <>
                      <RefreshCw size={20} className="mr-2 animate-spin" />
                      导出中...
                    </>
                  ) : (
                    <>
                      <Download size={20} className="mr-2" />
                      导出
                    </>
                  )}
                </button>
                {/* 导入按钮 */}
                <label
                  className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors cursor-pointer disabled:opacity-50"
                  title="从 JSON 文件导入 Skills"
                >
                  {importing ? (
                    <>
                      <RefreshCw size={20} className="mr-2 animate-spin" />
                      导入中...
                    </>
                  ) : (
                    <>
                      <Upload size={20} className="mr-2" />
                      导入
                    </>
                  )}
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleImportSkills}
                    disabled={importing}
                    className="sr-only"
                  />
                </label>
              </>
            )}
            {/* 创建按钮 - 所有用户都可以创建私有 Skill */}
            <button
              onClick={() => router.push('/dashboard/skills/create-wizard')}
              className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              <Plus size={20} className="mr-2" />
              引导式创建
            </button>
            <button
              onClick={() => router.push('/dashboard/skills/create')}
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Code size={20} className="mr-2" />
              快速创建
            </button>
          </div>
        </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                placeholder="搜索 Skills..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <button
              onClick={handleSearch}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
            >
              <Search size={18} />
              搜索
            </button>
            {searchTerm && (
              <button
                onClick={handleClearSearch}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                清除
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          {/* 全选复选框 */}
          {isAdmin && filteredSkills.length > 0 && (
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedSkills.size === filteredSkills.length && filteredSkills.length > 0}
                onChange={handleSelectAll}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">全选</span>
            </label>
          )}
          <div className="flex items-center gap-2">
            <Filter size={20} className="text-gray-400" />
            <select
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value);
                setCurrentPage(1);
                updateUrlParams({ category: e.target.value || null, page: null });
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">所有分类</option>
              {categories.map((cat) => (
                <option key={cat.name} value={cat.name}>
                  {cat.label} ({cat.count})
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Code size={20} className="text-gray-400" />
            <select
              value={selectedTechStack}
              onChange={(e) => {
                setSelectedTechStack(e.target.value);
                setCurrentPage(1);
                updateUrlParams({ techStackId: e.target.value || null, page: null });
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">所有技术栈</option>
              {techStackOptions.map((tech) => (
                <option key={tech.id} value={tech.id}>
                  {tech.name}
                </option>
              ))}
            </select>
          </div>
          {/* 启用/禁用状态过滤 */}
          <div className="flex items-center gap-2">
            <CheckCircle size={20} className="text-gray-400" />
            <select
              value={selectedActiveStatus}
              onChange={(e) => {
                setSelectedActiveStatus(e.target.value);
                setCurrentPage(1);
                updateUrlParams({ isActive: e.target.value || null, page: null });
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">所有状态</option>
              {activeStatusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Skills List */}
      <div className="space-y-4">
        {filteredSkills.length === 0 ? (
          <div className="bg-white rounded-lg shadow border border-gray-200 p-12">
            <div className="text-center">
              <Award className="mx-auto h-16 w-16 text-gray-400" />
              <h3 className="mt-4 text-lg font-medium text-gray-900">暂无 Skills</h3>
              <p className="mt-2 text-sm text-gray-600">
                {searchTerm || selectedCategory
                  ? '没有找到匹配的 Skills'
                  : '请先运行种子数据脚本初始化 Skills'}
              </p>
              {!searchTerm && !selectedCategory && isAdmin && (
                <button
                  onClick={() => {
                    // 运行数据库脚本提示
                    toast('运行数据库脚本: npx tsx prisma/seed-skills.ts', { icon: '🔧' });
                  }}
                  className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  初始化 Skills 数据
                </button>
              )}
            </div>
          </div>
        ) : (
          filteredSkills.map((skill) => (
            <div
              key={skill.id}
              className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden"
            >
              <div
                className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setExpandedSkill(expandedSkill === skill.id ? null : skill.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    {/* 复选框 */}
                    {isAdmin && (
                      <input
                        type="checkbox"
                        checked={selectedSkills.has(skill.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleSelectSkill(skill.id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                    )}
                    <div className={`p-2 rounded-lg ${skill.isActive ? 'bg-green-100' : 'bg-gray-100'}`}>
                      <Award className={skill.isActive ? 'text-green-600' : 'text-gray-400'} size={24} />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="font-semibold text-gray-900">{skill.displayName}</h3>
                        {skill.isBuiltin && (
                          <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-800 rounded-full">
                            内置
                          </span>
                        )}
                        {!skill.isActive && (
                          <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                            已禁用
                          </span>
                        )}
                        {/* 创建者标签 */}
                        {skill.userId !== null && (
                          <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                            {skill.userName || skill.userUsername || '未知用户'}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">{skill.name}</p>
                      {/* 统计信息 */}
                      <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Play size={12} />
                          执行: {skill.execCount}
                        </span>
                        <span className="flex items-center gap-1">
                          <AlertTriangle size={12} />
                          发现: {skill.vulnerabilityCount || 0}
                        </span>
                        {skill.successRate !== null && (
                          <span className={`flex items-center gap-1 ${
                            skill.successRate >= 0.8 ? 'text-green-600' :
                            skill.successRate >= 0.5 ? 'text-yellow-600' : 'text-red-600'
                          }`}>
                            <CheckCircle size={12} />
                            成功率: {(skill.successRate * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500">
                        {skill.vulnerabilityPatternCategory || skill.vulnerabilityPatternName || ''}
                      </span>
                      {/* 技术栈标签 */}
                      {skill.techStackName && (
                        <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                          {skill.techStackName}
                        </span>
                      )}
                    </div>
                    {expandedSkill === skill.id ? (
                      <ChevronUp size={20} className="text-gray-400" />
                    ) : (
                      <ChevronDown size={20} className="text-gray-400" />
                    )}
                  </div>
                </div>
              </div>

              {expandedSkill === skill.id && (
                <div className="border-t border-gray-200 p-4 bg-gray-50">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">描述</h4>
                      <p className="text-sm text-gray-600">{skill.description}</p>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">所属技术栈</h4>
                      {skill.techStackName ? (
                        <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                          {skill.techStackName}
                        </span>
                      ) : <p className="text-sm text-gray-600">无</p>}
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">CWE</h4>
                      <p className="text-sm text-gray-600">{skill.cwe || '无'}</p>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">版本信息</h4>
                      <div className="flex items-center space-x-2 text-sm text-gray-600">
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded">
                          v{skill.version}
                        </span>
                        {skill.isLatest && (
                          <span className="px-2 py-0.5 bg-green-100 text-green-800 rounded text-xs">
                            最新版本
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <h4 className="text-sm font-medium text-gray-700 mb-2">内容预览</h4>
                      <p className="text-sm text-gray-600 line-clamp-3">
                        {skill.content ? skill.content.substring(0, 300) + (skill.content.length > 300 ? '...' : '') : '无'}
                      </p>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">统计</h4>
                      <div className="flex items-center space-x-4 text-sm text-gray-600">
                        <span>执行次数: {skill.execCount}</span>
                        {skill.successRate !== null && (
                          <span>成功率: {(skill.successRate * 100).toFixed(1)}%</span>
                        )}
                        {skill.avgDuration !== null && (
                          <span>平均耗时: {skill.avgDuration}ms</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">创建时间</h4>
                      <p className="text-sm text-gray-600">
                        {new Date(skill.createdAt).toLocaleString('zh-CN')}
                      </p>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">创建者</h4>
                      <p className="text-sm text-gray-600">
                        {skill.userId === null ? (
                          <span className="text-purple-600">系统内置</span>
                        ) : (
                          skill.userName || skill.userUsername || '未知用户'
                        )}
                      </p>
                    </div>
                  </div>

                  {/* 操作按钮 - 根据权限显示 */}
                  {(() => {
                    const canEdit = isAdmin || (skill.userId !== null && skill.userId === user?.id);
                    const canDelete = isAdmin || (skill.userId !== null && skill.userId === user?.id && !skill.isBuiltin);
                    const canShare = skill.userId !== null && skill.userId === user?.id;  // 只有私有 Skill 的所有者可以分享
                    
                    return (
                      <div className="mt-4 flex items-center space-x-2">
                        <button
                          onClick={() => router.push(`/dashboard/skills/${skill.id}`)}
                          className="inline-flex items-center px-3 py-1.5 text-sm bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
                        >
                          <Edit size={16} className="mr-1" />
                          {canEdit ? '编辑' : '查看详情'}
                        </button>
                        <button
                          onClick={() => window.open(`/dashboard/skills/${skill.id}?sidebar=collapsed`, '_blank')}
                          className="inline-flex items-center px-3 py-1.5 text-sm bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
                          title="在新窗口中打开详情页"
                        >
                          <ExternalLink size={16} className="mr-1" />
                          新窗口查看
                        </button>
                        {canEdit && (
                          <button
                            onClick={() => handleToggleActive(skill.id, skill.isActive)}
                            className={`inline-flex items-center px-3 py-1.5 text-sm rounded ${
                              skill.isActive
                                ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                                : 'bg-green-100 text-green-800 hover:bg-green-200'
                            }`}
                          >
                            {skill.isActive ? (
                              <>
                                <XCircle size={16} className="mr-1" />
                                禁用
                              </>
                            ) : (
                              <>
                                <CheckCircle size={16} className="mr-1" />
                                启用
                              </>
                            )}
                          </button>
                        )}
                        {canShare && (
                          <button
                            onClick={() => handleToggleShare(skill.id, skill.isPublic)}
                            className={`inline-flex items-center px-3 py-1.5 text-sm rounded ${
                              skill.isPublic
                                ? 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                            title={skill.isPublic ? '取消分享' : '分享给其他用户'}
                          >
                            {skill.isPublic ? (
                              <>
                                <Globe size={16} className="mr-1" />
                                已分享
                              </>
                            ) : (
                              <>
                                <Lock size={16} className="mr-1" />
                                分享
                              </>
                            )}
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => handleDelete(skill.id, skill.displayName)}
                            className="inline-flex items-center px-3 py-1.5 text-sm bg-red-100 text-red-800 rounded hover:bg-red-200"
                          >
                            <Trash2 size={16} className="mr-1" />
                            删除
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* 分页控件 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white rounded-lg shadow border border-gray-200 px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              共 {totalSkills} 条记录，第 {currentPage} / {totalPages} 页
            </span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
                updateUrlParams({ limit: Number(e.target.value), page: null });
              }}
              className="px-2 py-1 border border-gray-300 rounded text-sm"
            >
              <option value="10">10 条/页</option>
              <option value="20">20 条/页</option>
              <option value="50">50 条/页</option>
              <option value="100">100 条/页</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setCurrentPage(1);
                updateUrlParams({ page: null });
              }}
              disabled={currentPage === 1}
              className="flex items-center p-1.5 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="首页"
            >
              <ChevronLeft size={16} />
              <ChevronLeft size={16} className="-ml-2" />
            </button>
            <button
              onClick={() => {
                const newPage = Math.max(1, currentPage - 1);
                setCurrentPage(newPage);
                updateUrlParams({ page: newPage === 1 ? null : newPage });
              }}
              disabled={currentPage === 1}
              className="p-1.5 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="上一页"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="px-3 py-1 text-sm text-gray-700">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => {
                const newPage = Math.min(totalPages, currentPage + 1);
                setCurrentPage(newPage);
                updateUrlParams({ page: newPage === 1 ? null : newPage });
              }}
              disabled={currentPage === totalPages}
              className="p-1.5 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="下一页"
            >
              <ChevronRight size={20} />
            </button>
            <button
              onClick={() => {
                setCurrentPage(totalPages);
                updateUrlParams({ page: totalPages === 1 ? null : totalPages });
              }}
              disabled={currentPage === totalPages}
              className="flex items-center p-1.5 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="末页"
            >
              <ChevronRight size={16} />
              <ChevronRight size={16} className="-ml-2" />
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
