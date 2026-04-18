'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  GitMerge,
  ArrowRightLeft,
  Layers,
  AlertTriangle,
  RefreshCw,
  Search,
  ChevronRight,
  Clock,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { useSkillCategories } from '@/hooks/useSkillCategories';

// Types from API response
interface SimilarSkill {
  skillId: string;
  skillName: string;
  displayName: string;
  category: string;
  techStack: string[];
  similarity: number;
  overlapType: string;
  overlapScore: number;
  keywordScore: number;
  reason: string;
}

interface MergeCandidate {
  skillId: string;
  skillName: string;
  skillDisplayName: string;
  skillCategory: string;
  similarSkills: SimilarSkill[];
  overlapScore: number;
  recommendation: string;
}

interface PendingMergeRecord {
  id: string;
  sourceSkillId: string;
  sourceSkillName: string;
  sourceSkillDisplayName: string;
  targetSkillId: string;
  targetSkillName: string;
  targetSkillDisplayName: string;
  mergeReason: string;
  mergeDetails: any;
  status: string;
  sourceOwnerConsent: boolean;
  targetOwnerConsent: boolean;
  createdAt: string;
}

interface MergeCandidatesSummary {
  totalCandidates: number;
  mergeRecommendations: number;
  techStackSplitRecommendations: number;
  manualReviewRecommendations: number;
  pendingMergeRecords: number;
}

interface ApiResponse {
  candidates: MergeCandidate[];
  pendingMergeRecords: PendingMergeRecord[];
  summary: MergeCandidatesSummary;
}

// Recommendation config
const recommendationConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  merge: {
    label: '建议合并',
    icon: <GitMerge size={14} />,
    color: 'bg-purple-100 text-purple-800 border-purple-200',
  },
  'techStack-split': {
    label: '技术栈拆分',
    icon: <ArrowRightLeft size={14} />,
    color: 'bg-green-100 text-green-800 border-green-200',
  },
  'manual-review': {
    label: '需人工审核',
    icon: <AlertTriangle size={14} />,
    color: 'bg-orange-100 text-orange-800 border-orange-200',
  },
};

// Status colors for merge records
const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  approved: 'bg-green-100 text-green-800 border-green-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
  completed: 'bg-blue-100 text-blue-800 border-blue-200',
};

const statusLabels: Record<string, string> = {
  pending: '待处理',
  approved: '已批准',
  rejected: '已拒绝',
  completed: '已完成',
};

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
    </div>
  );
}

export default function MergeCandidatesPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <MergeCandidatesPageContent />
    </Suspense>
  );
}

