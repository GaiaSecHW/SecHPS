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
  FileText,
  GitCompare,
  Sparkles,
  Target,
  Award,
  BarChart3,
  RefreshCw,
  Save,
  Loader2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Zap,
  Shield,
  Bug,
} from 'lucide-react';
import { AdminGuard } from '@/components/PermissionGuard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Alert } from '@/components/ui/Alert';

// ============================================================================
// Types
// ============================================================================

interface CompactCase {
  vulnerabilityId: string;
  title: string;
  description: string;
  filePath?: string;
  codeSnippetPreview?: string;
  status: 'false_positive' | 'confirmed';
  markedAt: string;
}

interface BalanceAnalysisResult {
  falsePositivePatterns: string[];
  falsePositiveCauses: string[];
  confirmedPatterns: string[];
  confirmedStrengths: string[];
  recommendations: Array<{
    type: 'add_rule' | 'modify_rule' | 'add_exception' | 'refine_pattern';
    description: string;
    impact: 'reduce_false_positive' | 'maintain_detection' | 'both';
  }>;
  warnings: string[];
}

interface SkillInfo {
  id: string;
  name: string;
  displayName: string;
  description: string;
  content: string | null;
  version: number;
  execCount: number;
  vulnerabilityCount: number;
  successExecCount: number;
  successRate: number | null;
}

interface SkillImprovementDetail {
  id: string;
  skillId: string;
  skillName: string;
  originalContent: string;
  improvedContent: string;
  analysis: BalanceAnalysisResult;
  falsePositiveCases: CompactCase[];
  confirmedCases: CompactCase[];
  createdAt: string;
  status: string;
}

interface EvolutionTaskDetail {
  id: string;
  skillId: string;
  triggerReason: string;
  falsePositiveCount: number;
  confirmedCount: number;
  precisionBefore: number | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
  Skill: SkillInfo;
  Improvement: SkillImprovementDetail | null;
}

// ============================================================================
// Diff Modal Component
// ============================================================================

interface DiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  originalContent: string;
  improvedContent: string;
  originalLabel: string;
  improvedLabel: string;
}

