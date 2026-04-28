'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Bug,
  Search,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Shield,
  ChevronLeft,
  ChevronRight,
  Filter,
  FileCode,
  Clock,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface Vulnerability {
  id: string;
  projectId: string;
  title: string;
  description: string;
  type: string;
  cwe: string | null;
  severity: string;
  status: string;
  location: string | null;       // 问题代码位置
  POC: string | null;            // POC 验证代码
  vulnerable: boolean | null;    // 是否为真实漏洞
  skill: string | null;
  createdAt: string;
  project?: {
    id: string;
    name: string;
  };
}

interface Skill {
  id: string;
  name: string;
  displayName: string;
}

const statusColors: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800',
  pending: 'bg-gray-100 text-gray-800',
  confirmed: 'bg-yellow-100 text-yellow-800',
  'false-positive': 'bg-gray-100 text-gray-600',
  false_positive: 'bg-gray-100 text-gray-600',
  fixed: 'bg-green-100 text-green-800',
  verified: 'bg-purple-100 text-purple-800',
  closed: 'bg-gray-100 text-gray-600',
};

const statusLabels: Record<string, string> = {
  new: '新建',
  pending: '未确认',
  confirmed: '正确发现',
  'false-positive': '误报',
  false_positive: '误报',
  fixed: '已修复',
  verified: '已验证',
  closed: '已关闭',
};

const severityColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-blue-100 text-blue-800',
  info: 'bg-gray-100 text-gray-600',
};

export default function VulnerabilitiesPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <VulnerabilitiesPageContent />
    </Suspense>
  );
}

function VulnerabilitiesPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [vulnerabilities, setVulnerabilities] = useState<Vulnerability[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 从 URL 参数初始化状态
  const skillIdFromUrl = searchParams.get('skillId') || '';
  const statusFromUrl = searchParams.get('status') || '';

  const [selectedSkillId, setSelectedSkillId] = useState(skillIdFromUrl);
  const [selectedStatus, setSelectedStatus] = useState(statusFromUrl);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // 分页状态
  const [currentPage, setCurrentPage] = useState(Number(searchParams.get('page') || '1'));
  const [pageSize, setPageSize] = useState(Number(searchParams.get('limit') || '20'));
  const [totalCount, setTotalCount] = useState(0);
  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  // 更新 URL 参数
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
    fetchSkills();
  }, []);

  useEffect(() => {
    fetchVulnerabilities();
  }, [selectedSkillId, selectedStatus, currentPage, pageSize, searchTerm]);

  const fetchSkills = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/skills?scope=all&isActive=true&limit=100', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setSkills(data.data || []);
      }
    } catch (err) {
      console.error('获取 Skills 列表失败:', err);
    }
  };

  const fetchVulnerabilities = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');

      const params = new URLSearchParams();
      if (selectedSkillId) {
        params.append('skillId', selectedSkillId);
      }
      if (selectedStatus) {
        params.append('status', selectedStatus);
      }
      if (searchTerm) {
        params.append('search', searchTerm);
      }
      params.append('page', currentPage.toString());
      params.append('limit', pageSize.toString());

      const response = await fetch(`/api/vulnerabilities?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error('获取漏洞列表失败');
      }

      const data = await response.json();
      setVulnerabilities(data.data || []);
      setTotalCount(data.pagination?.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  // 执行搜索
  const handleSearch = () => {
    setCurrentPage(1);
    setSearchTerm(searchInput);
    updateUrlParams({ search: searchInput || null, page: null });
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

  // 点击行跳转到详情页
  const handleRowClick = (vulnId: string) => {
    router.push(`/vulnerabilities/${vulnId}`);
  };

  // 状态筛选选项
  const statusOptions = [
    { value: '', label: '全部' },
    { value: 'pending', label: '未确认' },
    { value: 'confirmed', label: '正确发现' },
    { value: 'false_positive', label: '误报' },
    { value: 'new', label: '新建' },
    { value: 'fixed', label: '已修复' },
    { value: 'verified', label: '已验证' },
  ];

  if (loading && vulnerabilities.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-red-100 rounded-lg">
                <Bug className="h-6 w-6 text-red-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">漏洞列表</h1>
                <p className="text-sm text-gray-600 mt-1">
                  共 {totalCount} 个漏洞记录
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* 搜索框 */}
            <div className="flex-1">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  <input
                    type="text"
                    placeholder="搜索漏洞标题、类型..."
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

            {/* 状态筛选 */}
            <div className="flex items-center gap-2">
              <Filter size={20} className="text-gray-400" />
              <select
                value={selectedStatus}
                onChange={(e) => {
                  setSelectedStatus(e.target.value);
                  setCurrentPage(1);
                  updateUrlParams({ status: e.target.value || null, page: null });
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {statusOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Skill 筛选 */}
            <div className="flex items-center gap-2">
              <FileCode size={20} className="text-gray-400" />
              <select
                value={selectedSkillId}
                onChange={(e) => {
                  setSelectedSkillId(e.target.value);
                  setCurrentPage(1);
                  updateUrlParams({ skillId: e.target.value || null, page: null });
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">所有 Skill</option>
                {skills.map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.displayName}
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

        {/* Vulnerabilities List */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {vulnerabilities.length === 0 ? (
            <div className="p-12">
              <div className="text-center">
                <Shield className="mx-auto h-16 w-16 text-gray-400" />
                <h3 className="mt-4 text-lg font-medium text-gray-900">暂无漏洞</h3>
                <p className="mt-2 text-sm text-gray-600">
                  {searchTerm || selectedStatus || selectedSkillId
                    ? '没有找到匹配的漏洞'
                    : '系统运行良好，暂未发现安全漏洞'}
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {vulnerabilities.map((vuln) => (
                <div
                  key={vuln.id}
                  className="px-6 py-4 hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => handleRowClick(vuln.id)}
                >
                  <div className="flex items-center gap-4">
                    {/* 状态标签 */}
                    <span className={`px-2 py-1 text-xs font-medium rounded flex-shrink-0 ${statusColors[vuln.status] || 'bg-gray-100 text-gray-800'}`}>
                      {statusLabels[vuln.status] || vuln.status}
                    </span>

                    {/* 严重程度标签 */}
                    <span className={`px-2 py-1 text-xs font-medium rounded flex-shrink-0 ${severityColors[vuln.severity] || 'bg-gray-100 text-gray-600'}`}>
                      {vuln.severity}
                    </span>

                    {/* 标题 */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate">{vuln.title}</h3>
                      <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                        {/* 文件位置 */}
                        {vuln.location && (
                          <span className="flex items-center gap-1 truncate max-w-xs">
                            <FileCode size={14} />
                            <span className="truncate">{vuln.location}</span>
                          </span>
                        )}
                        {/* 漏洞类型 */}
                        <span className="flex-shrink-0">{vuln.type}</span>
                        {/* 发现工具 */}
                        {vuln.skill && (
                          <span className="flex-shrink-0 text-blue-600">{vuln.skill}</span>
                        )}
                      </div>
                    </div>

                    {/* 时间 */}
                    <div className="flex items-center gap-1 text-sm text-gray-400 flex-shrink-0">
                      <Clock size={14} />
                      <span>{new Date(vuln.createdAt).toLocaleString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalCount > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-600">
                  共 {totalCount} 条记录，第 {currentPage} / {totalPages} 页
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
          </div>
        )}
      </div>
    </div>
  );
}