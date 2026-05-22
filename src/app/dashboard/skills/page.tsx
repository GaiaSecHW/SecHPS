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
  vulnerabilityTreeId: string | null;
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
  id: string;
  name: string;
  displayName: string;
  type: string;
  skillCount: number;
  patterns: { id: string; name: string; displayName: string; skillCount: number }[];
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
  useEffect(() => { fetchCategories(); fetchVulnerabilityTree(); }, []);

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
      const response = await fetch('/api/skills/categories', { headers: { Authorization: `Bearer ${token}` } });
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
        setVulnerabilityTree(data.tree || []);
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
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-500/20 border-t-indigo-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-300 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {/* Toolbar + Filters + Card Grid */}
      <div className="bg-dark-surface border border-dark-border/40 rounded-xl">
        {/* Toolbar */}
        <div className="px-5 py-4 border-b border-dark-border/40">
          {/* Row 1: Search + Actions */}
          <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
            <div className="flex gap-3 flex-1 w-full lg:max-w-sm">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-text-muted" size={16} />
                <input
                  type="text"
                  placeholder="搜索 Skills..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  className="w-full pl-9 pr-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-dark-text placeholder-dark-text-muted focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              {searchTerm && (
                <button onClick={handleClearSearch} className="px-3 py-2 text-sm text-dark-text-secondary bg-dark-surface-hover rounded-lg hover:bg-dark-border transition-colors">
                  清除
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Batch operations */}
              {isAdmin && selectedSkills.size > 0 && (
                <>
                  <span className="text-sm text-dark-text-muted">已选 {selectedSkills.size}</span>
                  <button onClick={() => handleBatchOperation('enable')} disabled={batchOperating} className="inline-flex items-center px-3 py-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/20 disabled:opacity-50 transition-colors">
                    <CheckCircle size={14} className="mr-1" />启用
                  </button>
                  <button onClick={() => handleBatchOperation('disable')} disabled={batchOperating} className="inline-flex items-center px-3 py-1.5 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 disabled:opacity-50 transition-colors">
                    <XCircle size={14} className="mr-1" />禁用
                  </button>
                  <button onClick={() => handleBatchOperation('delete')} disabled={batchOperating} className="inline-flex items-center px-3 py-1.5 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg hover:bg-red-500/20 disabled:opacity-50 transition-colors">
                    <Trash2 size={14} className="mr-1" />删除
                  </button>
                  <div className="w-px h-5 bg-dark-border mx-1" />
                </>
              )}

              {isAdmin && (
                <button onClick={handleSyncFromGit} disabled={syncing} className="inline-flex items-center px-3 py-2 text-sm text-dark-text-secondary bg-dark-surface-hover rounded-lg hover:bg-dark-border disabled:opacity-50 transition-colors">
                  <RefreshCw size={14} className={`mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
                  同步仓库
                </button>
              )}
              <button onClick={() => router.push('/dashboard/skills/import-create')} className="inline-flex items-center px-3 py-2 text-sm text-dark-text-secondary bg-dark-surface-hover rounded-lg hover:bg-dark-border transition-colors">
                <FileUp size={14} className="mr-1.5" />导入创建
              </button>
              <button onClick={() => router.push('/dashboard/skills/create-wizard')} className="inline-flex items-center px-3 py-2 text-sm text-dark-text-secondary bg-dark-surface-hover rounded-lg hover:bg-dark-border transition-colors">
                <Plus size={14} className="mr-1.5" />引导创建
              </button>
              <button onClick={() => router.push('/dashboard/skills/create')} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition-colors">
                <Code size={14} />快速创建
              </button>
            </div>
          </div>

          {/* Row 2: Filters */}
          <div className="flex items-center gap-3 flex-wrap mt-3 pt-3 border-t border-dark-border/30">
            {isAdmin && skills.length > 0 && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={selectedSkills.size === skills.length && skills.length > 0} onChange={handleSelectAll} className="w-3.5 h-3.5 rounded border-dark-border" />
                <span className="text-sm text-dark-text-muted">全选</span>
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
              className="min-w-[130px] px-3 py-1.5 bg-dark-bg border border-dark-border rounded-lg text-sm text-dark-text focus:ring-1 focus:ring-indigo-500"
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
                  className="min-w-[130px] px-3 py-1.5 bg-dark-bg border border-dark-border rounded-lg text-sm text-dark-text focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">所有语言</option>
                  {vulnerabilityTree.map((lang) => (
                    <option key={lang.id} value={lang.id}>{lang.displayName} ({lang.skillCount})</option>
                  ))}
                </select>
              ) : null;
            })()}
            {selectedLanguageId && (() => {
              const selectedLang = vulnerabilityTree.find(l => l.id === selectedLanguageId);
              return selectedLang && selectedLang.patterns.length > 0 ? (
                <select
                  value={selectedPatternId}
                  onChange={(e) => {
                    setSelectedPatternId(e.target.value);
                    setCurrentPage(1);
                    updateUrlParams({ patternId: e.target.value || null, page: null });
                  }}
                  className="min-w-[130px] px-3 py-1.5 bg-dark-bg border border-dark-border rounded-lg text-sm text-dark-text focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">所有模式</option>
                  {selectedLang.patterns.map((pat) => (
                    <option key={pat.id} value={pat.id}>{pat.displayName} ({pat.skillCount})</option>
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
              className="min-w-[100px] px-3 py-1.5 bg-dark-bg border border-dark-border rounded-lg text-sm text-dark-text focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">所有状态</option>
              {activeStatusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <span className="text-sm text-dark-text-muted ml-auto">共 {totalSkills} 项</span>
          </div>
        </div>

        {/* Card Grid section */}
        {skills.length === 0 ? (
          <div className="p-12">
            <div className="text-center">
              <Award className="mx-auto h-12 w-12 text-dark-text-muted" />
              <p className="mt-4 text-sm text-dark-text-muted">
                {searchTerm || selectedCategoryId ? '没有找到匹配的 Skills，尝试调整筛选条件' : '暂无 Skills，点击创建按钮开始'}
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
                className={`group relative flex flex-col rounded-xl border border-dark-border/40 bg-dark-surface-hover/30 hover:bg-dark-surface-hover/60 transition-colors cursor-pointer min-h-[180px] ${
                  selectedSkills.has(skill.id) ? 'ring-2 ring-indigo-500 border-indigo-500/50' : ''
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
                      className="p-1 rounded text-dark-text-muted hover:text-dark-text-secondary hover:bg-dark-surface-hover"
                    >
                      <MoreVertical size={14} />
                    </button>
                    {menuOpenId === skill.id && (
                      <div className="absolute right-0 top-6 bg-dark-surface rounded-lg shadow-xl border border-dark-border py-1 min-w-[120px] z-20">
                        <button
                          onClick={() => { router.push(`/dashboard/skills/${skill.id}`); setMenuOpenId(null); }}
                          className="w-full px-3 py-1.5 text-left text-xs text-dark-text-secondary hover:bg-dark-surface-hover flex items-center gap-2"
                        >
                          <Edit size={12} /> {canEdit ? '编辑' : '查看'}
                        </button>
                        <button
                          onClick={() => { window.open(`/dashboard/skills/${skill.id}?sidebar=collapsed`, '_blank'); setMenuOpenId(null); }}
                          className="w-full px-3 py-1.5 text-left text-xs text-dark-text-secondary hover:bg-dark-surface-hover flex items-center gap-2"
                        >
                          <ExternalLink size={12} /> 新窗口
                        </button>
                        {canEdit && (
                          <button
                            onClick={() => { handleToggleActive(skill.id, skill.isActive); setMenuOpenId(null); }}
                            disabled={isToggling}
                            className="w-full px-3 py-1.5 text-left text-xs text-dark-text-secondary hover:bg-dark-surface-hover flex items-center gap-2 disabled:opacity-50"
                          >
                            {isToggling ? <><Loader2 size={12} className="animate-spin" /> 处理中</> : skill.isActive ? <><XCircle size={12} /> 禁用</> : <><CheckCircle size={12} /> 启用</>}
                          </button>
                        )}
                        {canShare && (
                          <button
                            onClick={() => { handleToggleShare(skill.id, skill.isPublic); setMenuOpenId(null); }}
                            className="w-full px-3 py-1.5 text-left text-xs text-dark-text-secondary hover:bg-dark-surface-hover flex items-center gap-2"
                          >
                            {skill.isPublic ? <><Globe size={12} /> 取消分享</> : <><Lock size={12} /> 分享</>}
                          </button>
                        )}
                        {canDelete && (
                          <>
                            <div className="border-t border-dark-border my-1" />
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
                        className="w-3.5 h-3.5 rounded border-dark-border bg-dark-bg"
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
                        <h3 className={`text-sm font-medium truncate leading-tight ${!skill.isActive ? 'text-dark-text-muted' : 'text-dark-text'}`}>{skill.displayName}</h3>
                        <p className="text-xs text-dark-text-muted truncate">{skill.name}</p>
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
                  <p className="text-xs text-dark-text-muted line-clamp-2 mt-3 flex-1 min-h-[2rem]">
                    {skill.description || '暂无描述'}
                  </p>

                  {/* Author + Metrics - align to bottom */}
                  <div className="mt-auto pt-2">
                    {skill.userName && (
                      <div className="flex items-center gap-1 text-xs text-dark-text-muted mb-1.5">
                        <User size={10} />
                        <span>{skill.userName}</span>
                      </div>
                    )}

                    {/* Metrics + Date */}
                    <div className="flex items-center justify-between text-xs text-dark-text-muted">
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
      {totalSkills > 0 && (
        <div className="flex items-center justify-between bg-dark-surface rounded-xl border border-dark-border/40 px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="text-sm text-dark-text-muted">
              共 {totalSkills} 条，第 {currentPage}/{totalPages} 页
            </span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
                updateUrlParams({ limit: Number(e.target.value), page: null });
              }}
              className="min-w-[90px] pl-3 pr-8 py-1.5 border border-dark-border rounded-lg text-sm bg-dark-bg text-dark-text"
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
              className="p-2 text-dark-text-secondary hover:bg-dark-surface-hover rounded-lg disabled:opacity-50 flex items-center flex-shrink-0 transition-colors"
            >
              <ChevronLeft size={18} className="flex-shrink-0" /><ChevronLeft size={18} className="-ml-2 flex-shrink-0" />
            </button>
            <button
              onClick={() => { const p = Math.max(1, currentPage - 1); setCurrentPage(p); updateUrlParams({ page: p === 1 ? null : p }); }}
              disabled={currentPage === 1}
              className="p-2 text-dark-text-secondary hover:bg-dark-surface-hover rounded-lg disabled:opacity-50 transition-colors"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="px-3 py-1.5 text-sm text-dark-text-secondary whitespace-nowrap">{currentPage} / {totalPages}</span>
            <button
              onClick={() => { const p = Math.min(totalPages, currentPage + 1); setCurrentPage(p); updateUrlParams({ page: p === 1 ? null : p }); }}
              disabled={currentPage === totalPages}
              className="p-2 text-dark-text-secondary hover:bg-dark-surface-hover rounded-lg disabled:opacity-50 transition-colors"
            >
              <ChevronRight size={20} />
            </button>
            <button
              onClick={() => { setCurrentPage(totalPages); updateUrlParams({ page: totalPages === 1 ? null : totalPages }); }}
              disabled={currentPage === totalPages}
              className="p-2 text-dark-text-secondary hover:bg-dark-surface-hover rounded-lg disabled:opacity-50 flex items-center flex-shrink-0 transition-colors"
            >
              <ChevronRight size={18} className="flex-shrink-0" /><ChevronRight size={18} className="-ml-2 flex-shrink-0" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
