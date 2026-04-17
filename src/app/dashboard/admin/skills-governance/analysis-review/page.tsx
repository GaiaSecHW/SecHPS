'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  ChevronRight,
  Filter,
} from 'lucide-react';

interface SkillInfo {
  id: string;
  name: string;
  displayName: string;
  category: string;
  techStackId: string | null;
  vulnerabilityPatternId: string | null;
}

interface AnalysisResult {
  id: string;
  skillA: SkillInfo;
  skillB: SkillInfo | null;
  isDuplicate: boolean;
  overlapType: string | null;
  confidence: number;
  llmReason: string | null;
  recommendation: string | null;
  entryPointComparison: {
    skillAEntryPoint: string;
    skillBEntryPoint: string;
    isSame: boolean;
    difference?: string;
  } | null;
  reviewStatus: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
}

interface ApiResponse {
  analyses: AnalysisResult[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  approved: 'bg-green-100 text-green-800 border-green-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
};

const statusLabels: Record<string, string> = {
  pending: '待审核',
  approved: '已确认重复',
  rejected: '已保留两者',
};

const recommendationLabels: Record<string, string> = {
  merge: '建议合并',
  keep_separate: '建议保留两者',
  review: '需人工判断',
};

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
    </div>
  );
}

function AnalysisReviewListContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = searchParams.get('status') || 'pending';
  const page = parseInt(searchParams.get('page') || '1');

  const [analyses, setAnalyses] = useState<AnalysisResult[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalyses();
  }, [status, page]);

  const fetchAnalyses = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(
        `/api/admin/skills-governance/analysis-review?status=${status}&page=${page}&limit=20`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error('获取数据失败');
      }

      const data: ApiResponse = await response.json();
      setAnalyses(data.analyses);
      setPagination(data.pagination);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = (newStatus: string) => {
    router.push(`/dashboard/admin/skills-governance/analysis-review?status=${newStatus}`);
  };

  return (
    <div className="p-6">
      {/* 头部 */}
      <div className="mb-6">
        <Link
          href="/dashboard/admin/skills-governance"
          className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft size={20} className="mr-2" />
          返回治理中心
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Skill 重复审核</h1>
        <p className="text-gray-600 mt-1">审核 LLM 分析结果，确认哪些 Skill 真正重复</p>
      </div>

      {/* 状态筛选 */}
      <div className="flex items-center space-x-2 mb-6">
        <Filter size={20} className="text-gray-400" />
        {[
          { key: 'pending', label: '待审核' },
          { key: 'approved', label: '已确认重复' },
          { key: 'rejected', label: '已保留两者' },
          { key: 'all', label: '全部' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleStatusChange(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              status === tab.key
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      ) : analyses.length === 0 ? (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-12 text-center">
          <FileText className="mx-auto text-gray-400 mb-4" size={48} />
          <p className="text-gray-600">暂无{statusLabels[status] || ''}分析结果</p>
        </div>
      ) : (
        <div className="space-y-4">
          {analyses.map((analysis) => (
            <Link
              key={analysis.id}
              href={`/dashboard/admin/skills-governance/analysis-review/${analysis.id}`}
              className="block bg-white rounded-lg shadow border border-gray-200 p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-4 mb-2">
                    <span className="font-medium text-gray-900">{analysis.skillA.displayName || analysis.skillA.name}</span>
                    <span className="text-gray-400">vs</span>
                    <span className="font-medium text-gray-900">{analysis.skillB?.displayName || analysis.skillB?.name || '未知'}</span>
                  </div>
                  
                  <div className="flex items-center space-x-4 text-sm text-gray-600">
                    <span className={`px-2 py-1 rounded text-xs ${analysis.isDuplicate ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                      {analysis.isDuplicate ? 'LLM判断: 重复' : 'LLM判断: 不重复'}
                    </span>
                    <span>置信度: {(analysis.confidence * 100).toFixed(0)}%</span>
                    {analysis.recommendation && (
                      <span className="text-blue-600">{recommendationLabels[analysis.recommendation] || analysis.recommendation}</span>
                    )}
                  </div>

                  {analysis.entryPointComparison && (
                    <div className="mt-2 text-sm text-gray-500">
                      <span className="font-medium">入口点对比:</span>{' '}
                      {analysis.entryPointComparison.isSame ? (
                        <span className="text-red-600">相同</span>
                      ) : (
                        <span className="text-green-600">不同</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center space-x-4">
                  <span className={`px-3 py-1 rounded-full text-xs border ${statusColors[analysis.reviewStatus]}`}>
                    {statusLabels[analysis.reviewStatus] || analysis.reviewStatus}
                  </span>
                  <ChevronRight className="text-gray-400" size={20} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* 分页 */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-center space-x-2 mt-6">
          <button
            onClick={() => router.push(`?status=${status}&page=${page - 1}`)}
            disabled={page <= 1}
            className="px-3 py-2 rounded border border-gray-300 text-sm disabled:opacity-50"
          >
            上一页
          </button>
          <span className="text-sm text-gray-600">
            第 {page} / {pagination.totalPages} 页
          </span>
          <button
            onClick={() => router.push(`?status=${status}&page=${page + 1}`)}
            disabled={page >= pagination.totalPages}
            className="px-3 py-2 rounded border border-gray-300 text-sm disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}

export default function AnalysisReviewListPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <AnalysisReviewListContent />
    </Suspense>
  );
}
