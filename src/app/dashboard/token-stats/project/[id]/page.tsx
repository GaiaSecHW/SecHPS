'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Coins,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  CheckCircle,
  XCircle,
  Eye,
  Calendar,
  Filter,
  Info,
} from 'lucide-react';
import Link from 'next/link';

interface ProjectInfo {
  id: string;
  name: string;
}

interface TokenUsageRecord {
  id: string;
  evaluationId: string;
  apiProvider: string;
  modelName: string | null;
  callType: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number | null;
  requestPreview: string | null;
  responsePreview: string | null;
  requestStartedAt: string;
  requestCompletedAt: string | null;
  durationMs: number | null;
  estimatedCost: number | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  evaluation: {
    id: string;
    title: string | null;
    status: string;
    startedAt: string;
    completedAt: string | null;
  };
}

interface EvaluationSummary {
  id: string;
  title: string | null;
  status: string;
  startedAt: string;
  completedAt: string | null;
  modelName: string | null;
  providerType: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  estimatedCost: number | null;
  messageCount: number;
  duration: number | null;
}

interface PaginatedData {
  data: TokenUsageRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export default function ProjectTokenDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [evaluations, setEvaluations] = useState<EvaluationSummary[]>([]);
  const [tokenUsages, setTokenUsages] = useState<PaginatedData | null>(null);

