'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Code,
  GitMerge,
} from 'lucide-react';

interface SkillInfo {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  techStackId: string | null;
  vulnerabilityPatternId: string | null;
  content: string | null;
}

interface AnalysisDetail {
  id: string;
  skillA: SkillInfo;
  skillB: SkillInfo | null;
  isDuplicate: boolean;
  overlapType: string | null;
  confidence: number;
  llmReason: string | null;
  keyDifferences: string[] | null;
  sharedFunctionality: string[] | null;
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

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-t-2 border-blue-500"></div>
    </div>
  );
}

function AnalysisReviewDetailContent() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [analysis, setAnalysis] = useState<AnalysisDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState('');
  const [showSkillAContent, setShowSkillAContent] = useState(false);
  const [showSkillBContent, setShowSkillBContent] = useState(false);

  useEffect(() => {
    fetchAnalysis();
  }, [id]);

  const fetchAnalysis = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(
        `/api/admin/skills-governance/analysis-review/${id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error('获取数据失败');
      }

      const data = await response.json();
      setAnalysis(data.data);
      setNotes(data.data.reviewNotes || '');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async (action: 'confirm_duplicate' | 'keep_both' | 'pending') => {
    if (!analysis) return;

    try {
      setSubmitting(true);
      const token = localStorage.getItem('token');
      const response = await fetch(
        `/api/admin/skills-governance/analysis-review/${id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action,
            notes,
          }),
        }
      );

      if (!response.ok) {
        throw new Error('审核失败');
      }

      toast.success('审核成功');
      router.push('/dashboard/admin/skills-governance/analysis-review?status=pending');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '审核失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!analysis) {
    return (
      <div className="p-6">
        <p className="text-gray-600">分析结果不存在</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* 头部 */}
      <div className="mb-6">
        <Link
          href="/dashboard/admin/skills-governance/analysis-review"
          className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft size={20} className="mr-2" />
          返回审核列表
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Skill 重复审核详情</h1>
      </div>

      {/* Skill 对比 */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* Skill A */}
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-3">Skill A</h3>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-500">名称:</span>{' '}
              <span className="font-medium">{analysis.skillA.displayName || analysis.skillA.name}</span>
            </div>
            <div>
              <span className="text-gray-500">技术栈:</span>{' '}
              <span>{analysis.skillA.techStackId || '无'}</span>
            </div>
            <div>
              <span className="text-gray-500">漏洞类型:</span>{' '}
              <span>{analysis.skillA.vulnerabilityPatternId || '无'}</span>
            </div>
            <div>
              <span className="text-gray-500">类别:</span>{' '}
              <span>{analysis.skillA.category}</span>
            </div>
          </div>
          <div className="mt-3">
            <button
              onClick={() => setShowSkillAContent(!showSkillAContent)}
              className="text-blue-600 text-sm hover:underline"
            >
              {showSkillAContent ? '收起内容' : '展开内容'}
            </button>
            {showSkillAContent && analysis.skillA.content && (
              <pre className="mt-2 p-3 bg-gray-50 rounded text-xs overflow-auto max-h-64">
                {analysis.skillA.content.substring(0, 3000)}
              </pre>
            )}
          </div>
        </div>

        {/* Skill B */}
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-3">Skill B</h3>
          {analysis.skillB ? (
            <>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-gray-500">名称:</span>{' '}
                  <span className="font-medium">{analysis.skillB.displayName || analysis.skillB.name}</span>
                </div>
                <div>
                  <span className="text-gray-500">技术栈:</span>{' '}
                  <span>{analysis.skillB.techStackId || '无'}</span>
                </div>
                <div>
                  <span className="text-gray-500">漏洞类型:</span>{' '}
                  <span>{analysis.skillB.vulnerabilityPatternId || '无'}</span>
                </div>
                <div>
                  <span className="text-gray-500">类别:</span>{' '}
                  <span>{analysis.skillB.category}</span>
                </div>
              </div>
              <div className="mt-3">
                <button
                  onClick={() => setShowSkillBContent(!showSkillBContent)}
                  className="text-blue-600 text-sm hover:underline"
                >
                  {showSkillBContent ? '收起内容' : '展开内容'}
                </button>
                {showSkillBContent && analysis.skillB.content && (
                  <pre className="mt-2 p-3 bg-gray-50 rounded text-xs overflow-auto max-h-64">
                    {analysis.skillB.content.substring(0, 3000)}
                  </pre>
                )}
              </div>
            </>
          ) : (
            <p className="text-gray-500">无关联 Skill</p>
          )}
        </div>
      </div>

      {/* LLM 分析结果 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6 mb-6">
        <h3 className="font-semibold text-gray-900 mb-4">LLM 分析结果</h3>
        
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="p-3 bg-gray-50 rounded">
            <div className="text-sm text-gray-500">判断结果</div>
            <div className={`text-lg font-semibold ${analysis.isDuplicate ? 'text-red-600' : 'text-green-600'}`}>
              {analysis.isDuplicate ? '重复' : '不重复'}
            </div>
          </div>
          <div className="p-3 bg-gray-50 rounded">
            <div className="text-sm text-gray-500">置信度</div>
            <div className="text-lg font-semibold text-gray-900">
              {(analysis.confidence * 100).toFixed(0)}%
            </div>
          </div>
          <div className="p-3 bg-gray-50 rounded">
            <div className="text-sm text-gray-500">建议操作</div>
            <div className="text-lg font-semibold text-blue-600">
              {analysis.recommendation === 'merge' ? '合并' : 
               analysis.recommendation === 'keep_separate' ? '保留两者' : '需判断'}
            </div>
          </div>
        </div>

        {/* 入口点对比 */}
        {analysis.entryPointComparison && (
          <div className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <h4 className="font-medium text-blue-900 mb-2">入口点对比</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-blue-700">Skill A 入口点:</span>
                <p className="text-gray-700 mt-1">{analysis.entryPointComparison.skillAEntryPoint}</p>
              </div>
              <div>
                <span className="text-blue-700">Skill B 入口点:</span>
                <p className="text-gray-700 mt-1">{analysis.entryPointComparison.skillBEntryPoint}</p>
              </div>
            </div>
            <div className="mt-2 flex items-center">
              <span className="text-blue-700 mr-2">结论:</span>
              {analysis.entryPointComparison.isSame ? (
                <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-sm">入口点相同</span>
              ) : (
                <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-sm">入口点不同</span>
              )}
            </div>
            {analysis.entryPointComparison.difference && (
              <p className="mt-2 text-sm text-gray-600">
                差异: {analysis.entryPointComparison.difference}
              </p>
            )}
          </div>
        )}

        {/* 判断理由 */}
        {analysis.llmReason && (
          <div className="mb-4">
            <h4 className="font-medium text-gray-700 mb-2">判断理由</h4>
            <p className="text-gray-600 bg-gray-50 p-3 rounded">{analysis.llmReason}</p>
          </div>
        )}

        {/* 主要差异 */}
        {analysis.keyDifferences && analysis.keyDifferences.length > 0 && (
          <div className="mb-4">
            <h4 className="font-medium text-gray-700 mb-2">主要差异</h4>
            <ul className="list-disc list-inside text-gray-600 space-y-1">
              {analysis.keyDifferences.map((diff, i) => (
                <li key={i}>{diff}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 审核操作 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">审核操作</h3>
        
        {/* 备注 */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">审核备注</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={3}
            placeholder="可选：填写审核备注..."
          />
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center space-x-4">
          <button
            onClick={() => handleReview('confirm_duplicate')}
            disabled={submitting}
            className="inline-flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            <GitMerge size={20} className="mr-2" />
            确认重复 - 合并
          </button>
          <button
            onClick={() => handleReview('keep_both')}
            disabled={submitting}
            className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            <CheckCircle size={20} className="mr-2" />
            保留两者 - 独立
          </button>
          <button
            onClick={() => handleReview('pending')}
            disabled={submitting}
            className="inline-flex items-center px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50"
          >
            <Clock size={20} className="mr-2" />
            暂不决定
          </button>
        </div>

        {/* 已审核信息 */}
        {analysis.reviewStatus !== 'pending' && (
          <div className="mt-4 p-3 bg-gray-50 rounded text-sm text-gray-600">
            已由 {analysis.reviewedBy || '系统'} 于 {analysis.reviewedAt ? new Date(analysis.reviewedAt).toLocaleString() : '未知'} 审核
            {analysis.reviewNotes && `，备注: ${analysis.reviewNotes}`}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AnalysisReviewDetailPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <AnalysisReviewDetailContent />
    </Suspense>
  );
}
