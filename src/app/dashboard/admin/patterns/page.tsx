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
