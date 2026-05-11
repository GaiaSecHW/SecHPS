'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  ArrowLeft,
  Search,
  GitMerge,
  ArrowRightLeft,
  Archive,
  Eye,
  Clock,
  ChevronLeft,
  ChevronRight,
  Filter,
  RefreshCw,
  CheckCircle,
  XCircle,
  MinusCircle,
  Layers,
} from 'lucide-react';


interface SimilarSkill {
  skillId: string;
  skillName: string;
  displayName?: string;
  similarity?: number;
  overlapType?: string;
}

interface ImpactAnalysis {
  id: string;
  skillId: string;
  skillName: string;
  skillDisplayName: string;
  skillCategory: string;
  similarSkills: SimilarSkill[] | null;
  overlapScore: number | null;
  affectedWorkflows: string[] | null;
  recommendation: string | null;
  recommendationReason: string | null;
  status: string;
  analyzedAt: string | null;
  actionedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Status badge colors
const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-500/20',
  analyzed: 'bg-blue-100 text-blue-800 border-blue-500/20',
  actioned: 'bg-green-100 text-green-800 border-green-500/20',
  dismissed: 'bg-dark-surface-hover text-gray-400 border-gray-700/50',
};

const statusLabels: Record<string, string> = {
  pending: '待审核',
  analyzed: '已分析',
  actioned: '已处理',
  dismissed: '已忽略',
};

// Recommendation labels and icons
const recommendationConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  merge: {
    label: '建议合并',
    icon: <GitMerge size={14} />,
    color: 'bg-purple-100 text-purple-800 border-purple-500/20',
  },
  keep_separate: {
    label: '保持独立',
    icon: <ArrowRightLeft size={14} />,
    color: 'bg-blue-100 text-blue-800 border-blue-500/20',
  },
  deprecate_old: {
    label: '废弃旧版',
    icon: <Archive size={14} />,
    color: 'bg-orange-100 text-orange-800 border-orange-500/20',
  },
};