  const [expandedRecords, setExpandedRecords] = useState<Set<string>>(new Set());
  const [selectedEvaluation, setSelectedEvaluation] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetchData();
  }, [id, selectedEvaluation, page]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const url = selectedEvaluation
        ? `/api/token-stats/project?projectId=${id}&evaluationId=${selectedEvaluation}&page=${page}&limit=50`
        : `/api/token-stats/project?projectId=${id}&page=${page}&limit=50`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || '获取数据失败');
        setLoading(false);
        return;
      }

      const data = await response.json();
      setProject(data.project);
      setSummary(data.summary);
      setEvaluations(data.evaluations);
      setTokenUsages(data.tokenUsages);
      setLoading(false);
    } catch (err) {
      console.error('Fetch data error:', err);
      setError('网络错误，请重试');
      setLoading(false);
    }
  };

  const toggleRecord = (recordId: string) => {
    setExpandedRecords((prev) => {
      const next = new Set(prev);
      if (next.has(recordId)) {
        next.delete(recordId);
      } else {
        next.add(recordId);
      }
      return next;
    });
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(2)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  };

  const formatCost = (cost: number | null) => {
    if (cost === null || cost === 0) {
      return '¥0';
    }
    return `¥${cost.toFixed(4)}`;
  };

  // 费用显示组件（带计费规则提示）
  const CostWithTooltip = ({ cost }: { cost: number | null }) => (
    <span className="flex items-center">
      {formatCost(cost)}
      <span className="ml-1 cursor-help relative group">
        <Info size={10} className="text-orange-400 hover:text-orange-600" />
        <span className="absolute right-0 bottom-full mb-1 hidden group-hover:block bg-gray-800 text-white text-xs rounded p-1.5 whitespace-nowrap z-10 shadow-lg">
          ¥6/百万输入 + ¥22/百万输出
        </span>
      </span>
    </span>
  );

  const formatDuration = (ms: number | null) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle size={14} className="text-green-500" />;
      case 'error':
        return <XCircle size={14} className="text-red-500" />;
      default:
        return <Clock size={14} className="text-dark-text-muted" />;
    }
  };

  if (loading && !project) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-dark-text mb-2">加载失败</h2>
          <p className="text-dark-text-muted mb-4">{error}</p>
          <button
            onClick={() => router.push('/dashboard/token-stats')}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-primary-700"
          >
            返回统计页面
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div className="flex items-center justify-between bg-dark-surface rounded-lg border border-dark-border p-4">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => router.push('/dashboard/token-stats')}
            className="text-dark-text-muted hover:text-dark-text-muted"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-dark-text flex items-center">
              <Coins className="mr-2 text-blue-400" size={24} />
              {project?.name || '项目'} Token 消耗明细
            </h1>
            <p className="text-sm text-dark-text-muted">查看每次 API 调用的详细消耗情况</p>
          </div>
        </div>
      </div>

      {/* 项目汇总 */}
      <div className="bg-dark-surface rounded-lg border border-dark-border p-6">
        <h2 className="text-lg font-semibold text-dark-text mb-4">项目汇总</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-blue-600/10 rounded-lg p-4">
            <p className="text-xs text-blue-400">总输入 Token</p>
            <p className="text-lg font-bold text-blue-400">
              {formatNumber(summary?.totalInputTokens || 0)}
            </p>
          </div>
          <div className="bg-green-600/10 rounded-lg p-4">
            <p className="text-xs text-green-400">总输出 Token</p>
            <p className="text-lg font-bold text-green-400">
              {formatNumber(summary?.totalOutputTokens || 0)}
            </p>
          </div>
          <div className="bg-purple-600/10 rounded-lg p-4">
            <p className="text-xs text-purple-600">总 Token</p>
            <p className="text-lg font-bold text-purple-700">
              {formatNumber(summary?.totalTokens || 0)}
            </p>
          </div>
          <div className="bg-orange-600/10 rounded-lg p-4">
            <p className="text-xs text-orange-600 flex items-center">
              预估费用
              <span 
                className="ml-1 cursor-help relative group"
              >
                <Info size={12} className="text-orange-400 hover:text-orange-600" />
                <span className="absolute left-0 bottom-full mb-2 hidden group-hover:block bg-gray-800 text-white text-xs rounded p-2 whitespace-nowrap z-10 shadow-lg">
                  费用 = 输入Token × 单价 + 输出Token × 单价<br/>
                  <span className="text-dark-text-muted">单价：输入 ¥6/百万，输出 ¥22/百万</span>
                </span>
              </span>
            </p>
            <p className="text-lg font-bold text-orange-700">
              {formatCost(summary?.estimatedCost)}
            </p>
          </div>
          <div className="bg-[#0F172A] rounded-lg p-4">
            <p className="text-xs text-dark-text-muted">评估次数</p>
            <p className="text-lg font-bold text-dark-text-secondary">
              {summary?.evaluationCount || 0}
            </p>
          </div>
        </div>
      </div>

      {/* 评估列表 */}
      <div className="bg-dark-surface rounded-lg border border-dark-border p-6">
        <h2 className="text-lg font-semibold text-dark-text mb-4 flex items-center">
          <Calendar className="mr-2 text-blue-400" size={20} />
          评估会话列表
        </h2>
        <div className="space-y-2">
          {evaluations.map((evaluation) => (
            <div
              key={evaluation.id}
              className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                selectedEvaluation === evaluation.id
                  ? 'bg-blue-600/10 border-blue-300'
                  : 'bg-[#0F172A] border-dark-border hover:bg-blue-600/100/100/10 hover:border-blue-500/20'
              }`}
              onClick={() => setSelectedEvaluation(selectedEvaluation === evaluation.id ? null : evaluation.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="flex items-center space-x-2">
                    {evaluation.status === 'completed' ? (
                      <CheckCircle size={16} className="text-green-500" />
                    ) : evaluation.status === 'failed' ? (
                      <XCircle size={16} className="text-red-500" />
                    ) : (
                      <Loader2 size={16} className="text-blue-500 animate-spin" />
                    )}
                    <span className="text-sm font-medium text-dark-text">
                      {evaluation.title || `评估 ${evaluation.id.substring(0, 8)}`}
                    </span>
                  </div>
                  <span className="text-xs text-dark-text-muted">
                    {evaluation.modelName || '未知模型'}
                  </span>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="text-right">
                    <div className="flex items-center space-x-2 text-xs">
                      <span className="text-blue-400">↑{formatNumber(evaluation.totalInputTokens)}</span>
                      <span className="text-green-400">↓{formatNumber(evaluation.totalOutputTokens)}</span>
                    </div>
                    <p className="text-xs text-dark-text-muted flex items-center">
                      <CostWithTooltip cost={evaluation.estimatedCost} />
                      <span className="mx-1">·</span>
                      {evaluation.duration ? `${evaluation.duration}s` : '-'}
                    </p>
                  </div>
                  <ChevronRight
                    size={16}
                    className={`text-dark-text-muted transition-transform ${
                      selectedEvaluation === evaluation.id ? 'rotate-90' : ''
                    }`}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Token 使用记录 */}
      <div className="bg-dark-surface rounded-lg border border-dark-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-dark-text flex items-center">
            <Filter className="mr-2 text-blue-400" size={20} />
            API 调用记录
            {selectedEvaluation && (
              <span className="ml-2 text-sm text-dark-text-muted">
                (筛选: {evaluations.find(e => e.id === selectedEvaluation)?.title || selectedEvaluation.substring(0, 8)})
              </span>
            )}
          </h2>
          {selectedEvaluation && (
            <button
              onClick={() => setSelectedEvaluation(null)}
              className="text-sm text-blue-400 hover:text-blue-800"
            >
              显示全部
            </button>
          )}
        </div>

        {tokenUsages?.data.length === 0 ? (
          <div className="text-center py-8 bg-[#0F172A] rounded-lg">
            <Coins className="mx-auto h-12 w-12 text-dark-text-muted" />
            <p className="mt-4 text-sm text-dark-text-muted">暂无 API 调用记录</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tokenUsages?.data.map((record) => (
              <div key={record.id} className="border border-dark-border rounded-lg overflow-hidden">
                {/* 可点击的标题行 */}
                <button
                  className="w-full flex items-center justify-between px-4 py-3 text-left bg-[#0F172A] hover:bg-dark-surface-hover transition-colors"
                  onClick={() => toggleRecord(record.id)}
                >
                  <div className="flex items-center space-x-3 min-w-0 flex-1">
                    {getStatusIcon(record.status)}
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-medium bg-blue-500/15 text-blue-400 px-2 py-0.5 rounded">
                        {record.apiProvider}
                      </span>
                      <span className="text-xs text-dark-text-muted">
                        {record.modelName || '未知模型'}
                      </span>
                      <span className="text-xs text-dark-text-muted">
                        {record.callType}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4 flex-shrink-0">
                    <div className="text-right">
                      <div className="flex items-center space-x-2 text-xs">
                        <span className="text-blue-400">↑{formatNumber(record.inputTokens)}</span>
                        <span className="text-green-400">↓{formatNumber(record.outputTokens)}</span>
                      </div>
                      <p className="text-xs text-dark-text-muted">
                        {formatDuration(record.durationMs)}
                      </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs text-dark-text-muted">
                        {new Date(record.createdAt).toLocaleTimeString('zh-CN')}
                      </span>
                      {expandedRecords.has(record.id) ? (
                        <ChevronDown size={16} className="text-dark-text-muted" />
                      ) : (
                        <ChevronRight size={16} className="text-dark-text-muted" />
                      )}
                    </div>
                  </div>
                </button>

                {/* 展开的详情 */}
                {expandedRecords.has(record.id) && (
                  <div className="px-4 py-3 border-t border-dark-border bg-dark-surface">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                      <div>
                        <p className="text-xs text-dark-text-muted">总 Token</p>
                        <p className="text-sm font-medium text-dark-text">{record.totalTokens}</p>
                      </div>
                      <div>
                        <p className="text-xs text-dark-text-muted">缓存 Token</p>
                        <p className="text-sm font-medium text-dark-text">{record.cachedTokens || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-dark-text-muted">预估费用</p>
                        <p className="text-sm font-medium text-orange-600">
                          <CostWithTooltip cost={record.estimatedCost} />
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-dark-text-muted">状态</p>
                        <p className="text-sm font-medium flex items-center space-x-1">
                          {getStatusIcon(record.status)}
                          <span className={record.status === 'success' ? 'text-green-400' : 'text-red-400'}>
                            {record.status}
                          </span>
                        </p>
                      </div>
                    </div>

                    {record.errorMessage && (
                      <div className="bg-red-900/20 border border-red-800/40 rounded p-2 mb-3">
                        <p className="text-xs text-red-400">{record.errorMessage}</p>
                      </div>
                    )}

                    {/* 请求预览 */}
                    {record.requestPreview && (
                      <div className="mb-3">
                        <p className="text-xs font-medium text-dark-text-secondary mb-1">请求预览</p>
                        <pre className="text-xs bg-gray-800 text-dark-text-secondary p-2 rounded overflow-x-auto max-h-32">
                          {record.requestPreview}
                        </pre>
                      </div>
                    )}

                    {/* 响应预览 */}
                    {record.responsePreview && (
                      <div>
                        <p className="text-xs font-medium text-dark-text-secondary mb-1">响应预览</p>
                        <pre className="text-xs bg-gray-800 text-green-300 p-2 rounded overflow-x-auto max-h-32">
                          {record.responsePreview}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 分页 */}
        {tokenUsages?.pagination.hasMore && (
          <div className="mt-4 flex justify-center">
            <button
              onClick={() => setPage(page + 1)}
              disabled={loading}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
            >
              {loading ? '加载中...' : '加载更多'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}