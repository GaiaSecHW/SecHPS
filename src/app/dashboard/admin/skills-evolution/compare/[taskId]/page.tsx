'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RotateCcw,
  BarChart3,
  Target,
  Clock,
  Award,
  Loader2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { AdminGuard } from '@/components/PermissionGuard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Alert } from '@/components/ui/Alert';
import { SkillRollbackModal } from '@/components/skills/SkillRollbackModal';

// Types
interface TaskDetail {
  id: string;
  skillId: string;
  triggerReason: string;
  falsePositiveCount: number;
  confirmedCount: number;
  precisionBefore: number | null;
  precisionAfter: number | null;
  recallAfter: number | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
  newVersionId: string | null;
  improvementId: string | null;
  analysisResult: {
    precisionChange?: number;
    recallChange?: number;
    falsePositiveRateChange?: number;
    successReason?: string;
    error?: string;
  } | null;
}

interface SkillInfo {
  id: string;
  name: string;
  displayName: string;
  content: string;
}

interface ImprovementInfo {
  id: string;
  skillId: string;
  taskId: string;
  improvedContent: string;
  status: string;
  createdAt: string;
}

interface ComparisonResult {
  oldVersion: number;
  newVersion: number;
  precisionBefore: number;
  precisionAfter: number;
  precisionChange: number;
  recallBefore: number;
  recallAfter: number;
  recallChange: number;
  falsePositiveRateBefore: number;
  falsePositiveRateAfter: number;
  falsePositiveRateChange: number;
  isSuccess: boolean;
  successReason: string;
}

interface TaskDetailResponse {
  task: TaskDetail;
  skill: SkillInfo;
  improvement: ImprovementInfo | null;
  comparison: ComparisonResult | null;
}

export default function VersionComparePage() {
  return (
    <AdminGuard>
      <VersionCompareContent />
    </AdminGuard>
  );
}