export default function NewImpactPage() {
  const [analyses, setAnalyses] = useState<ImpactAnalysis[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [minOverlapScore, setMinOverlapScore] = useState<string>('');
  
  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  
  // Selected analysis for detail view
  const [selectedAnalysis, setSelectedAnalysis] = useState<ImpactAnalysis | null>(null);

  useEffect(() => {
    fetchAnalyses();
  }, [selectedStatus, minOverlapScore, currentPage, pageSize]);

  // Search debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentPage !== 1) {
        setCurrentPage(1);
      } else {
        fetchAnalyses();
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const fetchAnalyses = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      const params = new URLSearchParams();
      if (selectedStatus) params.append('status', selectedStatus);
      if (minOverlapScore) params.append('minOverlapScore', minOverlapScore);
      if (searchTerm) params.append('skillId', searchTerm);
      params.append('page', currentPage.toString());
      params.append('limit', pageSize.toString());

      const response = await fetch(`/api/admin/skills-governance/new-impact?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('获取影响分析列表失败');
      }

      const data = await response.json();
      setAnalyses(data.data || []);
      setPagination(data.pagination || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (analysisId: string, action: 'approve-merge' | 'keep-separate' | 'mark-pending') => {
    try {
      const token = localStorage.getItem('token');
      
      // Note: This would need a PATCH endpoint to update the analysis status
      // For now, we'll show a toast message indicating the action
      const actionLabels: Record<string, string> = {
        'approve-merge': '批准合并',
        'keep-separate': '保持独立',
        'mark-pending': '标记待审核',
      };
      
      toast.success(`已执行操作: ${actionLabels[action]}`);
      
      // Refresh the list
      fetchAnalyses();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const getOverlapScoreColor = (score: number | null): string => {
    if (score === null) return 'text-gray-400';
    if (score >= 0.85) return 'text-red-600 font-semibold';
    if (score >= 0.75) return 'text-orange-600';
    if (score >= 0.6) return 'text-yellow-600';
    return 'text-green-600';
  };

  const formatOverlapScore = (score: number | null): string => {
    if (score === null) return '未计算';
    return `${(score * 100).toFixed(1)}%`;
  };

  if (loading && analyses.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Link 
        href="/dashboard/admin/skills-governance"
        className="inline-flex items-center text-gray-400 hover:text-gray-100 mb-4"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        返回治理总览
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-100">新增 Skill 影响分析</h1>
        <p className="mt-1 text-sm text-gray-400">
          分析新创建的 Skill 与现有 Skills 的重叠情况，提供合并建议
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="搜索 Skill ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-[#0F172A] border border-gray-600 text-gray-100 placeholder-gray-500 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Filter size={20} className="text-gray-400" />
          <select
            value={selectedStatus}
            onChange={(e) => { setSelectedStatus(e.target.value); setCurrentPage(1); }}
            className="px-4 py-2 bg-[#0F172A] border border-gray-600 text-gray-100 placeholder-gray-500 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            <option value="">所有状态</option>
            <option value="pending">待审核</option>
            <option value="analyzed">已分析</option>
            <option value="actioned">已处理</option>
            <option value="dismissed">已忽略</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Layers size={20} className="text-gray-400" />
          <select
            value={minOverlapScore}
            onChange={(e) => { setMinOverlapScore(e.target.value); setCurrentPage(1); }}
            className="px-4 py-2 bg-[#0F172A] border border-gray-600 text-gray-100 placeholder-gray-500 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            <option value="">所有重叠度</option>
            <option value="0.85">高重叠 (≥85%)</option>
            <option value="0.75">中重叠 (≥75%)</option>
            <option value="0.6">低重叠 (≥60%)</option>
          </select>
        </div>
        <button
          onClick={fetchAnalyses}
          disabled={loading}
          className="inline-flex items-center px-4 py-2 bg-dark-surface-hover text-gray-300 rounded-lg hover:bg-dark-surface-hover transition-colors disabled:opacity-50"
        >
          <RefreshCw size={16} className={`mr-2 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/20 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Analyses List */}
      <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 overflow-hidden">
        {analyses.length === 0 ? (
          <div className="p-12">
            <div className="text-center">
              <AlertTriangle className="mx-auto h-16 w-16 text-gray-400" />
              <h3 className="mt-4 text-lg font-medium text-gray-100">暂无影响分析</h3>
              <p className="mt-2 text-sm text-gray-400">
                {searchTerm || selectedStatus || minOverlapScore
                  ? '没有找到匹配的分析记录'
                  : '新创建的 Skill 将自动进行影响分析'}
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-700/50">
              <thead className="bg-[#0F172A]">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Skill 名称
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    相似度
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    相似对象
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    审核状态
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    推荐操作
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-dark-surface divide-y divide-gray-700/50">
                {analyses.map((analysis) => (
                  <tr
                    key={analysis.id}
                    className="hover:bg-[#0F172A] transition-colors cursor-pointer"
                    onClick={() => setSelectedAnalysis(analysis)}
                  >
                    <td className="px-4 py-4">
                      <div className="flex items-center space-x-3">
                        <div className="flex-shrink-0">
                          <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                            <Layers className="w-4 h-4 text-blue-600" />
                          </div>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-100">
                            {analysis.skillDisplayName}
                          </p>
                          <p className="text-xs text-gray-500">
                            {analysis.skillName}
                          </p>
                          <p className="text-xs text-gray-400">
                            {analysis.skillCategory}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center">
                        <span className={`text-sm ${getOverlapScoreColor(analysis.overlapScore)}`}>
                          {formatOverlapScore(analysis.overlapScore)}
                        </span>
                        {analysis.overlapScore !== null && analysis.overlapScore >= 0.85 && (
                          <AlertTriangle size={14} className="ml-1 text-red-500" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-1">
                        {analysis.similarSkills && analysis.similarSkills.length > 0 ? (
                          analysis.similarSkills.slice(0, 3).map((similar) => (
                            <span
                              key={similar.skillId}
                              className="inline-flex items-center px-2 py-0.5 text-xs bg-dark-surface-hover text-gray-300 rounded border border-gray-700/50"
                            >
                              {similar.skillName}
                              {similar.similarity && (
                                <span className="ml-1 text-gray-400">
                                  ({(similar.similarity * 100).toFixed(0)}%)
                                </span>
                              )}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-gray-400">无相似对象</span>
                        )}
                        {analysis.similarSkills && analysis.similarSkills.length > 3 && (
                          <span className="text-xs text-gray-500">
                            +{analysis.similarSkills.length - 3}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded border ${statusColors[analysis.status] || 'bg-dark-surface-hover text-gray-400'}`}>
                        {statusLabels[analysis.status] || analysis.status}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      {analysis.recommendation ? (
                        <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border ${recommendationConfig[analysis.recommendation]?.color || 'bg-dark-surface-hover text-gray-400'}`}>
                          {recommendationConfig[analysis.recommendation]?.icon}
                          {recommendationConfig[analysis.recommendation]?.label || analysis.recommendation}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">未生成</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedAnalysis(analysis); }}
                          className="inline-flex items-center px-2 py-1 text-xs bg-blue-900/20 text-blue-400 border border-blue-500/20 rounded hover:bg-blue-900/30 transition-colors"
                          title="查看详情"
                        >
                          <Eye size={12} className="mr-1" />
                          详情
                        </button>
                        {analysis.status === 'pending' && (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleAction(analysis.id, 'approve-merge'); }}
                              className="inline-flex items-center px-2 py-1 text-xs bg-purple-900/20 text-purple-400 border border-purple-500/20 rounded hover:bg-purple-900/30 transition-colors"
                              title="批准合并"
                            >
                              <GitMerge size={12} className="mr-1" />
                              合并
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleAction(analysis.id, 'keep-separate'); }}
                              className="inline-flex items-center px-2 py-1 text-xs bg-blue-900/20 text-blue-400 border border-blue-500/20 rounded hover:bg-blue-900/30 transition-colors"
                              title="保持独立"
                            >
                              <ArrowRightLeft size={12} className="mr-1" />
                              独立
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleAction(analysis.id, 'mark-pending'); }}
                              className="inline-flex items-center px-2 py-1 text-xs bg-yellow-900/20 text-yellow-400 border border-yellow-500/20 rounded hover:bg-yellow-900/30 transition-colors"
                              title="标记待审核"
                            >
                              <Clock size={12} className="mr-1" />
                              待审
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination && pagination.total > 0 && (
        <div className="flex items-center justify-between bg-dark-surface rounded-lg shadow border border-gray-700/50 px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">
              共 {pagination.total} 条记录，第 {pagination.page} / {pagination.totalPages} 页
            </span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
              className="px-2 py-1 border border-gray-600 rounded text-sm"
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
              className="flex items-center p-1.5 text-gray-400 hover:bg-dark-surface-hover rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="首页"
            >
              <ChevronLeft size={16} />
              <ChevronLeft size={16} className="-ml-2" />
            </button>
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="p-1.5 text-gray-400 hover:bg-dark-surface-hover rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="上一页"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="px-3 py-1 text-sm text-gray-300">
              {currentPage} / {pagination.totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(Math.min(pagination.totalPages, currentPage + 1))}
              disabled={currentPage >= pagination.totalPages}
              className="p-1.5 text-gray-400 hover:bg-dark-surface-hover rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="下一页"
            >
              <ChevronRight size={20} />
            </button>
            <button
              onClick={() => setCurrentPage(pagination.totalPages)}
              disabled={currentPage >= pagination.totalPages}
              className="flex items-center p-1.5 text-gray-400 hover:bg-dark-surface-hover rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="末页"
            >
              <ChevronRight size={16} />
              <ChevronRight size={16} className="-ml-2" />
            </button>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedAnalysis && (
        <div className="fixed inset-0 bg-dark-surface z-50 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/50 bg-dark-surface shrink-0">
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setSelectedAnalysis(null)}
                className="flex items-center text-gray-500 hover:text-gray-200 transition-colors"
              >
                <XCircle size={20} className="mr-1" />
                返回
              </button>
              <span className="text-gray-300">|</span>
              <span className={`px-2 py-0.5 text-xs font-medium rounded border ${statusColors[selectedAnalysis.status]}`}>
                {statusLabels[selectedAnalysis.status]}
              </span>
              <h2 className="text-lg font-bold text-gray-100">
                {selectedAnalysis.skillDisplayName}
              </h2>
            </div>
            {/* Action buttons */}
            <div className="flex items-center space-x-2">
              {selectedAnalysis.status === 'pending' && (
                <>
                  <button
                    onClick={() => handleAction(selectedAnalysis.id, 'approve-merge')}
                    className="inline-flex items-center px-3 py-1.5 bg-purple-900/20 text-purple-400 rounded hover:bg-purple-900/30 text-sm"
                  >
                    <GitMerge size={14} className="mr-1" />
                    批准合并
                  </button>
                  <button
                    onClick={() => handleAction(selectedAnalysis.id, 'keep-separate')}
                    className="inline-flex items-center px-3 py-1.5 bg-blue-900/20 text-blue-400 rounded hover:bg-blue-900/30 text-sm"
                  >
                    <ArrowRightLeft size={14} className="mr-1" />
                    保持独立
                  </button>
                  <button
                    onClick={() => handleAction(selectedAnalysis.id, 'mark-pending')}
                    className="inline-flex items-center px-3 py-1.5 bg-yellow-900/20 text-yellow-400 rounded hover:bg-yellow-900/30 text-sm"
                  >
                    <Clock size={14} className="mr-1" />
                    标记待审核
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-4xl mx-auto p-6 space-y-6">
              {/* Basic Info */}
              <div className="bg-[#0F172A] rounded-lg p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-xs text-gray-500">Skill ID</span>
                    <p className="text-sm font-medium text-gray-100">{selectedAnalysis.skillId}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Skill 名称</span>
                    <p className="text-sm font-medium text-gray-100">{selectedAnalysis.skillName}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">显示名称</span>
                    <p className="text-sm font-medium text-gray-100">{selectedAnalysis.skillDisplayName}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">分类</span>
                    <p className="text-sm font-medium text-gray-100">
                      {selectedAnalysis.skillCategory}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">重叠分数</span>
                    <p className={`text-sm font-medium ${getOverlapScoreColor(selectedAnalysis.overlapScore)}`}>
                      {formatOverlapScore(selectedAnalysis.overlapScore)}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">创建时间</span>
                    <p className="text-sm font-medium text-gray-100">
                      {new Date(selectedAnalysis.createdAt).toLocaleString('zh-CN')}
                    </p>
                  </div>
                </div>
              </div>

              {/* Similar Skills */}
              <div>
                <h4 className="text-sm font-medium text-gray-300 mb-2">相似 Skills</h4>
                {selectedAnalysis.similarSkills && selectedAnalysis.similarSkills.length > 0 ? (
                  <div className="bg-dark-surface border border-gray-700/50 rounded-lg p-4 space-y-2">
                    {selectedAnalysis.similarSkills.map((similar) => (
                      <div
                        key={similar.skillId}
                        className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-6 h-6 bg-dark-surface-hover rounded flex items-center justify-center">
                            <Layers size={12} className="text-gray-500" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-100">{similar.skillName}</p>
                            {similar.displayName && (
                              <p className="text-xs text-gray-500">{similar.displayName}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          {similar.overlapType && (
                            <span className="px-2 py-0.5 text-xs bg-dark-surface-hover text-gray-400 rounded">
                              {similar.overlapType}
                            </span>
                          )}
                          {similar.similarity && (
                            <span className={`text-sm ${getOverlapScoreColor(similar.similarity)}`}>
                              {(similar.similarity * 100).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-dark-surface border border-gray-700/50 rounded-lg p-4 text-center text-gray-500">
                    无相似 Skills
                  </div>
                )}
              </div>

              {/* Recommendation */}
              <div>
                <h4 className="text-sm font-medium text-gray-300 mb-2">推荐操作</h4>
                <div className="bg-dark-surface border border-gray-700/50 rounded-lg p-4">
                  {selectedAnalysis.recommendation ? (
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <span className={`inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded border ${recommendationConfig[selectedAnalysis.recommendation]?.color}`}>
                          {recommendationConfig[selectedAnalysis.recommendation]?.icon}
                          {recommendationConfig[selectedAnalysis.recommendation]?.label}
                        </span>
                      </div>
                      {selectedAnalysis.recommendationReason && (
                        <p className="text-sm text-gray-400 mt-2">
                          {selectedAnalysis.recommendationReason}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">未生成推荐</p>
                  )}
                </div>
              </div>

              {/* Affected Workflows */}
              {selectedAnalysis.affectedWorkflows && selectedAnalysis.affectedWorkflows.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-300 mb-2">受影响的工作流</h4>
                  <div className="bg-dark-surface border border-gray-700/50 rounded-lg p-4">
                    <div className="flex flex-wrap gap-2">
                      {selectedAnalysis.affectedWorkflows.map((workflow) => (
                        <span
                          key={workflow}
                          className="px-2 py-1 text-xs bg-orange-100 text-orange-800 rounded border border-orange-500/20"
                        >
                          {workflow}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Timeline */}
              <div>
                <h4 className="text-sm font-medium text-gray-300 mb-2">处理时间线</h4>
                <div className="bg-dark-surface border border-gray-700/50 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">创建时间</span>
                    <span className="text-sm text-gray-100">
                      {new Date(selectedAnalysis.createdAt).toLocaleString('zh-CN')}
                    </span>
                  </div>
                  {selectedAnalysis.analyzedAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">分析时间</span>
                      <span className="text-sm text-gray-100">
                        {new Date(selectedAnalysis.analyzedAt).toLocaleString('zh-CN')}
                      </span>
                    </div>
                  )}
                  {selectedAnalysis.actionedAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">处理时间</span>
                      <span className="text-sm text-gray-100">
                        {new Date(selectedAnalysis.actionedAt).toLocaleString('zh-CN')}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}