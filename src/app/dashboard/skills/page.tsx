'use client';

import { Suspense, useEffect, useState, useRef, Fragment } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Award,
  Plus,
  Search,
  Filter,
  Play,
  Edit,
  Trash2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Save,
  RefreshCw,
  Code,
  ChevronLeft,
  ChevronRight,
  Download,
  Upload,
  Globe,
  Lock,
  ExternalLink,
  MoreVertical,
  Eye,
  Bug,
  Shield,
  LayoutDashboard,
  TrendingUp,
  User,
  FileUp,
  Loader2,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { DeveloperGuard } from '@/components/PermissionGuard';

interface Skill {
  id: string;
  name: string;
  displayName: string;
  description: string;
  categoryId: string;
  vulnerabilityTreeId: number | null;
  categoryName: string | null;
  categoryIcon: string | null;
  hasSubDimension: boolean;
  patternName: string | null;
  languageName: string | null;
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

interface SkillCategoryItem {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  icon: string | null;
  hasSubDimension: boolean;
  count: number;
}

interface VulnerabilityTreeLanguage {
  id: number;
  name: string;
  level: number;
  parent_id: number | null;
  library_id: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  'cat-vulnerability-mining': 'bg-red-600',
  'cat-code-audit': 'bg-blue-600',
  'cat-threat-modeling': 'bg-indigo-600',
  'cat-coding': 'bg-green-600',
  'cat-planning': 'bg-orange-600',
  'cat-data-analysis': 'bg-teal-500',
};

const CATEGORY_ICONS: Record<string, any> = {
  'Bug': Bug,
  'Search': Search,
  'Shield': Shield,
  'Code': Code,
  'LayoutDashboard': LayoutDashboard,
  'TrendUp': TrendingUp,
};

function formatNumber(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

export default function SkillsPage() {
  return (
    <DeveloperGuard>
      <Suspense fallback={<LoadingSpinner />}>
        <SkillsPageContent />
      </Suspense>
    </DeveloperGuard>
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

  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '');
  const [selectedCategoryId, setSelectedCategoryId] = useState(searchParams.get('categoryId') || '');
  const [selectedLanguageId, setSelectedLanguageId] = useState(searchParams.get('languageId') || '');
  const [selectedPatternId, setSelectedPatternId] = useState(searchParams.get('patternId') || '');
  const [selectedActiveStatus, setSelectedActiveStatus] = useState(searchParams.get('isActive') || 'true');

  const [categories, setCategories] = useState<SkillCategoryItem[]>([]);
  const [vulnerabilityTree, setVulnerabilityTree] = useState<VulnerabilityTreeLanguage[]>([]);
  const [user, setUser] = useState<{ id?: string; roles?: string[] } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [batchOperating, setBatchOperating] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  const [currentPage, setCurrentPage] = useState(Number(searchParams.get('page') || '1'));
  const [pageSize, setPageSize] = useState(Number(searchParams.get('limit') || '12'));
  const [totalPages, setTotalPages] = useState(1);

  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '');

  const activeStatusOptions = [
    { value: 'true', label: '已启用' },
    { value: 'false', label: '已禁用' },
  ];

  const updateUrlParams = (updates: Record<string, string | number | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '') {
        params.delete(key);
      } else if (key === 'page' && value === 1) {
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
    if (userData) setUser(JSON.parse(userData));
  }, []);