function MergeCandidatesPageContent() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [minOverlapScore, setMinOverlapScore] = useState('0.75');
  const [activeTab, setActiveTab] = useState<'candidates' | 'pending'>('candidates');

  // 分类标签 - 从数据库动态获取
  const { categoryLabels } = useSkillCategories();

  useEffect(() => {
    fetchMergeCandidates();
  }, [minOverlapScore]);

  const fetchMergeCandidates = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      const params = new URLSearchParams();
      params.append('minOverlapScore', minOverlapScore);
      
      const response = await fetch(`/api/admin/skills-governance/merge-candidates?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '获取合并候选失败');
      }

      const result = await response.json();
      setData(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  // Filter candidates by search term
  const filteredCandidates = data?.candidates?.filter(
    (candidate) =>
      candidate.skillName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      candidate.skillDisplayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      candidate.skillCategory.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  // Get overlap score color
  const getOverlapScoreColor = (score: number) => {
    if (score >= 0.9) return 'text-red-600 font-bold';
    if (score >= 0.85) return 'text-orange-600 font-semibold';
    if (score >= 0.75) return 'text-yellow-600';
    return 'text-green-600';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
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
          onClick={fetchMergeCandidates}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <RefreshCw size={20} className="mr-2" />
          重新加载
        </button>
      </div>
    );
  }

  const summary = data?.summary;

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
          <h1 className="text-2xl font-bold text-gray-900">合并候选列表</h1>
          <p className="mt-1 text-sm text-gray-600">
            显示高重叠度的 Skills 对，提供合并或拆分建议
          </p>
        </div>
        <button
          onClick={fetchMergeCandidates}
          disabled={loading}
          className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={20} className={`mr-2 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">总候选数</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {summary?.totalCandidates || 0}
              </p>
            </div>
            <Layers className="text-gray-400" size={20} />
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">建议合并</p>
              <p className="text-2xl font-bold text-purple-600 mt-1">
                {summary?.mergeRecommendations || 0}
              </p>
            </div>
            <GitMerge className="text-purple-400" size={20} />
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">技术栈拆分</p>
              <p className="text-2xl font-bold text-green-600 mt-1">
                {summary?.techStackSplitRecommendations || 0}
              </p>
            </div>
            <ArrowRightLeft className="text-green-400" size={20} />
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">需人工审核</p>
              <p className="text-2xl font-bold text-orange-600 mt-1">
                {summary?.manualReviewRecommendations || 0}
              </p>
            </div>
            <AlertTriangle className="text-orange-400" size={20} />
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">待处理合并</p>
              <p className="text-2xl font-bold text-blue-600 mt-1">
                {summary?.pendingMergeRecords || 0}
              </p>
            </div>
            <Clock className="text-blue-400" size={20} />
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
              placeholder="搜索 Skill 名称或分类..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">最小重叠度:</label>
          <select
            value={minOverlapScore}
            onChange={(e) => setMinOverlapScore(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="0.9">90%+</option>
            <option value="0.85">85%+</option>
            <option value="0.75">75%+</option>
            <option value="0.6">60%+</option>
          </select>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white rounded-lg shadow border border-gray-200">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8 px-6" aria-label="Tabs">
            <button
              onClick={() => setActiveTab('candidates')}
              className={`flex items-center py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'candidates'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Layers size={18} className="mr-2" />
              合并候选
            </button>
            <button
              onClick={() => setActiveTab('pending')}
              className={`flex items-center py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'pending'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Clock size={18} className="mr-2" />
              待处理合并记录
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {/* Candidates Tab */}
          {activeTab === 'candidates' && (
            <div className="space-y-4">
              {filteredCandidates.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Layers className="mx-auto h-12 w-12 text-gray-400 mb-2" />
                  <p>暂无合并候选</p>
                  <p className="text-sm mt-1">
                    {searchTerm ? '没有找到匹配的候选' : '调整最小重叠度阈值以查看更多候选'}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredCandidates.map((candidate) => (
                    <div
                      key={candidate.skillId}
                      className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                            <Layers className="w-5 h-5 text-blue-600" />
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{candidate.skillDisplayName}</p>
                            <p className="text-sm text-gray-500">{candidate.skillName}</p>
                            <p className="text-xs text-gray-400">
                              {categoryLabels[candidate.skillCategory] || candidate.skillCategory}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-3">
                          <span className={`text-sm ${getOverlapScoreColor(candidate.overlapScore)}`}>
                            {(candidate.overlapScore * 100).toFixed(0)}%
                          </span>
                          <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border ${
                            recommendationConfig[candidate.recommendation]?.color || 'bg-gray-100 text-gray-600'
                          }`}>
                            {recommendationConfig[candidate.recommendation]?.icon}
                            {recommendationConfig[candidate.recommendation]?.label || candidate.recommendation}
                          </span>
                        </div>
                      </div>
                      
                      {/* Similar Skills */}
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <p className="text-xs text-gray-500 mb-2">相似 Skills:</p>
                        <div className="flex flex-wrap gap-2">
                          {candidate.similarSkills.map((similar) => (
                            <div
                              key={similar.skillId}
                              className="inline-flex items-center px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm"
                            >
                              <span className="font-medium text-gray-900">{similar.skillName}</span>
                              <span className="text-gray-400 mx-2">|</span>
                              <span className={`text-xs ${getOverlapScoreColor(similar.overlapScore)}`}>
                                {(similar.overlapScore * 100).toFixed(0)}%
                              </span>
                              <span className="text-xs text-gray-500 ml-2">
                                ({similar.overlapType})
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      
                      {/* Action Link */}
                      <div className="mt-3 flex justify-end">
                        <Link
                          href="/dashboard/admin/skills-governance/merge"
                          className="inline-flex items-center text-sm text-blue-600 hover:text-blue-700"
                        >
                          前往合并操作
                          <ChevronRight size={16} className="ml-1" />
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Pending Merge Records Tab */}
          {activeTab === 'pending' && (
            <div className="space-y-4">
              {data?.pendingMergeRecords?.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <CheckCircle className="mx-auto h-12 w-12 text-gray-400 mb-2" />
                  <p>暂无待处理的合并记录</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {data?.pendingMergeRecords?.map((record) => (
                    <div
                      key={record.id}
                      className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-3">
                          <GitMerge className="text-purple-500" size={20} />
                          <div>
                            <p className="font-medium text-gray-900">
                              {record.sourceSkillDisplayName} → {record.targetSkillDisplayName}
                            </p>
                            <p className="text-sm text-gray-500">
                              {record.sourceSkillName} → {record.targetSkillName}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className={`px-2 py-1 text-xs font-medium rounded border ${
                            statusColors[record.status] || 'bg-gray-100 text-gray-600'
                          }`}>
                            {statusLabels[record.status] || record.status}
                          </span>
                          <span className="text-xs text-gray-500">
                            {new Date(record.createdAt).toLocaleDateString('zh-CN')}
                          </span>
                        </div>
                      </div>
                      
                      {/* Consent Status */}
                      <div className="flex items-center space-x-4 text-xs text-gray-600">
                        <span className="flex items-center">
                          {record.sourceOwnerConsent ? (
                            <CheckCircle className="text-green-500 mr-1" size={14} />
                          ) : (
                            <XCircle className="text-gray-400 mr-1" size={14} />
                          )}
                          源所有者同意
                        </span>
                        <span className="flex items-center">
                          {record.targetOwnerConsent ? (
                            <CheckCircle className="text-green-500 mr-1" size={14} />
                          ) : (
                            <XCircle className="text-gray-400 mr-1" size={14} />
                          )}
                          目标所有者同意
                        </span>
                        <span className="text-gray-500">
                          原因: {record.mergeReason}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}