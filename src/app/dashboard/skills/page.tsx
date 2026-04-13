'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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
  Eye,
  X,
  Copy,
  Code,
  ChevronLeft,
  ChevronRight,
  Download,
  Upload,
} from 'lucide-react';

interface Skill {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  cwe: string | null;
  content: string;
  isActive: boolean;
  isBuiltin: boolean;
  version: number;
  parentId: string | null;
  isLatest: boolean;
  successRate: number | null;
  avgDuration: number | null;
  execCount: number;
  createdAt: string;
  updatedAt: string;
}

// 分类标签映射
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

export default function SkillsPage() {
  const router = useRouter();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [totalSkills, setTotalSkills] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedTechStack, setSelectedTechStack] = useState<string>('');
  const [categories, setCategories] = useState<{ name: string; label: string; count: number }[]>([]);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [user, setUser] = useState<{ roles?: string[] } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [previewSkill, setPreviewSkill] = useState<Skill | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [batchOperating, setBatchOperating] = useState(false);
  
  // 导出/导入状态
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useState<HTMLInputElement | null>(null);
  
  // 分页状态
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [searchDebounce, setSearchDebounce] = useState<NodeJS.Timeout | null>(null);
  
  // 技术栈选项
  const techStackOptions = [
    { name: 'Java', label: 'Java' },
    { name: 'Python', label: 'Python' },
    { name: 'Go', label: 'Go' },
    { name: 'PHP', label: 'PHP' },
    { name: 'JavaScript', label: 'JavaScript' },
    { name: 'Node.js', label: 'Node.js' },
    { name: 'C#', label: 'C#' },
    { name: '.NET', label: '.NET' },
    { name: 'Ruby', label: 'Ruby' },
    { name: 'Rust', label: 'Rust' },
    { name: 'C', label: 'C' },
    { name: 'C++', label: 'C++' },
  ];

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    }
  }, []);

  useEffect(() => {
    fetchSkills();
    fetchCategories();
  }, [selectedCategory, selectedTechStack, currentPage, pageSize]);
  
  // 搜索防抖
  useEffect(() => {
    if (searchDebounce) {
      clearTimeout(searchDebounce);
    }
    const timer = setTimeout(() => {
      setCurrentPage(1); // 搜索时重置到第一页
      fetchSkills();
    }, 300);
    setSearchDebounce(timer);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [searchTerm]);

  const fetchSkills = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      // 构建 URL 参数
      const params = new URLSearchParams();
      if (selectedCategory) params.append('category', selectedCategory);
      if (selectedTechStack) params.append('techStack', selectedTechStack);
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
      alert(`同步成功！\n\n总计: ${data.total}\n成功: ${data.success}\n失败: ${data.failed}`);
      
      // 刷新列表
      fetchSkills();
    } catch (err) {
      alert(err instanceof Error ? err.message : '同步失败');
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
      alert(err instanceof Error ? err.message : '删除失败');
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
      alert(err instanceof Error ? err.message : '更新失败');
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
      alert('请先选择要操作的 Skill');
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
      alert(`成功${actionText} ${selectedSkills.size} 个 Skill`);
    } catch (err) {
      alert(err instanceof Error ? err.message : '操作失败');
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

      alert(`导出成功！共 ${data.totalCount} 个 Skills`);
    } catch (err) {
      alert(err instanceof Error ? err.message : '导出失败');
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

      alert(message);
      
      // 刷新列表
      fetchSkills();
      fetchCategories();
    } catch (err) {
      alert(err instanceof Error ? err.message : '导入失败');
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

  // 复制 SKILL.md 到剪贴板
  const handleCopySkillMd = async (skill: Skill) => {
    try {
      const content = generateSkillMd(skill);
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('复制失败:', err);
    }
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
        {isAdmin && (
          <div className="flex items-center gap-3">
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
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="搜索 Skills..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
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
              onChange={(e) => setSelectedCategory(e.target.value)}
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
              onChange={(e) => setSelectedTechStack(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">所有技术栈</option>
              {techStackOptions.map((tech) => (
                <option key={tech.name} value={tech.name}>
                  {tech.label}
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
                    // 运行种子数据脚本提示
                    alert('请在服务器上运行: npx tsx prisma/seed-skills.ts');
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
                      </div>
                      <p className="text-sm text-gray-500">{skill.name}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <span className="text-sm text-gray-500">
                      {categoryLabels[skill.category] || skill.category}
                    </span>
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
                  </div>

                  {isAdmin && (
                    <div className="mt-4 flex items-center space-x-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewSkill(skill);
                        }}
                        className="inline-flex items-center px-3 py-1.5 text-sm bg-purple-100 text-purple-800 rounded hover:bg-purple-200"
                        title="预览 SKILL.md"
                      >
                        <Eye size={16} className="mr-1" />
                        预览
                      </button>
                      <button
                        onClick={() => router.push(`/dashboard/skills/${skill.id}`)}
                        className="inline-flex items-center px-3 py-1.5 text-sm bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
                      >
                        <Edit size={16} className="mr-1" />
                        查看详情
                      </button>
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
                      {!skill.isBuiltin && (
                        <button
                          onClick={() => handleDelete(skill.id, skill.displayName)}
                          className="inline-flex items-center px-3 py-1.5 text-sm bg-red-100 text-red-800 rounded hover:bg-red-200"
                        >
                          <Trash2 size={16} className="mr-1" />
                          删除
                        </button>
                      )}
                    </div>
                  )}
                  {!isAdmin && (
                    <div className="mt-4 flex items-center space-x-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewSkill(skill);
                        }}
                        className="inline-flex items-center px-3 py-1.5 text-sm bg-purple-100 text-purple-800 rounded hover:bg-purple-200"
                        title="预览 SKILL.md"
                      >
                        <Eye size={16} className="mr-1" />
                        预览
                      </button>
                      <button
                        onClick={() => router.push(`/dashboard/skills/${skill.id}`)}
                        className="inline-flex items-center px-3 py-1.5 text-sm bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
                      >
                        <Edit size={16} className="mr-1" />
                        查看详情
                      </button>
                    </div>
                  )}
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
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="p-1.5 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="首页"
            >
              <ChevronLeft size={16} />
              <ChevronLeft size={16} className="-ml-2" />
            </button>
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
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
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="p-1.5 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="下一页"
            >
              <ChevronRight size={20} />
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              className="p-1.5 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="末页"
            >
              <ChevronRight size={16} />
              <ChevronRight size={16} className="-ml-2" />
            </button>
          </div>
        </div>
      )}

      {/* SKILL.md 预览模态框 */}
      {previewSkill && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  SKILL.md 预览 - {previewSkill.displayName}
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  这是最终生成的 SKILL.md 文件内容，可直接用于 Claude Code
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleCopySkillMd(previewSkill)}
                  className="inline-flex items-center px-3 py-1.5 text-sm bg-blue-100 text-blue-800 rounded hover:bg-blue-200 transition-colors"
                >
                  <Copy size={16} className="mr-1" />
                  {copied ? '已复制!' : '复制'}
                </button>
                <button
                  onClick={() => {
                    setPreviewSkill(null);
                    setCopied(false);
                  }}
                  className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-auto p-4">
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm font-mono whitespace-pre-wrap break-all leading-relaxed">
                {generateSkillMd(previewSkill)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