  useEffect(() => { fetchSkills(); }, [selectedCategoryId, selectedLanguageId, selectedPatternId, selectedActiveStatus, currentPage, pageSize, searchTerm]);
  useEffect(() => { fetchCategories(); fetchVulnerabilityTree(); }, [selectedActiveStatus]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    if (menuOpenId) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpenId]);

  const handleSearch = () => {
    setCurrentPage(1);
    updateUrlParams({ search: searchInput || null, page: null });
    setSearchTerm(searchInput);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSearch();
  };

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
      const params = new URLSearchParams();
      params.append('scope', 'mine');
      if (selectedCategoryId) params.append('categoryId', selectedCategoryId);
      if (selectedLanguageId) params.append('languageId', selectedLanguageId);
      if (selectedPatternId) params.append('patternId', selectedPatternId);
      if (selectedActiveStatus) params.append('isActive', selectedActiveStatus);
      if (searchTerm) params.append('search', searchTerm);
      params.append('page', currentPage.toString());
      params.append('limit', pageSize.toString());

      const response = await fetch(`/api/skills?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('获取 Skills 列表失败');
      const data = await response.json();
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
      const params = new URLSearchParams();
      if (selectedActiveStatus) params.append('isActive', selectedActiveStatus);
      const response = await fetch(`/api/skills/categories?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) {
        const data = await response.json();
        setCategories(data.categories || []);
      }
    } catch (err) {
      console.error('获取分类失败:', err);
    }
  };

  const fetchVulnerabilityTree = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/skills/vulnerability-tree', { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) {
        const data = await response.json();
        setVulnerabilityTree(data.nodes || []);
      }
    } catch (err) {
      console.error('获取漏洞模式树失败:', err);
    }
  };

  const handleSyncToDisk = async () => {
    if (!confirm('确定要将所有 Skills 同步到磁盘吗？')) return;
    try {
      setSyncing(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/sync/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'sync' }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '同步失败');
      }
      const data = await response.json();
      toast.success(`同步成功！总计: ${data.total}，成功: ${data.success}，失败: ${data.failed}`);
      fetchSkills();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const handleDelete = async (skillId: string, skillName: string) => {
    if (!confirm(`确定要删除 Skill "${skillName}" 吗？`)) return;
    setDeletingIds(prev => new Set(prev).add(skillId));
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${skillId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '删除失败');
      }
      fetchSkills();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeletingIds(prev => { const next = new Set(prev); next.delete(skillId); return next; });
    }
  };

  const handleToggleActive = async (skillId: string, currentActive: boolean) => {
    setTogglingIds(prev => new Set(prev).add(skillId));
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${skillId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentActive }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '更新失败');
      }
      fetchSkills();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setTogglingIds(prev => { const next = new Set(prev); next.delete(skillId); return next; });
    }
  };

  const handleToggleShare = async (skillId: string, currentPublic: boolean) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${skillId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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

  const handleSelectSkill = (skillId: string) => {
    const newSelected = new Set(selectedSkills);
    if (newSelected.has(skillId)) newSelected.delete(skillId);
    else newSelected.add(skillId);
    setSelectedSkills(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedSkills.size === skills.length) setSelectedSkills(new Set());
    else setSelectedSkills(new Set(skills.map(s => s.id)));
  };

  const handleBatchOperation = async (action: 'enable' | 'disable' | 'delete') => {
    if (selectedSkills.size === 0) { toast.error('请先选择要操作的 Skill'); return; }
    const actionText = action === 'enable' ? '启用' : action === 'disable' ? '禁用' : '删除';
    if (!confirm(`确定要批量${actionText} ${selectedSkills.size} 个 Skill 吗？`)) return;
    try {
      setBatchOperating(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/skills/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, skillIds: Array.from(selectedSkills) }),
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

  const handleExportSkills = async () => {
    if (!confirm('确定要导出所有 Skills 吗？')) return;
    try {
      setExporting(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/skills/export', { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '导出失败');
      }
      const data = await response.json();
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
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || '导入失败');
      }
      const result = await response.json();
      const { results } = result;
      let message = `导入完成！总计: ${results.total}，成功: ${results.success}，跳过: ${results.skipped}，失败: ${results.failed}`;
      if (results.errors.length > 0) message += `\n${results.errors.slice(0, 5).join('\n')}`;
      toast(message, { icon: '📋', duration: 6000 });
      fetchSkills();
      fetchCategories();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入失败');
    } finally {
      setImporting(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleSyncFromGit = async () => {
    try {
      setSyncing(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/skills/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || '同步失败');
      }
      
      const result = await response.json();
      toast.success(`同步成功！${result.message}`);
      fetchSkills();
      fetchCategories();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const isAdmin = user?.roles?.includes('admin');

  const getCategoryIcon = (skill: Skill) => {
    const iconName = skill.categoryIcon;
    if (iconName && CATEGORY_ICONS[iconName]) return CATEGORY_ICONS[iconName];
    return Bug;
  };

  if (loading && skills.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
            <Award size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Skill市场</h1>
            <p className="text-sm text-gray-400 mt-0.5">共 <span className="text-primary-400 font-medium">{totalSkills}</span> 个 Skills</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap justify-end">
          {isAdmin && selectedSkills.size > 0 && (
            <>
              <span className="text-sm text-gray-400">已选 {selectedSkills.size} 项</span>
              <button onClick={() => handleBatchOperation('enable')} disabled={batchOperating} className="inline-flex items-center px-4 py-2 bg-green-500/15 text-green-400 border border-green-500/20 rounded-lg hover:bg-green-600/25 text-sm disabled:opacity-50">
                <CheckCircle size={16} className="mr-1.5" />批量启用
              </button>
              <button onClick={() => handleBatchOperation('disable')} disabled={batchOperating} className="inline-flex items-center px-4 py-2 bg-yellow-500/15 text-yellow-400 border border-yellow-500/20 rounded-lg hover:bg-yellow-600/25 text-sm disabled:opacity-50">
                <XCircle size={16} className="mr-1.5" />批量禁用
              </button>
              <button onClick={() => handleBatchOperation('delete')} disabled={batchOperating} className="inline-flex items-center px-4 py-2 bg-red-500/15 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-600/25 text-sm disabled:opacity-50">
                <Trash2 size={16} className="mr-1.5" />批量删除
              </button>
            </>
          )}
          {/* 隐藏同步磁盘、导出、导入按钮 */}
          {/* {isAdmin && (
            <>
              <button onClick={handleSyncToDisk} disabled={syncing} className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50">
                {syncing ? <RefreshCw size={16} className="mr-1.5 animate-spin" /> : <Save size={16} className="mr-1.5" />}
                同步磁盘
              </button>
              <button onClick={handleExportSkills} disabled={exporting} className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 text-sm disabled:opacity-50">
                {exporting ? <RefreshCw size={16} className="mr-1.5 animate-spin" /> : <Download size={16} className="mr-1.5" />}
                导出
              </button>
              <label className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 text-sm cursor-pointer disabled:opacity-50">
                {importing ? <RefreshCw size={16} className="mr-1.5 animate-spin" /> : <Upload size={16} className="mr-1.5" />}
                导入
                <input type="file" accept=".json" onChange={handleImportSkills} disabled={importing} className="sr-only" />
              </label>
            </>
          )} */}
          {isAdmin && (
            <button onClick={handleSyncFromGit} disabled={syncing} className="inline-flex items-center px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm disabled:opacity-50 transition-all">
              {syncing ? <RefreshCw size={16} className="mr-1.5 animate-spin" /> : <RefreshCw size={16} className="mr-1.5" />}
              同步仓库
            </button>
          )}
          <button onClick={() => router.push('/dashboard/skills/create-wizard')} className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-purple-600 to-purple-500 text-white rounded-lg hover:from-purple-500 hover:to-purple-400 text-sm transition-all duration-200 shadow-sm hover:shadow-purple-500/25">
            <Plus size={16} className="mr-1.5" />引导创建
          </button>
          <button onClick={() => router.push('/dashboard/skills/create')} className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-primary-600 to-primary-500 text-white rounded-lg hover:from-primary-500 hover:to-primary-400 text-sm transition-all duration-200 shadow-sm hover:shadow-primary-500/25">
            <Code size={16} className="mr-1.5" />快速创建
          </button>
          <button onClick={() => router.push('/dashboard/skills/import-create')} className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-green-600 to-teal-500 text-white rounded-lg hover:from-green-500 hover:to-teal-400 text-sm transition-all duration-200 shadow-sm hover:shadow-green-500/25">
            <FileUp size={16} className="mr-1.5" />导入创建
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/20 border border-red-800/40 text-red-300 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {/* Filters + Card Grid combined */}
      <div className="bg-dark-surface border border-gray-700/50 rounded-xl">
        {/* Filters section */}
        <div className="px-5 py-4 border-b border-gray-700/50">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            {/* 搜索框 */}
            <div className="flex gap-3 flex-1 w-full sm:max-w-md">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="text"
                  placeholder="搜索 Skills..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  className="w-full pl-10 pr-3 py-2.5 bg-dark-bg border border-gray-700/50 rounded-lg focus:ring-2 focus:ring-primary-500 text-gray-100 placeholder-gray-500 text-sm"
                />
              </div>
              <button onClick={handleSearch} className="px-4 py-2.5 bg-primary-500 text-white rounded-lg font-medium text-sm shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:bg-primary-400 transition-all">
                搜索
              </button>
              {searchTerm && (
                <button onClick={handleClearSearch} className="px-4 py-2.5 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 text-sm transition-colors">
                  清除
                </button>
              )}
            </div>
            
            {/* 筛选控件 */}
            <div className="flex items-center gap-3 flex-wrap">
              {isAdmin && skills.length > 0 && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={selectedSkills.size === skills.length && skills.length > 0} onChange={handleSelectAll} className="w-4 h-4 text-primary-600 border-gray-600 rounded" />
                  <span className="text-sm text-gray-400">全选</span>
                </label>
              )}
              <select
                value={selectedCategoryId}
                onChange={(e) => {
                  setSelectedCategoryId(e.target.value);
                  setSelectedLanguageId('');
                  setSelectedPatternId('');
                  setCurrentPage(1);
                  updateUrlParams({ categoryId: e.target.value || null, languageId: null, patternId: null, page: null });
                }}
                className="w-[140px] px-3 py-2.5 bg-dark-bg border border-gray-700/50 rounded-lg text-sm text-gray-100 focus:ring-2 focus:ring-primary-500"
              >
                <option value="">所有分类</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.displayName} ({cat.count})</option>
                ))}
              </select>
            {(() => {
              const selectedCat = categories.find(c => c.id === selectedCategoryId);
              return selectedCat?.hasSubDimension ? (
                <select
                  value={selectedLanguageId}
                  onChange={(e) => {
                    setSelectedLanguageId(e.target.value);
                    setSelectedPatternId('');
                    setCurrentPage(1);
                    updateUrlParams({ languageId: e.target.value || null, patternId: null, page: null });
                  }}
                  className="w-[140px] px-3 py-2.5 bg-dark-bg border border-gray-700/50 rounded-lg text-sm text-gray-100 focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">所有模式库</option>
                  {vulnerabilityTree.filter(n => n.level === 0).map((lib) => (
                    <option key={lib.id} value={lib.id}>{lib.name}</option>
                  ))}
                </select>
              ) : null;
            })()}
            {selectedLanguageId && (() => {
              const libChildren = vulnerabilityTree.filter(n => n.parent_id === Number(selectedLanguageId));
              return libChildren.length > 0 ? (
                <select
                  value={selectedPatternId}
                  onChange={(e) => {
                    setSelectedPatternId(e.target.value);
                    setCurrentPage(1);
                    updateUrlParams({ patternId: e.target.value || null, page: null });
                  }}
                  className="w-[140px] px-3 py-2.5 bg-dark-bg border border-gray-700/50 rounded-lg text-sm text-gray-100 focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">所有模式</option>
                  {libChildren.map((node) => (
                    <option key={node.id} value={node.id}>{node.name}</option>
                  ))}
                </select>
              ) : null;
            })()}
            <select
              value={selectedActiveStatus}
              onChange={(e) => {
                setSelectedActiveStatus(e.target.value);
                setCurrentPage(1);
                updateUrlParams({ isActive: e.target.value || null, page: null });
              }}
              className="w-[140px] px-3 py-2.5 bg-dark-bg border border-gray-700/50 rounded-lg text-sm text-gray-100 focus:ring-2 focus:ring-primary-500"
            >
              <option value="">所有状态</option>
              {activeStatusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          </div>
        </div>

        {/* Card Grid section */}
        {skills.length === 0 ? (
          <div className="p-12">
            <div className="text-center">
              <Award className="mx-auto h-16 w-16 text-gray-500 opacity-60" />
              <h3 className="mt-4 text-lg font-medium text-gray-100">暂无 Skills</h3>
              <p className="mt-2 text-sm text-gray-500">
                {searchTerm || selectedCategoryId ? '没有找到匹配的 Skills，尝试调整筛选条件' : '点击右上角按钮创建新 Skill'}
              </p>
            </div>
          </div>
        ) : (
        <div className="p-5">
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {skills.map((skill) => {
            const IconComp = getCategoryIcon(skill);
            const iconColor = CATEGORY_COLORS[skill.categoryId] || 'bg-gray-600';
            const canEdit = isAdmin || (skill.userId !== null && skill.userId === user?.id);
            const canDelete = isAdmin || (skill.userId !== null && skill.userId === user?.id && !skill.isBuiltin);
            const canShare = skill.userId !== null && skill.userId === user?.id;
            const isToggling = togglingIds.has(skill.id);
            const isDeleting = deletingIds.has(skill.id);

            return (
              <div
                key={skill.id}
                className={`group relative flex flex-col rounded border border-gray-600/50 bg-gray-700/30 hover:bg-gray-700/50 transition-colors cursor-pointer min-h-[180px] ${
                  selectedSkills.has(skill.id) ? 'ring-2 ring-primary-500 border-primary-500/50' : ''
                }`}
                onClick={() => router.push(`/dashboard/skills/${skill.id}`)}
              >
                {/* Top right: more menu + checkbox */}
                <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
                  {/* More menu */}
                  <div
                    onClick={(e) => { e.stopPropagation(); }}
                    ref={menuOpenId === skill.id ? menuRef : null}
                  >
                    <button
                      onClick={() => setMenuOpenId(menuOpenId === skill.id ? null : skill.id)}
                      className="p-1 rounded text-gray-400 hover:text-gray-300 hover:bg-gray-600/30"
                    >
                      <MoreVertical size={14} />
                    </button>
                    {menuOpenId === skill.id && (
                      <div className="absolute right-0 top-6 bg-dark-surface rounded-lg shadow-xl border border-gray-700 py-1 min-w-[120px] z-20">
                        <button
                          onClick={() => { router.push(`/dashboard/skills/${skill.id}`); setMenuOpenId(null); }}
                          className="w-full px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-700/30 flex items-center gap-2"
                        >
                          <Edit size={12} /> {canEdit ? '编辑' : '查看'}
                        </button>
                        <button
                          onClick={() => { window.open(`/dashboard/skills/${skill.id}?sidebar=collapsed`, '_blank'); setMenuOpenId(null); }}
                          className="w-full px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-700/30 flex items-center gap-2"
                        >
                          <ExternalLink size={12} /> 新窗口
                        </button>
                        {canEdit && (
                          <button
                            onClick={() => { handleToggleActive(skill.id, skill.isActive); setMenuOpenId(null); }}
                            disabled={isToggling}
                            className="w-full px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-700/30 flex items-center gap-2 disabled:opacity-50"
                          >
                            {isToggling ? <><Loader2 size={12} className="animate-spin" /> 处理中</> : skill.isActive ? <><XCircle size={12} /> 禁用</> : <><CheckCircle size={12} /> 启用</>}
                          </button>
                        )}
                        {canShare && (
                          <button
                            onClick={() => { handleToggleShare(skill.id, skill.isPublic); setMenuOpenId(null); }}
                            className="w-full px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-700/30 flex items-center gap-2"
                          >
                            {skill.isPublic ? <><Globe size={12} /> 取消分享</> : <><Lock size={12} /> 分享</>}
                          </button>
                        )}
                        {canDelete && (
                          <>
                            <div className="border-t border-gray-700 my-1" />
                            <button
                              onClick={() => { handleDelete(skill.id, skill.displayName); setMenuOpenId(null); }}
                              disabled={isDeleting}
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-red-500/15 text-red-400 flex items-center gap-2 disabled:opacity-50"
                            >
                              {isDeleting ? <><Loader2 size={12} className="animate-spin" /> 删除中</> : <><Trash2 size={12} /> 删除</>}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  
                  {/* Checkbox */}
                  {isAdmin && (
                    <div onClick={(e) => { e.stopPropagation(); }}>
                      <input
                        type="checkbox"
                        checked={selectedSkills.has(skill.id)}
                        onChange={() => handleSelectSkill(skill.id)}
                        className="w-3.5 h-3.5 text-primary-500 border-gray-600 rounded focus:ring-primary-500 bg-dark-bg"
                      />
                    </div>
                  )}
                </div>

                {/* Card content */}
                <div className="flex-1 p-4 flex flex-col">
                  {/* Title row - add right padding to avoid overlap */}
                  <div className="flex items-start justify-between gap-3 pr-14">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-7 h-7 rounded flex items-center justify-center flex-shrink-0 ${
                        iconColor === 'bg-red-600' ? 'bg-gradient-to-br from-red-500 to-red-700' :
                        iconColor === 'bg-blue-600' ? 'bg-gradient-to-br from-blue-500 to-blue-700' :
                        iconColor === 'bg-indigo-600' ? 'bg-gradient-to-br from-indigo-500 to-indigo-700' :
                        iconColor === 'bg-green-600' ? 'bg-gradient-to-br from-green-500 to-green-700' :
                        iconColor === 'bg-orange-600' ? 'bg-gradient-to-br from-orange-500 to-orange-700' :
                        iconColor === 'bg-teal-500' ? 'bg-gradient-to-br from-teal-400 to-teal-600' :
                        'bg-gradient-to-br from-gray-500 to-gray-700'
                      }`}>
                        <IconComp className="text-white" size={14} />
                      </div>
                      <div className="min-w-0">
                        <h3 className={`text-sm font-medium truncate leading-tight ${!skill.isActive ? 'text-gray-400' : 'text-gray-100'}`}>{skill.displayName}</h3>
                        <p className="text-xs text-gray-500 truncate">{skill.name}</p>
                      </div>
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {skill.categoryName && (
                      <span className="px-2 py-0.5 text-xs bg-purple-500/15 text-purple-400 rounded">{skill.categoryName}</span>
                    )}
                    {skill.hasSubDimension && skill.languageName && (
                      <span className="px-2 py-0.5 text-xs bg-blue-500/15 text-blue-400 rounded">{skill.languageName}</span>
                    )}
                    {skill.isBuiltin && (
                      <span className="px-2 py-0.5 text-xs bg-indigo-500/15 text-indigo-400 rounded">内置</span>
                    )}
                    {!skill.isActive && (
                      <span className="px-2 py-0.5 text-xs bg-gray-500/15 text-gray-400 rounded">已禁用</span>
                    )}
                  </div>

                  {/* Description */}
                  <p className="text-xs text-gray-500 line-clamp-2 mt-3 flex-1 min-h-[2rem]">
                    {skill.description || '暂无描述'}
                  </p>

                  {/* Author + Metrics - align to bottom */}
                  <div className="mt-auto pt-2">
                    {skill.userName && (
                      <div className="flex items-center gap-1 text-xs text-gray-500 mb-1.5">
                        <User size={10} />
                        <span>{skill.userName}</span>
                      </div>
                    )}

                    {/* Metrics + Date */}
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1">
                          <Play size={10} /> {formatNumber(skill.execCount)}
                        </span>
                        <span className="flex items-center gap-1">
                          <AlertTriangle size={10} /> {formatNumber(skill.vulnerabilityCount)}
                        </span>
                      </div>
                      <span>{new Date(skill.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          </div>
        </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages >= 1 && (
        <div className="flex items-center justify-between bg-dark-surface rounded-xl shadow-sm border border-gray-700/50 px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">
              共 {totalSkills} 条，第 {currentPage}/{totalPages} 页
            </span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
                updateUrlParams({ limit: Number(e.target.value), page: null });
              }}
              className="w-[100px] px-3 py-1.5 border border-gray-600 rounded-lg text-sm bg-[#0F172A] text-gray-100"
            >
              <option value="12">12/页</option>
              <option value="24">24/页</option>
              <option value="36">36/页</option>
              <option value="100">100/页</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => { setCurrentPage(1); updateUrlParams({ page: null }); }}
              disabled={currentPage === 1}
              className="p-2 text-gray-400 hover:bg-dark-surface-hover rounded disabled:opacity-50 flex items-center flex-shrink-0"
            >
              <ChevronLeft size={18} className="flex-shrink-0" /><ChevronLeft size={18} className="-ml-2 flex-shrink-0" />
            </button>
            <button
              onClick={() => { const p = Math.max(1, currentPage - 1); setCurrentPage(p); updateUrlParams({ page: p === 1 ? null : p }); }}
              disabled={currentPage === 1}
              className="p-2 text-gray-400 hover:bg-dark-surface-hover rounded disabled:opacity-50"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="px-3 py-1.5 text-sm text-gray-300 whitespace-nowrap">{currentPage} / {totalPages}</span>
            <button
              onClick={() => { const p = Math.min(totalPages, currentPage + 1); setCurrentPage(p); updateUrlParams({ page: p === 1 ? null : p }); }}
              disabled={currentPage === totalPages}
              className="p-2 text-gray-400 hover:bg-dark-surface-hover rounded disabled:opacity-50"
            >
              <ChevronRight size={20} />
            </button>
            <button
              onClick={() => { setCurrentPage(totalPages); updateUrlParams({ page: totalPages === 1 ? null : totalPages }); }}
              disabled={currentPage === totalPages}
              className="p-2 text-gray-400 hover:bg-dark-surface-hover rounded disabled:opacity-50 flex items-center flex-shrink-0"
            >
              <ChevronRight size={18} className="flex-shrink-0" /><ChevronRight size={18} className="-ml-2 flex-shrink-0" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