function VersionCompareContent() {
  const router = useRouter();
  const params = useParams();
  const taskId = params.taskId as string;

  // State
  const [data, setData] = useState<TaskDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Rollback modal state
  const [showRollbackModal, setShowRollbackModal] = useState(false);
  const [rollbackReason, setRollbackReason] = useState('');
  
  // Expanded sections
  const [showOldContent, setShowOldContent] = useState(false);
  const [showNewContent, setShowNewContent] = useState(false);

  // Fetch task detail on mount
  useEffect(() => {
    fetchTaskDetail();
  }, [taskId]);

  const fetchTaskDetail = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      const response = await fetch(`/api/skills/evolution/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch task detail');
      }

      const result = await response.json();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRollback = () => {
    if (!data?.task.newVersionId || !data?.skill) return;
    setShowRollbackModal(true);
  };

  const handleRollbackSuccess = () => {
    toast.success('成功回滚到旧版本');
    setShowRollbackModal(false);
    fetchTaskDetail();
  };

  const navigateToSkillDetail = (skillId: string) => {
    router.push(`/dashboard/skills/${skillId}`);
  };

  const navigateToEvolutionList = () => {
    router.push('/dashboard/admin/skills-evolution');
  };

  // Format helpers
  const formatPrecision = (value: number | null | undefined) => {
    if (value === null || value === undefined) return 'N/A';
    return `${(value * 100).toFixed(1)}%`;
  };

  const formatChange = (value: number | undefined) => {
    if (value === undefined) return 'N/A';
    const sign = value >= 0 ? '+' : '';
    return `${sign}${(value * 100).toFixed(1)}%`;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  const getTriggerReasonLabel = (reason: string) => {
    switch (reason) {
      case 'low_precision':
        return '低精准率';
      case 'high_false_positive':
        return '高误报数';
      case 'manual':
        return '手动触发';
      default:
        return reason;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'analyzing':
        return 'bg-blue-100 text-blue-800';
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'rejected':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-dark-surface-hover text-gray-200';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'pending':
        return '待处理';
      case 'analyzing':
        return '分析中';
      case 'completed':
        return '已完成';
      case 'rejected':
        return '已拒绝';
      default:
        return status;
    }
  };

  // Change indicator component
  const ChangeIndicator = ({ value, inverse = false }: { value: number | undefined; inverse?: boolean }) => {
    if (value === undefined || value === null) {
      return <span className="text-gray-400">N/A</span>;
    }

    const isPositive = inverse ? value < 0 : value > 0;
    const isNeutral = value === 0;

    if (isNeutral) {
      return (
        <span className="flex items-center gap-1 text-gray-500">
          <Minus size={14} />
          {formatChange(value)}
        </span>
      );
    }

    if (isPositive) {
      return (
        <span className="flex items-center gap-1 text-green-600">
          <TrendingUp size={14} />
          {formatChange(value)}
        </span>
      );
    }

    return (
      <span className="flex items-center gap-1 text-red-600">
        <TrendingDown size={14} />
        {formatChange(value)}
      </span>
    );
  };

  // Simple bar chart component for trend visualization
  const TrendBar = ({ 
    before, 
    after, 
    label, 
    colorClass = 'bg-blue-600'
  }: { 
    before: number | null; 
    after: number | null; 
    label: string;
    colorClass?: string;
  }) => {
    const beforeValue = before ?? 0;
    const afterValue = after ?? 0;
    const maxValue = Math.max(beforeValue, afterValue, 0.1);

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">{label}</span>
          <span className="text-gray-100 font-medium">
            {formatPrecision(before)} → {formatPrecision(after)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Before bar */}
          <div className="flex-1 h-6 bg-dark-surface-hover rounded overflow-hidden relative">
            <div 
              className="absolute left-0 top-0 h-full bg-gray-400 rounded transition-all"
              style={{ width: `${(beforeValue / maxValue) * 100}%` }}
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
              旧版本
            </span>
          </div>
          {/* After bar */}
          <div className="flex-1 h-6 bg-dark-surface-hover rounded overflow-hidden relative">
            <div 
              className={`absolute left-0 top-0 h-full ${colorClass} rounded transition-all`}
              style={{ width: `${(afterValue / maxValue) * 100}%` }}
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
              新版本
            </span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" text="加载版本对比数据..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-dark-surface-hover rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-2xl font-bold text-gray-100">版本对比</h1>
        </div>
        <Alert type="error">{error}</Alert>
        <button
          onClick={fetchTaskDetail}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Loader2 size={16} className="mr-2" />
          重新加载
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 text-gray-500">
        未找到该进化任务
      </div>
    );
  }

  const { task, skill, improvement, comparison } = data;
  const isSuccess = comparison?.isSuccess ?? (task.status === 'completed');
  const canRollback = task.status === 'completed' && task.newVersionId;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={navigateToEvolutionList}
            className="p-2 hover:bg-dark-surface-hover rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-100">版本对比</h1>
            <p className="text-sm text-gray-400">
              {skill.displayName} - 进化任务 #{taskId.slice(-6)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Status badge */}
          <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${getStatusColor(task.status)}`}>
            {getStatusLabel(task.status)}
          </span>
          
          {/* Success/Failure indicator */}
          {task.status === 'completed' && (
            isSuccess ? (
              <span className="flex items-center gap-1 px-3 py-1.5 bg-green-900/20 text-green-700 rounded-full text-sm">
                <CheckCircle size={14} />
                进化成功
              </span>
            ) : (
              <span className="flex items-center gap-1 px-3 py-1.5 bg-red-900/20 text-red-700 rounded-full text-sm">
                <XCircle size={14} />
                进化失败
              </span>
            )
          )}
          
          {/* Rollback button */}
          {canRollback && (
            <button
              onClick={handleRollback}
              className="inline-flex items-center px-4 py-2 bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition-colors"
            >
              <RotateCcw size={16} className="mr-2" />
              回滚到旧版本
            </button>
          )}
          
          {/* Skill detail button */}
          <button
            onClick={() => navigateToSkillDetail(skill.id)}
            className="inline-flex items-center px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
          >
            <ExternalLink size={16} className="mr-2" />
            Skill 详情
          </button>
        </div>
      </div>

      {/* Task Info */}
      <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-gray-500">触发原因</p>
            <p className="text-lg font-semibold text-gray-100">
              {getTriggerReasonLabel(task.triggerReason)}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">创建时间</p>
            <p className="text-lg font-semibold text-gray-100">
              {formatDate(task.createdAt)}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">完成时间</p>
            <p className="text-lg font-semibold text-gray-100">
              {formatDate(task.completedAt)}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">改进记录</p>
            <p className="text-lg font-semibold text-gray-100">
              {improvement ? `#${improvement.id.slice(-6)}` : 'N/A'}
            </p>
          </div>
        </div>
      </div>

      {/* Metrics Comparison Table */}
      <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 overflow-hidden">
        <div className="px-4 py-3 bg-[#162032] border-b border-gray-700/50 flex items-center gap-2">
          <BarChart3 size={18} className="text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-100">指标对比</h2>
        </div>
        
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Precision */}
            <div className="bg-[#0F172A] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Target size={18} className="text-blue-600" />
                <h3 className="font-medium text-gray-100">精准率</h3>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">旧版本</span>
                  <span className="text-lg font-bold text-gray-100">
                    {formatPrecision(task.precisionBefore)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">新版本</span>
                  <span className="text-lg font-bold text-blue-600">
                    {formatPrecision(task.precisionAfter)}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-gray-700/50">
                  <span className="text-sm text-gray-400">变化</span>
                  <ChangeIndicator value={comparison?.precisionChange ?? task.analysisResult?.precisionChange} />
                </div>
              </div>
            </div>

            {/* Recall */}
            <div className="bg-[#0F172A] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Award size={18} className="text-green-600" />
                <h3 className="font-medium text-gray-100">召回率（确认率）</h3>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">旧版本</span>
                  <span className="text-lg font-bold text-gray-100">
                    {formatPrecision(comparison?.recallBefore ?? (task.confirmedCount > 0 ? task.confirmedCount / (task.falsePositiveCount + task.confirmedCount) : null))}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">新版本</span>
                  <span className="text-lg font-bold text-green-600">
                    {formatPrecision(task.recallAfter)}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-gray-700/50">
                  <span className="text-sm text-gray-400">变化</span>
                  <ChangeIndicator value={comparison?.recallChange ?? task.analysisResult?.recallChange} />
                </div>
              </div>
            </div>

            {/* False Positive Rate */}
            <div className="bg-[#0F172A] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={18} className="text-red-600" />
                <h3 className="font-medium text-gray-100">误报率</h3>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">旧版本</span>
                  <span className="text-lg font-bold text-gray-100">
                    {formatPrecision(comparison?.falsePositiveRateBefore ?? (task.falsePositiveCount > 0 ? task.falsePositiveCount / (task.falsePositiveCount + task.confirmedCount) : null))}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">新版本</span>
                  <span className="text-lg font-bold text-red-600">
                    {formatPrecision(comparison?.falsePositiveRateAfter)}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-gray-700/50">
                  <span className="text-sm text-gray-400">变化</span>
                  <ChangeIndicator value={comparison?.falsePositiveRateChange ?? task.analysisResult?.falsePositiveRateChange} inverse />
                </div>
              </div>
            </div>
          </div>

          {/* Counts */}
          <div className="mt-4 pt-4 border-t border-gray-700/50">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-gray-500">误报数（旧版本）</p>
                <p className="text-lg font-semibold text-red-600">
                  {task.falsePositiveCount}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">确认数（旧版本）</p>
                <p className="text-lg font-semibold text-green-600">
                  {task.confirmedCount}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">总发现数（旧版本）</p>
                <p className="text-lg font-semibold text-gray-100">
                  {task.falsePositiveCount + task.confirmedCount}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">进化结果</p>
                <p className={`text-lg font-semibold ${isSuccess ? 'text-green-600' : 'text-red-600'}`}>
                  {isSuccess ? '成功' : '失败'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Trend Visualization */}
      <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 overflow-hidden">
        <div className="px-4 py-3 bg-[#162032] border-b border-gray-700/50 flex items-center gap-2">
          <TrendingUp size={18} className="text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-100">趋势可视化</h2>
        </div>
        
        <div className="p-4 space-y-6">
          {/* Precision Trend */}
          <TrendBar
            before={task.precisionBefore}
            after={task.precisionAfter}
            label="精准率"
            colorClass={(comparison?.precisionChange ?? 0) > 0 ? 'bg-green-600' : 'bg-red-600'}
          />
          
          {/* Recall Trend */}
          <TrendBar
            before={comparison?.recallBefore ?? (task.confirmedCount > 0 ? task.confirmedCount / (task.falsePositiveCount + task.confirmedCount) : null)}
            after={task.recallAfter}
            label="召回率"
            colorClass={(comparison?.recallChange ?? 0) >= 0 ? 'bg-green-600' : 'bg-yellow-600'}
          />
          
          {/* False Positive Rate Trend */}
          <TrendBar
            before={comparison?.falsePositiveRateBefore ?? (task.falsePositiveCount > 0 ? task.falsePositiveCount / (task.falsePositiveCount + task.confirmedCount) : null)}
            after={comparison?.falsePositiveRateAfter ?? null}
            label="误报率"
            colorClass={(comparison?.falsePositiveRateChange ?? 0) <= 0 ? 'bg-green-600' : 'bg-red-600'}
          />
        </div>
      </div>

      {/* Success/Failure Analysis */}
      {task.analysisResult && (
        <div className={`bg-dark-surface rounded-lg shadow border overflow-hidden ${
          isSuccess ? 'border-green-500/20' : 'border-red-500/20'
        }`}>
          <div className={`px-4 py-3 border-b flex items-center gap-2 ${
            isSuccess ? 'bg-green-900/20 border-green-500/20' : 'bg-red-900/20 border-red-500/20'
          }`}>
            {isSuccess ? (
              <CheckCircle size={18} className="text-green-600" />
            ) : (
              <XCircle size={18} className="text-red-600" />
            )}
            <h2 className="text-lg font-semibold text-gray-100">
              {isSuccess ? '进化成功分析' : '进化失败分析'}
            </h2>
          </div>
          
          <div className="p-4">
            <div className="space-y-3">
              {/* Success Reason */}
              {comparison?.successReason && (
                <div className="bg-[#0F172A] rounded-lg p-3">
                  <p className="text-sm text-gray-400 mb-1">原因说明</p>
                  <p className="text-sm text-gray-100">{comparison.successReason}</p>
                </div>
              )}
              
              {/* Success Criteria */}
              <div className="bg-[#0F172A] rounded-lg p-3">
                <p className="text-sm text-gray-400 mb-2">成功标准</p>
                <ul className="text-sm text-gray-300 space-y-1">
                  <li className="flex items-center gap-2">
                    {(comparison?.precisionChange ?? 0) > 0 ? (
                      <CheckCircle size={14} className="text-green-600" />
                    ) : (
                      <XCircle size={14} className="text-red-600" />
                    )}
                    精准率必须提升 (precisionChange {'>'} 0)
                  </li>
                  <li className="flex items-center gap-2">
                    {(comparison?.recallChange ?? 0) >= -0.05 ? (
                      <CheckCircle size={14} className="text-green-600" />
                    ) : (
                      <XCircle size={14} className="text-red-600" />
                    )}
                    召回率下降不超过 5% (recallChange {'>='} -0.05)
                  </li>
                </ul>
              </div>
              
              {/* Error message if failed */}
              {task.analysisResult.error && (
                <div className="bg-red-900/20 border border-red-500/20 rounded-lg p-3">
                  <p className="text-sm text-red-700">
                    <strong>错误:</strong> {task.analysisResult.error}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Content Comparison */}
      {improvement && (
        <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 overflow-hidden">
          <div className="px-4 py-3 bg-[#162032] border-b border-gray-700/50 flex items-center gap-2">
            <Clock size={18} className="text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-100">内容对比</h2>
          </div>
          
          <div className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Old Content */}
              <div>
                <button
                  onClick={() => setShowOldContent(!showOldContent)}
                  className="w-full flex items-center justify-between px-4 py-2 bg-dark-surface-hover rounded-lg hover:bg-dark-surface-hover transition-colors"
                >
                  <span className="font-medium text-gray-300">旧版本内容</span>
                  {showOldContent ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
                {showOldContent && (
                  <div className="mt-2 p-3 bg-[#0F172A] rounded-lg border border-gray-700/50">
                    <pre className="text-sm text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-[300px]">
                      {skill.content || '无内容'}
                    </pre>
                  </div>
                )}
              </div>
              
              {/* New Content */}
              <div>
                <button
                  onClick={() => setShowNewContent(!showNewContent)}
                  className="w-full flex items-center justify-between px-4 py-2 bg-blue-100 rounded-lg hover:bg-blue-200 transition-colors"
                >
                  <span className="font-medium text-blue-700">新版本内容</span>
                  {showNewContent ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
                {showNewContent && (
                  <div className="mt-2 p-3 bg-blue-900/20 rounded-lg border border-blue-500/20">
                    <pre className="text-sm text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-[300px]">
                      {improvement.improvedContent || '无内容'}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rollback Modal */}
      {showRollbackModal && data?.task.newVersionId && (
        <SkillRollbackModal
          isOpen={showRollbackModal}
          onClose={() => setShowRollbackModal(false)}
          onSuccess={handleRollbackSuccess}
          skillId={skill.id}
          currentVersionId={task.newVersionId!}
          targetVersionId={skill.id}
          targetVersionNumber={comparison?.oldVersion ?? 1}
          currentVersionNumber={comparison?.newVersion ?? 2}
          skillDisplayName={skill.displayName}
        />
      )}
    </div>
  );
}