function DiffModal({
  isOpen,
  onClose,
  originalContent,
  improvedContent,
  originalLabel,
  improvedLabel,
}: DiffModalProps) {
  const [viewMode, setViewMode] = useState<'side-by-side' | 'inline'>('side-by-side');

  // Simple diff computation
  const computeDiff = (before: string, after: string) => {
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    
    const maxLen = Math.max(beforeLines.length, afterLines.length);
    const diffLines: Array<{
      type: 'same' | 'added' | 'removed' | 'modified';
      before?: string;
      after?: string;
      lineNum: number;
    }> = [];

    for (let i = 0; i < maxLen; i++) {
      const beforeLine = beforeLines[i];
      const afterLine = afterLines[i];

      if (beforeLine === afterLine) {
        diffLines.push({ type: 'same', before: beforeLine, after: afterLine, lineNum: i + 1 });
      } else if (beforeLine === undefined) {
        diffLines.push({ type: 'added', after: afterLine, lineNum: i + 1 });
      } else if (afterLine === undefined) {
        diffLines.push({ type: 'removed', before: beforeLine, lineNum: i + 1 });
      } else {
        diffLines.push({ type: 'modified', before: beforeLine, after: afterLine, lineNum: i + 1 });
      }
    }

    return diffLines;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-3">
            <GitCompare size={20} className="text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">Skill 内容对比</h2>
          </div>
          
          <div className="flex items-center gap-4">
            {/* View Mode Toggle */}
            <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode('side-by-side')}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  viewMode === 'side-by-side'
                    ? 'bg-white shadow text-gray-900'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                并排对比
              </button>
              <button
                onClick={() => setViewMode('inline')}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  viewMode === 'inline'
                    ? 'bg-white shadow text-gray-900'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                内联对比
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <XCircle size={20} className="text-gray-500" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {viewMode === 'side-by-side' ? (
            <div className="grid grid-cols-2 gap-4">
              {/* Original */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-gray-100 border-b border-gray-200 flex items-center gap-2">
                  <FileText size={16} className="text-gray-500" />
                  <span className="font-medium text-gray-700">{originalLabel}</span>
                </div>
                <pre className="p-4 text-sm text-gray-700 overflow-auto max-h-[400px] whitespace-pre-wrap font-mono">
                  {originalContent || '暂无内容'}
                </pre>
              </div>

              {/* Improved */}
              <div className="border border-green-200 rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-green-50 border-b border-green-200 flex items-center gap-2">
                  <FileText size={16} className="text-green-600" />
                  <span className="font-medium text-green-700">{improvedLabel}</span>
                </div>
                <pre className="p-4 text-sm text-gray-700 overflow-auto max-h-[400px] whitespace-pre-wrap font-mono">
                  {improvedContent || '暂无内容'}
                </pre>
              </div>
            </div>
          ) : (
            /* Inline Diff View */
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2 bg-gray-100 border-b border-gray-200 flex items-center gap-2">
                <FileText size={16} className="text-gray-500" />
                <span className="font-medium text-gray-700">内联对比视图</span>
                <div className="ml-auto flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 bg-red-200 rounded"></span>
                    删除
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 bg-green-200 rounded"></span>
                    新增
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 bg-yellow-200 rounded"></span>
                    修改
                  </span>
                </div>
              </div>
              <div className="overflow-auto max-h-[400px]">
                {computeDiff(originalContent, improvedContent).map((line, idx) => (
                  <div
                    key={idx}
                    className={`flex items-stretch font-mono text-sm ${
                      line.type === 'removed' ? 'bg-red-50' :
                      line.type === 'added' ? 'bg-green-50' :
                      line.type === 'modified' ? 'bg-yellow-50' :
                      ''
                    }`}
                  >
                    <span className="px-2 py-1 bg-gray-100 text-gray-400 text-xs min-w-[40px] text-right select-none">
                      {line.lineNum}
                    </span>
                    {line.type === 'removed' && (
                      <span className="px-4 py-1 text-red-700 flex-1">
                        <span className="text-red-400 mr-2">-</span>
                        {line.before}
                      </span>
                    )}
                    {line.type === 'added' && (
                      <span className="px-4 py-1 text-green-700 flex-1">
                        <span className="text-green-400 mr-2">+</span>
                        {line.after}
                      </span>
                    )}
                    {line.type === 'modified' && (
                      <>
                        <span className="px-4 py-1 text-red-700 flex-1 border-r border-gray-200">
                          <span className="text-red-400 mr-2">-</span>
                          {line.before}
                        </span>
                        <span className="px-4 py-1 text-green-700 flex-1">
                          <span className="text-green-400 mr-2">+</span>
                          {line.after}
                        </span>
                      </>
                    )}
                    {line.type === 'same' && (
                      <span className="px-4 py-1 text-gray-700 flex-1">
                        <span className="text-gray-300 mr-2"> </span>
                        {line.before}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Content Component
// ============================================================================

function EvolutionAnalysisContent() {
  const router = useRouter();
  const params = useParams();
  const taskId = params.id as string;

  // State
  const [task, setTask] = useState<EvolutionTaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  
  // UI state
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [expandedFalsePositives, setExpandedFalsePositives] = useState(false);
  const [expandedConfirmed, setExpandedConfirmed] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  useEffect(() => {
    fetchTaskDetail();
  }, [taskId]);

  const fetchTaskDetail = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const token = localStorage.getItem('token');
      
      // Fetch task detail from evolution tasks API
      const response = await fetch(`/api/skills/evolution/tasks/${taskId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '获取任务详情失败');
      }

      const data = await response.json();
      setTask(data.task);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
      toast.error(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyImprovement = async () => {
    if (!task?.Improvement) {
      toast.error('没有可应用的改进');
      return;
    }

    if (!confirm('确定要应用此改进吗？这将创建新的 Skill 版本。')) {
      return;
    }

    try {
      setSubmitting(true);
      const token = localStorage.getItem('token');
      
      const response = await fetch(`/api/skills/${task.skillId}/evolve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          improvementId: task.Improvement.id,
          action: 'apply',
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '应用改进失败');
      }

      toast.success('改进已应用，新版本已创建');
      router.push('/dashboard/admin/skills-evolution');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '应用改进失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRejectImprovement = async () => {
    if (!task?.Improvement) {
      toast.error('没有可拒绝的改进');
      return;
    }

    if (!rejectReason.trim()) {
      toast.error('请填写拒绝原因');
      return;
    }

    try {
      setSubmitting(true);
      const token = localStorage.getItem('token');
      
      const response = await fetch(`/api/skills/${task.skillId}/evolve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          improvementId: task.Improvement.id,
          action: 'reject',
          reason: rejectReason.trim(),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '拒绝改进失败');
      }

      toast.success('改进已拒绝');
      setShowRejectInput(false);
      setRejectReason('');
      router.push('/dashboard/admin/skills-evolution');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '拒绝改进失败');
    } finally {
      setSubmitting(false);
    }
  };

  // Format precision as percentage
  const formatPrecision = (value: number | null) => {
    if (value === null) return 'N/A';
    return `${(value * 100).toFixed(1)}%`;
  };

  // Get recommendation type label
  const getRecommendationTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'add_rule': '添加规则',
      'modify_rule': '修改规则',
      'add_exception': '添加排除条件',
      'refine_pattern': '细化模式',
    };
    return labels[type] || type;
  };

  // Get recommendation impact label
  const getImpactLabel = (impact: string) => {
    const labels: Record<string, string> = {
      'reduce_false_positive': '减少误报',
      'maintain_detection': '保持检测',
      'both': '平衡改进',
    };
    return labels[impact] || impact;
  };

  // Get trigger reason label
  const getTriggerReasonLabel = (reason: string) => {
    const labels: Record<string, string> = {
      'low_precision': '低精准率',
      'high_false_positive': '高误报数',
      'manual': '手动触发',
    };
    return labels[reason] || reason;
  };

  // Get status badge color
  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'pending': 'bg-yellow-100 text-yellow-800',
      'applied': 'bg-green-100 text-green-800',
      'rejected': 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" text="加载分析数据..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 p-6">
        <div>
          <Link
            href="/dashboard/admin/skills-evolution"
            className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft size={20} className="mr-2" />
            返回进化管理
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">进化分析详情</h1>
        </div>
        <Alert type="error">{error}</Alert>
        <button
          onClick={fetchTaskDetail}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <RefreshCw size={20} className="mr-2" />
          重新加载
        </button>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="p-6">
        <Link
          href="/dashboard/admin/skills-evolution"
          className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft size={20} className="mr-2" />
          返回进化管理
        </Link>
        <p className="text-gray-600">任务不存在</p>
      </div>
    );
  }

  const improvement = task.Improvement;
  const skill = task.Skill;
  const analysis = improvement?.analysis;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/dashboard/admin/skills-evolution"
            className="inline-flex items-center text-gray-600 hover:text-gray-900 mb-2"
          >
            <ArrowLeft size={20} className="mr-2" />
            返回进化管理
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">进化分析详情</h1>
          <p className="mt-1 text-sm text-gray-600">
            {skill.displayName} - {getTriggerReasonLabel(task.triggerReason)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/dashboard/skills/${skill.id}`}
            className="inline-flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <ExternalLink size={16} className="mr-2" />
            Skill 详情
          </Link>
          <button
            onClick={fetchTaskDetail}
            className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            <RefreshCw size={16} className="mr-2" />
            刷新
          </button>
        </div>
      </div>

      {/* Skill Metrics Summary */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <BarChart3 size={20} className="text-blue-600" />
          Skill 指标概览
        </h2>
        
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">版本</p>
            <p className="text-lg font-semibold text-gray-900">v{skill.version}</p>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">执行次数</p>
            <p className="text-lg font-semibold text-gray-900">{skill.execCount}</p>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">发现问题</p>
            <p className="text-lg font-semibold text-blue-600">{skill.vulnerabilityCount}</p>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">成功执行</p>
            <p className="text-lg font-semibold text-green-600">{skill.successExecCount}</p>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">进化前精准率</p>
            <p className={`text-lg font-semibold ${
              (task.precisionBefore ?? 0) >= 0.7 ? 'text-green-600' : 'text-red-600'
            }`}>
              {formatPrecision(task.precisionBefore)}
            </p>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">成功率</p>
            <p className="text-lg font-semibold text-gray-900">
              {skill.successRate ? `${(skill.successRate * 100).toFixed(1)}%` : 'N/A'}
            </p>
          </div>
        </div>

        {/* Task Info */}
        <div className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-500">触发原因</p>
            <p className="text-sm font-medium text-gray-900">{getTriggerReasonLabel(task.triggerReason)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">误报数</p>
            <p className="text-sm font-medium text-red-600">{task.falsePositiveCount}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">确认数</p>
            <p className="text-sm font-medium text-green-600">{task.confirmedCount}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">创建时间</p>
            <p className="text-sm font-medium text-gray-900">
              {new Date(task.createdAt).toLocaleString('zh-CN')}
            </p>
          </div>
        </div>
      </div>

      {/* False Positive Cases */}
      <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-red-50 border-b border-red-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-red-600" />
            <h2 className="text-lg font-semibold text-gray-900">误报案例</h2>
            <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded-full">
              {improvement?.falsePositiveCases?.length || 0} 个
            </span>
          </div>
          <button
            onClick={() => setExpandedFalsePositives(!expandedFalsePositives)}
            className="p-1 hover:bg-red-100 rounded transition-colors"
          >
            {expandedFalsePositives ? (
              <ChevronUp size={20} className="text-red-600" />
            ) : (
              <ChevronDown size={20} className="text-red-600" />
            )}
          </button>
        </div>
        
        {expandedFalsePositives && (
          <div className="divide-y divide-gray-200">
            {!improvement?.falsePositiveCases || improvement.falsePositiveCases.length === 0 ? (
              <div className="p-8 text-center">
                <XCircle className="mx-auto h-12 w-12 text-gray-400" />
                <p className="mt-2 text-sm text-gray-600">暂无误报案例</p>
              </div>
            ) : (
              improvement.falsePositiveCases.map((caseItem, index) => (
                <div key={caseItem.vulnerabilityId || index} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded font-medium">
                          误报
                        </span>
                        <span className="font-medium text-gray-900">{caseItem.title}</span>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">
                        {caseItem.description}
                      </p>
                      {caseItem.filePath && (
                        <p className="text-xs text-gray-500 flex items-center gap-1">
                          <Code size={12} />
                          {caseItem.filePath}
                        </p>
                      )}
                      {caseItem.codeSnippetPreview && (
                        <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-x-auto max-h-32">
                          {caseItem.codeSnippetPreview}
                        </pre>
                      )}
                      <p className="text-xs text-gray-400 mt-2">
                        标记时间: {new Date(caseItem.markedAt).toLocaleString('zh-CN')}
                      </p>
                    </div>
                    <Link
                      href={`/dashboard/admin/vulnerabilities?id=${caseItem.vulnerabilityId}`}
                      className="ml-4 inline-flex items-center px-3 py-1.5 text-sm bg-red-100 text-red-800 rounded hover:bg-red-200"
                    >
                      <Bug size={14} className="mr-1" />
                      详情
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Confirmed Cases */}
      <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-green-50 border-b border-green-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <h2 className="text-lg font-semibold text-gray-900">正确发现案例</h2>
            <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full">
              {improvement?.confirmedCases?.length || 0} 个
            </span>
          </div>
          <button
            onClick={() => setExpandedConfirmed(!expandedConfirmed)}
            className="p-1 hover:bg-green-100 rounded transition-colors"
          >
            {expandedConfirmed ? (
              <ChevronUp size={20} className="text-green-600" />
            ) : (
              <ChevronDown size={20} className="text-green-600" />
            )}
          </button>
        </div>
        
        {expandedConfirmed && (
          <div className="divide-y divide-gray-200">
            {!improvement?.confirmedCases || improvement.confirmedCases.length === 0 ? (
              <div className="p-8 text-center">
                <CheckCircle className="mx-auto h-12 w-12 text-gray-400" />
                <p className="mt-2 text-sm text-gray-600">暂无正确发现案例</p>
              </div>
            ) : (
              improvement.confirmedCases.map((caseItem, index) => (
                <div key={caseItem.vulnerabilityId || index} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded font-medium">
                          正确发现
                        </span>
                        <span className="font-medium text-gray-900">{caseItem.title}</span>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">
                        {caseItem.description}
                      </p>
                      {caseItem.filePath && (
                        <p className="text-xs text-gray-500 flex items-center gap-1">
                          <Code size={12} />
                          {caseItem.filePath}
                        </p>
                      )}
                      {caseItem.codeSnippetPreview && (
                        <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-x-auto max-h-32">
                          {caseItem.codeSnippetPreview}
                        </pre>
                      )}
                      <p className="text-xs text-gray-400 mt-2">
                        标记时间: {new Date(caseItem.markedAt).toLocaleString('zh-CN')}
                      </p>
                    </div>
                    <Link
                      href={`/dashboard/admin/vulnerabilities?id=${caseItem.vulnerabilityId}`}
                      className="ml-4 inline-flex items-center px-3 py-1.5 text-sm bg-green-100 text-green-800 rounded hover:bg-green-200"
                    >
                      <Bug size={14} className="mr-1" />
                      详情
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* LLM Analysis Result */}
      {analysis && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Sparkles size={20} className="text-purple-600" />
            LLM 分析结果
          </h2>

          {/* False Positive Patterns */}
          {analysis.falsePositivePatterns.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                <AlertTriangle size={16} className="text-red-500" />
                误报模式
              </h3>
              <ul className="list-disc list-inside text-sm text-gray-600 space-y-1 bg-red-50 p-3 rounded-lg">
                {analysis.falsePositivePatterns.map((pattern, i) => (
                  <li key={i}>{pattern}</li>
                ))}
              </ul>
            </div>
          )}

          {/* False Positive Causes */}
          {analysis.falsePositiveCauses.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-2">误报原因</h3>
              <ul className="list-disc list-inside text-sm text-gray-600 space-y-1 bg-gray-50 p-3 rounded-lg">
                {analysis.falsePositiveCauses.map((cause, i) => (
                  <li key={i}>{cause}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Confirmed Patterns */}
          {analysis.confirmedPatterns.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                <CheckCircle size={16} className="text-green-500" />
                正确发现模式
              </h3>
              <ul className="list-disc list-inside text-sm text-gray-600 space-y-1 bg-green-50 p-3 rounded-lg">
                {analysis.confirmedPatterns.map((pattern, i) => (
                  <li key={i}>{pattern}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Confirmed Strengths */}
          {analysis.confirmedStrengths.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-2">必须保留的规则</h3>
              <ul className="list-disc list-inside text-sm text-gray-600 space-y-1 bg-blue-50 p-3 rounded-lg">
                {analysis.confirmedStrengths.map((strength, i) => (
                  <li key={i}>{strength}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommendations */}
          {analysis.recommendations.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                <Target size={16} className="text-blue-500" />
                改进建议
              </h3>
              <div className="space-y-2">
                {analysis.recommendations.map((rec, i) => (
                  <div key={i} className="p-3 bg-indigo-50 rounded-lg border border-indigo-200">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 text-xs bg-indigo-100 text-indigo-700 rounded font-medium">
                        {getRecommendationTypeLabel(rec.type)}
                      </span>
                      <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                        {getImpactLabel(rec.impact)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700">{rec.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {analysis.warnings.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                <AlertTriangle size={16} className="text-yellow-500" />
                警告
              </h3>
              <ul className="list-disc list-inside text-sm text-yellow-700 space-y-1 bg-yellow-50 p-3 rounded-lg border border-yellow-200">
                {analysis.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Improved Skill Content Preview */}
      {improvement && improvement.improvedContent && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <FileText size={20} className="text-green-600" />
            改进后的 Skill 内容预览
          </h2>

          <div className="mb-4 flex items-center gap-2">
            <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(improvement.status)}`}>
              {improvement.status === 'pending' ? '待审批' :
               improvement.status === 'applied' ? '已应用' :
               improvement.status === 'rejected' ? '已拒绝' : improvement.status}
            </span>
            <span className="text-xs text-gray-500">
              创建时间: {new Date(improvement.createdAt).toLocaleString('zh-CN')}
            </span>
          </div>

          <button
            onClick={() => setShowDiffModal(true)}
            className="inline-flex items-center px-4 py-2 bg-indigo-100 text-indigo-800 rounded-lg hover:bg-indigo-200 transition-colors mb-4"
          >
            <GitCompare size={16} className="mr-2" />
            查看内容对比
          </button>

          {/* Quick preview of improved content */}
          <div className="border border-green-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-green-50 border-b border-green-200 flex items-center gap-2">
              <FileText size={16} className="text-green-600" />
              <span className="font-medium text-green-700">改进后内容（前 500 字符预览）</span>
            </div>
            <pre className="p-4 text-sm text-gray-700 overflow-auto max-h-32 whitespace-pre-wrap font-mono">
              {improvement.improvedContent.substring(0, 500)}
              {improvement.improvedContent.length > 500 && '\n... (内容已截断，点击上方按钮查看完整对比)'}
            </pre>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {improvement && improvement.status === 'pending' && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Zap size={20} className="text-yellow-600" />
            审批操作
          </h2>

          {/* Reject Reason Input */}
          {showRejectInput && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                拒绝原因 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                rows={3}
                placeholder="请填写拒绝此改进的原因..."
              />
            </div>
          )}

          <div className="flex items-center gap-4">
            <button
              onClick={handleApplyImprovement}
              disabled={submitting}
              className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="mr-2 animate-spin" />
                  处理中...
                </>
              ) : (
                <>
                  <CheckCircle size={16} className="mr-2" />
                  应用改进
                </>
              )}
            </button>

            {!showRejectInput ? (
              <button
                onClick={() => setShowRejectInput(true)}
                disabled={submitting}
                className="inline-flex items-center px-4 py-2 bg-red-100 text-red-800 rounded-lg hover:bg-red-200 disabled:opacity-50 transition-colors"
              >
                <XCircle size={16} className="mr-2" />
                拒绝改进
              </button>
            ) : (
              <>
                <button
                  onClick={handleRejectImprovement}
                  disabled={submitting || !rejectReason.trim()}
                  className="inline-flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={16} className="mr-2 animate-spin" />
                      处理中...
                    </>
                  ) : (
                    <>
                      <XCircle size={16} className="mr-2" />
                      确认拒绝
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowRejectInput(false);
                    setRejectReason('');
                  }}
                  disabled={submitting}
                  className="inline-flex items-center px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 transition-colors"
                >
                  取消
                </button>
              </>
            )}
          </div>

          <p className="mt-4 text-xs text-gray-500">
            应用改进将创建新的 Skill 版本，拒绝改进将保留当前版本不变。
          </p>
        </div>
      )}

      {/* Already Processed Status */}
      {improvement && improvement.status !== 'pending' && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center gap-3">
            {improvement.status === 'applied' ? (
              <>
                <CheckCircle size={24} className="text-green-600" />
                <div>
                  <h3 className="font-semibold text-green-700">改进已应用</h3>
                  <p className="text-sm text-gray-600">新版本已创建，Skill 内容已更新</p>
                </div>
              </>
            ) : (
              <>
                <XCircle size={24} className="text-red-600" />
                <div>
                  <h3 className="font-semibold text-red-700">改进已拒绝</h3>
                  <p className="text-sm text-gray-600">Skill 内容保持不变</p>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Diff Modal */}
      <DiffModal
        isOpen={showDiffModal}
        onClose={() => setShowDiffModal(false)}
        originalContent={improvement?.originalContent || ''}
        improvedContent={improvement?.improvedContent || ''}
        originalLabel={`原始内容 (v${skill.version})`}
        improvedLabel="改进后内容"
      />
    </div>
  );
}

// ============================================================================
// Page Component with AdminGuard
// ============================================================================

export default function EvolutionAnalysisPage() {
  return (
    <AdminGuard>
      <Suspense fallback={<LoadingSpinner />}>
        <EvolutionAnalysisContent />
      </Suspense>
    </AdminGuard>
  );
}