'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Layers,
  RefreshCw,
  Search,
  ChevronRight,
  Clock,
  CheckCircle,
  AlertTriangle,
  Filter,
  Code,
  Shield,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

// Types from API response
interface DuplicateGroupMember {
  id: string;
  skillId: string;
  role: string;
  similarityScore: number;
  joinedAt: string;
  skill: {
    id: string;
    name: string;
    displayName: string;
    category: string;
    techStackId: string | null;
    vulnerabilityPatternId: string | null;
    isActive: boolean;
  };
}

interface DuplicateGroup {
  id: string;
  name: string | null;
  language: string;
  languageName: string;
  languageDisplayName: string;
  vulnerabilityType: string;
  vulnerabilityTypeName: string;
  vulnerabilityTypeDisplayName: string;
  status: string;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  skillCount: number;
  createdAt: string;
  updatedAt: string;
  members: DuplicateGroupMember[];
}

interface ApiResponse {
  groups: DuplicateGroup[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Status colors
const statusColors: Record<string, string> = {
  pending_review: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  resolved: 'bg-green-100 text-green-800 border-green-200',
};

const statusLabels: Record<string, string> = {
  pending_review: '待审核',
  resolved: '已处理',
};

// Resolution labels
const resolutionLabels: Record<string, string> = {
  merged: '已合并',
  keep_all: '保留全部',
  deleted_duplicates: '已删除重复',
};

export default function DuplicateGroupsPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <DuplicateGroupsPageContent />
    </Suspense>
  );
}

function DuplicateGroupsPageContent() {
  const router = useRouter();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetchDuplicateGroups();
  }, [statusFilter, page]);

  const fetchDuplicateGroups = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');

      const params = new URLSearchParams();
      params.append('status', statusFilter);
      params.append('page', page.toString());
      params.append('limit', '20');

      const response = await fetch(`/api/admin/skills-governance/duplicate-groups?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '获取重复组列表失败');
      }

      const result = await response.json();
      setData(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  // Filter groups by search term
  const filteredGroups = data?.groups?.filter(
    (group) =>
      group.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      group.languageName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      group.vulnerabilityTypeDisplayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      group.members.some(m =>
        m.skill.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.skill.displayName.toLowerCase().includes(searchTerm.toLowerCase())
      )
  ) || [];

  const handleRefresh = async () => {
    try {
      await fetchDuplicateGroups();
      toast.success('数据已刷新');
    } catch (err) {
      toast.error('刷新失败');
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Link
          href="/dashboard/admin/skills-governance"
          className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          返回治理总览
        </Link>
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
        <button
          onClick={fetchDuplicateGroups}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <RefreshCw size={20} className="mr-2" />
          重新加载
        </button>
      </div>
    );
  }

  const pendingCount = data?.groups?.filter(g => g.status === 'pending_review').length || 0;
  const resolvedCount = data?.groups?.filter(g => g.status === 'resolved').length || 0;

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Link
        href="/dashboard/admin/skills-governance"
        className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        返回治理总览
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">重复组管理</h1>
          <p className="mt-1 text-sm text-gray-600">
            管理被检测为重复的 Skills 分组，进行合并或删除处理
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={20} className={`mr-2 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">总重复组</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {data?.pagination?.total || 0}
              </p>
            </div>
            <Layers className="text-gray-400" size={20} />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">待审核</p>
              <p className="text-2xl font-bold text-yellow-600 mt-1">
                {pendingCount}
              </p>
            </div>
            <Clock className="text-yellow-400" size={20} />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">已处理</p>
              <p className="text-2xl font-bold text-green-600 mt-1">
                {resolvedCount}
              </p>
            </div>
            <CheckCircle className="text-green-400" size={20} />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="搜索语言、漏洞类型或 Skill 名称..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="text-gray-400" size={18} />
          <label className="text-sm text-gray-600">状态:</label>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">全部</option>
            <option value="pending_review">待审核</option>
            <option value="resolved">已处理</option>
          </select>
        </div>
      </div>

      {/* Groups List */}
      <div className="bg-white rounded-lg shadow border border-gray-200">
        <div className="p-6">
          {filteredGroups.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Layers className="mx-auto h-12 w-12 text-gray-400 mb-2" />
              <p>暂无重复组</p>
              <p className="text-sm mt-1">
                {searchTerm ? '没有找到匹配的重复组' : '运行 LLM 分析以检测重复 Skills'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredGroups.map((group) => (
                <div
                  key={group.id}
                  className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                  onClick={() => router.push(`/dashboard/admin/skills-governance/duplicate-groups/${group.id}`)}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                        <Layers className="w-5 h-5 text-purple-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">
                          {group.name || `${group.languageDisplayName} - ${group.vulnerabilityTypeDisplayName}`}
                        </p>
                        <div className="flex items-center space-x-2 text-sm text-gray-500 mt-1">
                          <span className="inline-flex items-center">
                            <Code size={14} className="mr-1" />
                            {group.languageDisplayName}
                          </span>
                          <span className="text-gray-300">|</span>
                          <span className="inline-flex items-center">
                            <Shield size={14} className="mr-1" />
                            {group.vulnerabilityTypeDisplayName}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <span className="text-sm text-gray-600">
                        {group.skillCount} 个成员
                      </span>
                      <span className={`px-2 py-1 text-xs font-medium rounded border ${
                        statusColors[group.status] || 'bg-gray-100 text-gray-600'
                      }`}>
                        {statusLabels[group.status] || group.status}
                      </span>
                      {group.resolution && (
                        <span className="text-xs text-gray-500">
                          ({resolutionLabels[group.resolution] || group.resolution})
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Members Preview */}
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-xs text-gray-500 mb-2">成员 Skills:</p>
                    <div className="flex flex-wrap gap-2">
                      {group.members.slice(0, 5).map((member) => (
                        <div
                          key={member.id}
                          className={`inline-flex items-center px-3 py-1.5 rounded-lg text-sm ${
                            member.role === 'primary'
                              ? 'bg-blue-100 border border-blue-200 text-blue-800'
                              : 'bg-white border border-gray-200 text-gray-700'
                          }`}
                        >
                          {member.role === 'primary' && (
                            <CheckCircle size={14} className="mr-1 text-blue-600" />
                          )}
                          <span className="font-medium">{member.skill.displayName}</span>
                          <span className="text-gray-400 mx-2">|</span>
                          <span className="text-xs">
                            {(member.similarityScore * 100).toFixed(0)}%
                          </span>
                        </div>
                      ))}
                      {group.members.length > 5 && (
                        <span className="text-xs text-gray-500 px-2 py-1">
                          +{group.members.length - 5} 更多
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Action Link */}
                  <div className="mt-3 flex justify-end">
                    <span className="inline-flex items-center text-sm text-blue-600 hover:text-blue-700">
                      {group.status === 'pending_review' ? '审核处理' : '查看详情'}
                      <ChevronRight size={16} className="ml-1" />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {data?.pagination && data.pagination.totalPages > 1 && (
          <div className="border-t border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">
                显示 {(page - 1) * 20 + 1} - {Math.min(page * 20, data.pagination.total)} 条，共 {data.pagination.total} 条
              </p>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setPage(page - 1)}
                  disabled={page === 1}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  上一页
                </button>
                <span className="text-sm text-gray-600">
                  第 {page} / {data.pagination.totalPages} 页
                </span>
                <button
                  onClick={() => setPage(page + 1)}
                  disabled={page === data.pagination.totalPages}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  下一页
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}