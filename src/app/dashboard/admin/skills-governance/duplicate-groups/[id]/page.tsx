'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Layers,
  RefreshCw,
  GitMerge,
  CheckCircle,
  Trash2,
  AlertTriangle,
  Code,
  Shield,
  Clock,
  FileText,
  Brain,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

// Types from API response
interface SkillInfo {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  techStackId: string | null;
  vulnerabilityPatternId: string | null;
  content: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  execCount: number;
  successRate: number | null;
}

interface GroupMember {
  id: string;
  skillId: string;
  role: string;
  similarityScore: number;
  joinedAt: string;
  skill: SkillInfo;
}

interface AnalysisResult {
  id: string;
  skillId: string;
  relatedSkillId: string;
  isDuplicate: boolean;
  overlapType: string | null;
  confidence: number;
  llmReason: string | null;
  keyDifferences: string[];
  recommendation: string | null;
  reviewStatus: string;
  analyzedAt: string;
}

interface DuplicateGroupDetail {
  id: string;
  name: string | null;
  language: string;
  vulnerabilityType: string;
  status: string;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  skillCount: number;
  createdAt: string;
  updatedAt: string;
  members: GroupMember[];
  languageInfo: {
    id: string;
    name: string;
    displayName: string;
    category: string;
  } | null;
  vulnerabilityTypeInfo: {
    id: string;
    name: string;
    displayName: string;
    category: string;
    cwe: string | null;
  } | null;
  analyses: AnalysisResult[];
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

// Overlap type labels
const overlapTypeLabels: Record<string, string> = {
  exact: '完全匹配',
  subset: '子集',
  related: '相关',
  distinct: '独立',
};

// Recommendation labels
const recommendationLabels: Record<string, string> = {
  merge: '建议合并',
  keep_separate: '建议保留',
  review: '需人工审核',
};

export default function DuplicateGroupDetailPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <DuplicateGroupDetailPageContent />
    </Suspense>
  );
}

function DuplicateGroupDetailPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const groupId = searchParams.get('id');

  const [group, setGroup] = useState<DuplicateGroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPrimary, setSelectedPrimary] = useState<string | null>(null);
  const [selectedToDelete, setSelectedToDelete] = useState<string[]>([]);
  const [actionNotes, setActionNotes] = useState('');
  const [processing, setProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<'members' | 'analyses'>('members');

  useEffect(() => {
    if (groupId) {
      fetchGroupDetail();
    }
  }, [groupId]);

  const fetchGroupDetail = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');

      const response = await fetch(`/api/admin/skills-governance/duplicate-groups/${groupId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '获取重复组详情失败');
      }

      const result = await response.json();
      setGroup(result.data);

      // 默认选择第一个成员作为 primary
      if (result.data.members.length > 0 && result.data.status === 'pending_review') {
        const primaryMember = result.data.members.find((m: GroupMember) => m.role === 'primary');
        setSelectedPrimary(primaryMember?.skillId || result.data.members[0].skillId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (action: 'merge' | 'keep_all' | 'delete_duplicates') => {
    if (!group) return;

    // 验证
    if (action === 'merge' && !selectedPrimary) {
      toast.error('请选择要保留的主 Skill');
      return;
    }

    if (action === 'delete_duplicates' && selectedToDelete.length === 0) {
      toast.error('请选择要删除的 Skill');
      return;
    }

    // 确认
    const actionLabels = {
      merge: '合并',
      keep_all: '保留全部',
      delete_duplicates: '删除重复',
    };

    if (!confirm(`确定要执行 "${actionLabels[action]}" 操作吗？\n\n此操作不可撤销。`)) {
      return;
    }

    try {
      setProcessing(true);
      const token = localStorage.getItem('token');

      const body: Record<string, unknown> = {
        action,
        notes: actionNotes,
      };

      if (action === 'merge') {
        body.primarySkillId = selectedPrimary;
      }

      if (action === 'delete_duplicates') {
        body.deleteSkillIds = selectedToDelete;
      }

      const response = await fetch(`/api/admin/skills-governance/duplicate-groups/${group.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '操作失败');
      }

      const result = await response.json();
      toast.success(result.data.message || '操作成功');

      // 刷新数据
      await fetchGroupDetail();

    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setProcessing(false);
    }
  };

  const toggleSkillToDelete = (skillId: string) => {
    if (selectedToDelete.includes(skillId)) {
      setSelectedToDelete(selectedToDelete.filter(id => id !== skillId));
    } else {
      setSelectedToDelete([...selectedToDelete, skillId]);
    }
  };

  if (!groupId) {
    return (
      <div className="space-y-6">
        <Link
          href="/dashboard/admin/skills-governance/duplicate-groups"
          className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          返回重复组列表
        </Link>
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          缺少重复组 ID
        </div>
      </div>
    );
  }

  if (loading) {
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
          href="/dashboard/admin/skills-governance/duplicate-groups"
          className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          返回重复组列表
        </Link>
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
        <button
          onClick={fetchGroupDetail}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <RefreshCw size={20} className="mr-2" />
          重新加载
        </button>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="space-y-6">
        <Link
          href="/dashboard/admin/skills-governance/duplicate-groups"
          className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          返回重复组列表
        </Link>
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded-lg">
          重复组不存在
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Link
        href="/dashboard/admin/skills-governance/duplicate-groups"
        className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        返回重复组列表
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {group.name || `${group.languageInfo?.displayName || group.language} - ${group.vulnerabilityTypeInfo?.displayName || group.vulnerabilityType}`}
          </h1>
          <div className="flex items-center space-x-2 text-sm text-gray-600 mt-1">
            <span className="inline-flex items-center">
              <Code size={14} className="mr-1" />
              {group.languageInfo?.displayName || group.language}
            </span>
            <span className="text-gray-300">|</span>
            <span className="inline-flex items-center">
              <Shield size={14} className="mr-1" />
              {group.vulnerabilityTypeInfo?.displayName || group.vulnerabilityType}
            </span>
            {group.vulnerabilityTypeInfo?.cwe && (
              <span className="text-xs text-gray-500">
                (CWE-{group.vulnerabilityTypeInfo.cwe})
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <span className={`px-3 py-1.5 text-sm font-medium rounded border ${
            statusColors[group.status] || 'bg-gray-100 text-gray-600'
          }`}>
            {statusLabels[group.status] || group.status}
          </span>
          <button
            onClick={fetchGroupDetail}
            disabled={loading}
            className="inline-flex items-center px-3 py-1.5 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={16} className={`mr-1 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">成员数量</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {group.skillCount}
              </p>
            </div>
            <Layers className="text-gray-400" size={20} />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">分析记录</p>
              <p className="text-2xl font-bold text-purple-600 mt-1">
                {group.analyses.length}
              </p>
            </div>
            <Brain className="text-purple-400" size={20} />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">创建时间</p>
              <p className="text-sm font-medium text-gray-900 mt-1">
                {new Date(group.createdAt).toLocaleDateString('zh-CN')}
              </p>
            </div>
            <Clock className="text-gray-400" size={20} />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">处理状态</p>
              <p className="text-sm font-medium text-gray-900 mt-1">
                {group.resolution ? (group.resolution === 'merged' ? '已合并' : group.resolution === 'keep_all' ? '保留全部' : '已删除重复') : '待处理'}
              </p>
            </div>
            {group.resolution ? (
              <CheckCircle className="text-green-400" size={20} />
            ) : (
              <AlertTriangle className="text-yellow-400" size={20} />
            )}
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white rounded-lg shadow border border-gray-200">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8 px-6" aria-label="Tabs">
            <button
              onClick={() => setActiveTab('members')}
              className={`flex items-center py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'members'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Layers size={18} className="mr-2" />
              成员 Skills
            </button>
            <button
              onClick={() => setActiveTab('analyses')}
              className={`flex items-center py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'analyses'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Brain size={18} className="mr-2" />
              LLM 分析结果
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {/* Members Tab */}
          {activeTab === 'members' && (
            <div className="space-y-4">
              {group.members.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Layers className="mx-auto h-12 w-12 text-gray-400 mb-2" />
                  <p>暂无成员</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {group.members.map((member) => (
                    <div
                      key={member.id}
                      className={`p-4 rounded-lg border transition-colors ${
                        selectedPrimary === member.skillId
                          ? 'bg-blue-50 border-blue-200'
                          : selectedToDelete.includes(member.skillId)
                            ? 'bg-red-50 border-red-200'
                            : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            member.role === 'primary'
                              ? 'bg-blue-100'
                              : 'bg-gray-100'
                          }`}>
                            {member.role === 'primary' ? (
                              <CheckCircle className="w-5 h-5 text-blue-600" />
                            ) : (
                              <FileText className="w-5 h-5 text-gray-600" />
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{member.skill.displayName}</p>
                            <p className="text-sm text-gray-500">{member.skill.name}</p>
                            <div className="flex items-center space-x-2 text-xs text-gray-400 mt-1">
                              <span>执行次数: {member.skill.execCount}</span>
                              <span>|</span>
                              <span>
                                成功率: {member.skill.successRate ? (member.skill.successRate * 100).toFixed(1) : '-'}%
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center space-x-3">
                          <span className="text-sm text-gray-600">
                            相似度: {(member.similarityScore * 100).toFixed(0)}%
                          </span>
                          {group.status === 'pending_review' && (
                            <div className="flex items-center space-x-2">
                              <button
                                onClick={() => setSelectedPrimary(member.skillId)}
                                className={`px-2 py-1 text-xs rounded ${
                                  selectedPrimary === member.skillId
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                }`}
                              >
                                设为主 Skill
                              </button>
                              <button
                                onClick={() => toggleSkillToDelete(member.skillId)}
                                className={`px-2 py-1 text-xs rounded ${
                                  selectedToDelete.includes(member.skillId)
                                    ? 'bg-red-600 text-white'
                                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                }`}
                              >
                                标记删除
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Skill Description */}
                      {member.skill.description && (
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <p className="text-sm text-gray-600 line-clamp-2">
                            {member.skill.description}
                          </p>
                        </div>
                      )}

                      {/* Link to Skill */}
                      <div className="mt-3 flex justify-end">
                        <Link
                          href={`/dashboard/skills/${member.skillId}`}
                          className="inline-flex items-center text-sm text-blue-600 hover:text-blue-700"
                        >
                          查看 Skill 详情
                          <ChevronRight size={16} className="ml-1" />
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Analyses Tab */}
          {activeTab === 'analyses' && (
            <div className="space-y-4">
              {group.analyses.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Brain className="mx-auto h-12 w-12 text-gray-400 mb-2" />
                  <p>暂无 LLM 分析结果</p>
                  <p className="text-sm mt-1">运行全量分析以获取详细分析</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {group.analyses.map((analysis) => (
                    <div
                      key={analysis.id}
                      className="p-4 bg-gray-50 rounded-lg border border-gray-200"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-2">
                          <span className="text-sm font-medium text-gray-900">
                            {group.members.find(m => m.skillId === analysis.skillId)?.skill.displayName || analysis.skillId}
                          </span>
                          <span className="text-gray-400">vs</span>
                          <span className="text-sm font-medium text-gray-900">
                            {group.members.find(m => m.skillId === analysis.relatedSkillId)?.skill.displayName || analysis.relatedSkillId}
                          </span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className={`px-2 py-1 text-xs rounded ${
                            analysis.isDuplicate
                              ? 'bg-red-100 text-red-800'
                              : 'bg-green-100 text-green-800'
                          }`}>
                            {analysis.isDuplicate ? '重复' : '独立'}
                          </span>
                          <span className="text-sm text-gray-600">
                            置信度: {(analysis.confidence * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>

                      {/* LLM Reason */}
                      {analysis.llmReason && (
                        <div className="mb-3">
                          <p className="text-xs text-gray-500 mb-1">LLM 判断理由:</p>
                          <p className="text-sm text-gray-700 bg-white p-2 rounded border">
                            {analysis.llmReason}
                          </p>
                        </div>
                      )}

                      {/* Key Differences */}
                      {analysis.keyDifferences && analysis.keyDifferences.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs text-gray-500 mb-1">主要差异:</p>
                          <ul className="text-sm text-gray-700 space-y-1">
                            {analysis.keyDifferences.map((diff, idx) => (
                              <li key={idx} className="flex items-start">
                                <span className="text-gray-400 mr-2">•</span>
                                {diff}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Recommendation */}
                      {analysis.recommendation && (
                        <div className="flex items-center justify-between pt-3 border-t border-gray-200">
                          <span className={`px-2 py-1 text-xs rounded ${
                            analysis.recommendation === 'merge'
                              ? 'bg-purple-100 text-purple-800'
                              : analysis.recommendation === 'keep_separate'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-orange-100 text-orange-800'
                          }`}>
                            {recommendationLabels[analysis.recommendation] || analysis.recommendation}
                          </span>
                          <span className="text-xs text-gray-500">
                            分析时间: {new Date(analysis.analyzedAt).toLocaleString('zh-CN')}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Action Panel (only for pending_review) */}
      {group.status === 'pending_review' && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">审核处理</h3>

          {/* Notes Input */}
          <div className="mb-4">
            <label className="block text-sm text-gray-600 mb-2">审核备注:</label>
            <textarea
              value={actionNotes}
              onChange={(e) => setActionNotes(e.target.value)}
              placeholder="输入审核备注（可选）..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={3}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center space-x-4">
            <button
              onClick={() => handleAction('merge')}
              disabled={processing || !selectedPrimary}
              className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {processing ? (
                <Loader2 size={20} className="mr-2 animate-spin" />
              ) : (
                <GitMerge size={20} className="mr-2" />
              )}
              合并到主 Skill
            </button>

            <button
              onClick={() => handleAction('keep_all')}
              disabled={processing}
              className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {processing ? (
                <Loader2 size={20} className="mr-2 animate-spin" />
              ) : (
                <CheckCircle size={20} className="mr-2" />
              )}
              保留全部
            </button>

            <button
              onClick={() => handleAction('delete_duplicates')}
              disabled={processing || selectedToDelete.length === 0}
              className="inline-flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {processing ? (
                <Loader2 size={20} className="mr-2 animate-spin" />
              ) : (
                <Trash2 size={20} className="mr-2" />
              )}
              删除标记的 Skill ({selectedToDelete.length})
            </button>
          </div>

          {/* Selection Summary */}
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="flex items-center space-x-4 text-sm text-gray-600">
              {selectedPrimary && (
                <span>
                  主 Skill: <span className="font-medium text-gray-900">
                    {group.members.find(m => m.skillId === selectedPrimary)?.skill.displayName}
                  </span>
                </span>
              )}
              {selectedToDelete.length > 0 && (
                <span>
                  待删除: <span className="font-medium text-red-600">
                    {selectedToDelete.map(id =>
                      group.members.find(m => m.skillId === id)?.skill.displayName
                    ).join(', ')}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Resolution Info (for resolved groups) */}
      {group.status === 'resolved' && group.resolution && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center space-x-3">
            <CheckCircle className="text-green-600" size={20} />
            <div>
              <p className="font-medium text-green-800">
                已处理: {group.resolution === 'merged' ? '合并' : group.resolution === 'keep_all' ? '保留全部' : '删除重复'}
              </p>
              {group.resolutionNotes && (
                <p className="text-sm text-green-700 mt-1">{group.resolutionNotes}</p>
              )}
              {group.resolvedAt && (
                <p className="text-xs text-green-600 mt-1">
                  处理时间: {new Date(group.resolvedAt).toLocaleString('zh-CN')}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}