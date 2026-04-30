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
  ChevronRight,
  ExternalLink,
  Zap,
  Shield,
  Bug,
  History,
  Layers,
  Database,
  Lightbulb,
  Play,
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
  location?: string;
  status: 'false-positive' | 'confirmed';
  falsePositiveReason?: string;
  markedAt: string;
}

interface BacktestDetailRow {
  caseId: string;
  caseTitle: string;
  caseType: '误报案例' | '正确发现案例';
  expectedAction: '不应报告' | '应报告';
  newSkillAction: '未报告' | '已报告';
  passed: boolean;
  reason: string;
  vulnerabilityId: string;
}

interface BacktestSummary {
  totalCases: number;
  falsePositiveFixed: number;
  falsePositiveRemaining: number;
  confirmedDetected: number;
  confirmedMissed: number;
  passedCount: number;
  failedCount: number;
  backtestPrecision: number;
  improvementScore: number;
}

interface BacktestResult {
  falsePositiveResults: Array<{
    case: CompactCase;
    newSkillReports: boolean;
    expected: 'not report';
    passed: boolean;
    reason?: string;
  }>;
  confirmedResults: Array<{
    case: CompactCase;
    newSkillReports: boolean;
    expected: 'report';
    passed: boolean;
    reason?: string;
  }>;
  summary: BacktestSummary;
  isSuccessful: boolean;
  recommendation: string;
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
}

interface ApiResponse {
  task: EvolutionTaskDetail;
  skill: SkillInfo;
  improvement: SkillImprovementDetail | null;
}

// ============================================================================
// Evolution Attempt Types
// ============================================================================

interface EvolutionAttemptSummary {
  id: string;
  taskId: string;
  attemptNumber: number;
  isPassed: boolean;
  status: string;
  falsePositiveExclusionRate: number;
  confirmedMissed: number;
  failureReason: string | null;
  createdAt: string;
}

interface EvolutionAttemptDetail {
  id: string;
  taskId: string;
  attemptNumber: number;
  falsePositiveCasesUsed: CompactCase[];
  confirmedCasesUsed: CompactCase[];
  falsePositivePatterns: string[];
  confirmedPatterns: string[];
  recommendations: BalanceAnalysisResult['recommendations'];
  improvedContent: string;
  changeSummary: string[];
  backtestSummary: BacktestSummary;
  backtestDetailRows: BacktestDetailRow[];
  falsePositiveExclusionRate: number;
  confirmedMissed: number;
  failureReason: string | null;
  missedCasesInfo: CompactCase[];
  remainingFalsePositive: CompactCase[];
  isPassed: boolean;
  status: string;
  createdAt: string;
}

type TabKey = 'overview' | 'cases' | 'analysis' | 'improvement' | 'history' | 'actions';

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

interface DiffLine {
  type: 'same' | 'added' | 'removed' | 'modified';
  oldLine?: string;
  newLine?: string;
  oldLineNum: number | null;
  newLineNum: number | null;
}

function computeLCSDiff(oldContent: string, newContent: string): DiffLine[] {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  
  const m = oldLines.length;
  const n = newLines.length;
  
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  const result: DiffLine[] = [];
  let i = m, j = n;
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({
        type: 'same',
        oldLine: oldLines[i - 1],
        newLine: newLines[j - 1],
        oldLineNum: i,
        newLineNum: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({
        type: 'added',
        newLine: newLines[j - 1],
        oldLineNum: null,
        newLineNum: j,
      });
      j--;
    } else if (i > 0) {
      result.unshift({
        type: 'removed',
        oldLine: oldLines[i - 1],
        oldLineNum: i,
        newLineNum: null,
      });
      i--;
    }
  }
  
  return result;
}

function DiffModal({
  isOpen,
  onClose,
  originalContent,
  improvedContent,
  originalLabel,
  improvedLabel,
}: DiffModalProps) {
  const [viewMode, setViewMode] = useState<'side-by-side' | 'inline' | 'diff-only'>('inline');
  const [showSameLines, setShowSameLines] = useState(true);
  
  const diffLines = computeLCSDiff(originalContent || '', improvedContent || '');
  
  const stats = {
    added: diffLines.filter(l => l.type === 'added').length,
    removed: diffLines.filter(l => l.type === 'removed').length,
    same: diffLines.filter(l => l.type === 'same').length,
  };
  
  const filteredLines = showSameLines ? diffLines : diffLines.filter(l => l.type !== 'same');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-7xl max-h-[90vh] overflow-hidden flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-4">
            <GitCompare size={20} className="text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">Skill 内容对比</h2>
            
            {/* Stats */}
            <div className="flex items-center gap-3 text-xs">
              <span className="px-2 py-1 bg-green-100 text-green-700 rounded">
                +{stats.added} 新增
              </span>
              <span className="px-2 py-1 bg-red-100 text-red-700 rounded">
                -{stats.removed} 删除
              </span>
              <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded">
                {stats.same} 相同
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Toggle same lines */}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={showSameLines}
                onChange={(e) => setShowSameLines(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300"
              />
              显示相同行
            </label>
            
            {/* View Mode Toggle */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
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
                onClick={() => setViewMode('diff-only')}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  viewMode === 'diff-only'
                    ? 'bg-white shadow text-gray-900'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                仅差异
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
        <div className="flex-1 overflow-auto">
          {viewMode === 'side-by-side' ? (
            <div className="overflow-auto max-h-[70vh]">
              {/* Sticky Headers */}
              <div className="grid grid-cols-2 gap-0 divide-x divide-gray-200 sticky top-0 z-10">
                <div className="px-4 py-2 bg-red-50 border-b border-red-200 flex items-center gap-2">
                  <FileText size={16} className="text-red-500" />
                  <span className="font-medium text-red-700">{originalLabel}</span>
                </div>
                <div className="px-4 py-2 bg-green-50 border-b border-green-200 flex items-center gap-2">
                  <FileText size={16} className="text-green-500" />
                  <span className="font-medium text-green-700">{improvedLabel}</span>
                </div>
              </div>
              {/* Content - each row spans both columns */}
              <div className="font-mono text-sm">
                {filteredLines.map((line, idx) => (
                  <div key={idx} className="grid grid-cols-2 gap-0 divide-x divide-gray-200">
                    {/* Original column */}
                    <div className={`flex ${
                      line.type === 'removed' ? 'bg-red-100' :
                      line.type === 'same' ? 'bg-white' :
                      'bg-gray-50'
                    }`}>
                      <span className={`px-2 py-1 text-xs select-none min-w-[50px] text-right ${
                        line.oldLineNum ? 'text-gray-400 bg-gray-100 border-r border-gray-200' : 'text-transparent'
                      }`}>
                        {line.oldLineNum || ''}
                      </span>
                      <span className={`px-3 py-1 flex-1 whitespace-pre ${
                        line.type === 'removed' ? 'text-red-700' :
                        line.type === 'same' ? 'text-gray-700' :
                        'text-gray-400 italic'
                      }`}>
                        {line.oldLine || (line.type === 'added' ? '' : '')}
                      </span>
                    </div>
                    {/* Improved column */}
                    <div className={`flex ${
                      line.type === 'added' ? 'bg-green-100' :
                      line.type === 'same' ? 'bg-white' :
                      'bg-gray-50'
                    }`}>
                      <span className={`px-2 py-1 text-xs select-none min-w-[50px] text-right ${
                        line.newLineNum ? 'text-gray-400 bg-gray-100 border-r border-gray-200' : 'text-transparent'
                      }`}>
                        {line.newLineNum || ''}
                      </span>
                      <span className={`px-3 py-1 flex-1 whitespace-pre ${
                        line.type === 'added' ? 'text-green-700' :
                        line.type === 'same' ? 'text-gray-700' :
                        'text-gray-400 italic'
                      }`}>
                        {line.newLine || (line.type === 'removed' ? '' : '')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : viewMode === 'inline' ? (
            <div className="p-4">
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-gray-100 border-b border-gray-200 flex items-center gap-3 text-xs sticky top-0">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 bg-red-200 rounded"></span>
                    删除 (-{stats.removed})
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 bg-green-200 rounded"></span>
                    新增 (+{stats.added})
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 bg-white border border-gray-300 rounded"></span>
                    相同 ({stats.same})
                  </span>
                  <span className="ml-auto text-gray-500">
                    总行数: {diffLines.length}
                  </span>
                </div>
                <div className="overflow-auto max-h-[60vh] font-mono text-sm">
                  {filteredLines.map((line, idx) => (
                    <div key={idx} className={`flex ${
                      line.type === 'removed' ? 'bg-red-100 border-l-4 border-red-500' :
                      line.type === 'added' ? 'bg-green-100 border-l-4 border-green-500' :
                      'bg-white'
                    }`}>
                      <span className="px-2 py-1 text-xs text-gray-400 bg-gray-50 min-w-[50px] text-right select-none border-r border-gray-200">
                        {line.oldLineNum || ''}
                      </span>
                      <span className="px-2 py-1 text-xs text-gray-400 bg-gray-50 min-w-[50px] text-right select-none border-r border-gray-200">
                        {line.newLineNum || ''}
                      </span>
                      <span className={`px-4 py-1 flex-1 whitespace-pre ${
                        line.type === 'removed' ? 'text-red-700' :
                        line.type === 'added' ? 'text-green-700' :
                        'text-gray-600'
                      }`}>
                        {line.type === 'removed' && <span className="text-red-500 font-bold mr-2">−</span>}
                        {line.type === 'added' && <span className="text-green-500 font-bold mr-2">+</span>}
                        {line.type === 'same' && <span className="text-gray-300 mr-2"> </span>}
                        {line.oldLine || line.newLine}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Diff-only view */
            <div className="p-4">
              <div className="border border-indigo-200 rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-200 flex items-center gap-2">
                  <Target size={16} className="text-indigo-500" />
                  <span className="font-medium text-indigo-700">仅显示差异内容（{stats.added + stats.removed} 处变更）</span>
                </div>
                <div className="overflow-auto max-h-[60vh] font-mono text-sm">
                  {diffLines.filter(l => l.type !== 'same').map((line, idx) => (
                    <div key={idx} className={`flex ${
                      line.type === 'removed' ? 'bg-red-50' : 'bg-green-50'
                    }`}>
                      <span className={`px-2 py-1 text-xs min-w-[60px] text-right select-none ${
                        line.type === 'removed' ? 'text-red-400 bg-red-100' : 'text-green-400 bg-green-100'
                      }`}>
                        {line.oldLineNum ? `L${line.oldLineNum}` : ''}
                        {line.newLineNum ? `L${line.newLineNum}` : ''}
                      </span>
                      <span className={`px-4 py-1 flex-1 whitespace-pre ${
                        line.type === 'removed' ? 'text-red-700 bg-red-100' : 'text-green-700 bg-green-100'
                      }`}>
                        {line.type === 'removed' && (
                          <span className="inline-flex items-center px-1 py-0.5 bg-red-200 text-red-800 rounded text-xs mr-2">
                            删除
                          </span>
                        )}
                        {line.type === 'added' && (
                          <span className="inline-flex items-center px-1 py-0.5 bg-green-200 text-green-800 rounded text-xs mr-2">
                            新增
                          </span>
                        )}
                        {line.oldLine || line.newLine}
                      </span>
                    </div>
                  ))}
                  {stats.added + stats.removed === 0 && (
                    <div className="p-8 text-center text-gray-500">
                      <CheckCircle size={32} className="mx-auto mb-2 text-green-500" />
                      <p>两个版本内容完全相同，无差异</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            使用 LCS（最长公共子序列）算法计算差异
          </div>
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
  const [skill, setSkill] = useState<SkillInfo | null>(null);
  const [improvement, setImprovement] = useState<SkillImprovementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  
  const [realtimeCases, setRealtimeCases] = useState<{
    falsePositives: CompactCase[];
    confirmedCases: CompactCase[];
  } | null>(null);
  
  // UI state - Tabs
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [expandedFalsePositives, setExpandedFalsePositives] = useState(false);
  const [expandedConfirmed, setExpandedConfirmed] = useState(false);
  const [expandedAnalysis, setExpandedAnalysis] = useState(true);
  const [expandedImprovementPlan, setExpandedImprovementPlan] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [expandedBacktest, setExpandedBacktest] = useState(false);
  
  // Evolution attempts state
  const [attempts, setAttempts] = useState<EvolutionAttemptSummary[]>([]);
  const [selectedAttempt, setSelectedAttempt] = useState<EvolutionAttemptDetail | null>(null);
  const [loadingAttempts, setLoadingAttempts] = useState(false);
  const [expandedAttemptDetail, setExpandedAttemptDetail] = useState(false);
  
  // Backtest state (for current run)
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [backtestDetailRows, setBacktestDetailRows] = useState<BacktestDetailRow[]>([]);

  useEffect(() => {
    fetchTaskDetail();
    fetchAttempts();
  }, [taskId]);

  const fetchTaskDetail = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const token = localStorage.getItem('token');
      
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
      setSkill(data.skill);
      setImprovement(data.improvement);
      
      if (data.task.status === 'analyzing' && data.skill?.id && !data.improvement?.falsePositiveCases?.length) {
        fetchRealtimeCases(data.skill.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
      toast.error(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchRealtimeCases = async (skillId: string) => {
    try {
      const token = localStorage.getItem('token');
      
      const response = await fetch(`/api/skills/${skillId}/cases`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setRealtimeCases({
          falsePositives: data.falsePositives || [],
          confirmedCases: data.confirmedCases || [],
        });
      }
    } catch (err) {
      console.error('Failed to fetch realtime cases:', err);
    }
  };

  const fetchAttempts = async () => {
    try {
      setLoadingAttempts(true);
      const token = localStorage.getItem('token');
      
      const response = await fetch(`/api/skills/evolution/tasks/${taskId}/attempts`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setAttempts(data.attempts || []);
      }
    } catch (err) {
      console.error('Failed to fetch attempts:', err);
    } finally {
      setLoadingAttempts(false);
    }
  };

  const fetchAttemptDetail = async (attemptId: string) => {
    try {
      const token = localStorage.getItem('token');
      
      const response = await fetch(`/api/skills/evolution/tasks/${taskId}/attempts/${attemptId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setSelectedAttempt(data.attempt);
        setExpandedAttemptDetail(true);
      }
    } catch (err) {
      toast.error('获取尝试详情失败');
    }
  };

  const handleApplyImprovement = async () => {
    if (!improvement) {
      toast.error('没有可应用的改进');
      return;
    }

    if (!confirm('确定要应用此改进吗？这将创建新的 Skill 版本。')) {
      return;
    }

    try {
      setSubmitting(true);
      const token = localStorage.getItem('token');
      
      const response = await fetch(`/api/skills/${task?.skillId}/evolve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          improvementId: improvement.id,
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
    if (!improvement) {
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
      
      const response = await fetch(`/api/skills/${task?.skillId}/evolve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          improvementId: improvement.id,
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

  const handleRunBacktest = async () => {
    if (!improvement?.improvedContent) {
      toast.error('没有改进内容可供回测');
      return;
    }

    try {
      setBacktestLoading(true);
      const token = localStorage.getItem('token');
      
      const response = await fetch(`/api/skills/evolution/tasks/${taskId}/backtest`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '回测验证失败');
      }

      const data = await response.json();
      setBacktestResult(data.backtestResult);
      setBacktestDetailRows(data.detailRows);
      setExpandedBacktest(true);
      toast.success('回测验证完成');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '回测验证失败');
    } finally {
      setBacktestLoading(false);
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
            {skill?.displayName || 'N/A'} - {getTriggerReasonLabel(task.triggerReason)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {skill && (
            <Link
              href={`/dashboard/skills/${skill.id}`}
              className="inline-flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <ExternalLink size={16} className="mr-2" />
              Skill 详情
            </Link>
          )}
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
      {skill && (
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
      )}

      {/* Tab Navigation */}
      <div className="bg-white rounded-lg shadow border border-gray-200">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px">
            {[
              { key: 'overview', label: '概览', icon: BarChart3 },
              { key: 'cases', label: '案例', icon: Database },
              { key: 'analysis', label: '分析', icon: Sparkles },
              { key: 'improvement', label: '改进', icon: FileText },
              { key: 'history', label: '尝试历史', icon: History },
              { key: 'actions', label: '操作', icon: Zap },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as TabKey)}
                className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-blue-500 text-blue-600 bg-blue-50/50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <tab.icon size={16} />
                {tab.label}
                {tab.key === 'history' && attempts.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                    {attempts.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Evolution Steps Card */}
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 bg-cyan-50 border-b border-cyan-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-5 w-5 text-cyan-600" />
                    <h2 className="text-lg font-semibold text-gray-900">进化执行步骤</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-cyan-600 bg-cyan-100/50 px-2 py-1 rounded">
                      漏洞记录 → 案例筛选 → LLM分析 → Skill修改
                    </span>
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      task.status === 'completed' ? 'bg-green-100 text-green-800' :
                      task.status === 'analyzing' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {task.status === 'completed' ? '已完成' : task.status === 'analyzing' ? '分析中' : '待处理'}
                    </span>
                  </div>
                </div>
                
                <div className="p-4">
                  {/* Step 1: Get Cases */}
                  <div className="flex items-start gap-4 mb-4">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                      task.status === 'completed' || task.status === 'analyzing' 
                        ? 'bg-green-100 text-green-600' 
                        : 'bg-gray-100 text-gray-400'
                    }`}>
                      1
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-sm font-medium text-gray-900">
                          提取历史案例（从漏洞记录中筛选误报和正确发现）
                        </h3>
                        {(task.status === 'completed' || task.status === 'analyzing') && (
                          <CheckCircle size={16} className="text-green-600" />
                        )}
                      </div>
                      <div className="bg-gray-50 p-3 rounded-lg text-xs">
                        <div className="flex items-center gap-4">
                          <div>
                            <p className="text-gray-500 mb-1">数据来源</p>
                            <p className="text-gray-700">Skill 执行记录 → 漏洞表</p>
                          </div>
                          <div className="text-gray-400">→</div>
                          <div>
                            <p className="text-gray-500 mb-1">筛选结果</p>
                            <p className="text-gray-700">
                              误报案例: {realtimeCases?.falsePositives?.length || improvement?.falsePositiveCases?.length || 0} 个
                              <br />
                              正确发现: {realtimeCases?.confirmedCases?.length || improvement?.confirmedCases?.length || 0} 个
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Step 2: Balance Analysis */}
                  <div className="flex items-start gap-4 mb-4">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                      task.status === 'completed' || task.status === 'analyzing'
                        ? 'bg-green-100 text-green-600'
                        : 'bg-gray-100 text-gray-400'
                    }`}>
                      2
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-sm font-medium text-gray-900">
                          LLM 分析案例（归纳误报原因和正确发现模式）
                        </h3>
                        {task.status === 'completed' && (
                          <CheckCircle size={16} className="text-green-600" />
                        )}
                        {task.status === 'analyzing' && (
                          <Loader2 size={16} className="text-yellow-600 animate-spin" />
                        )}
                      </div>
                      <div className="bg-gray-50 p-3 rounded-lg text-xs">
                        <div className="flex items-center gap-4">
                          <div>
                            <p className="text-gray-500 mb-1">输入数据</p>
                            <p className="text-gray-700">
                              Skill 内容 + 案例数据
                            </p>
                          </div>
                          <div className="text-gray-400">→</div>
                          <div>
                            <p className="text-gray-500 mb-1">分析结果</p>
                            <p className="text-gray-700">
                              误报模式: {analysis?.falsePositivePatterns?.length || 0} 个
                              <br />
                              正确发现模式: {analysis?.confirmedPatterns?.length || 0} 个
                              <br />
                              改进建议: {analysis?.recommendations?.length || 0} 条
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Step 3: Generate Improvement */}
                  <div className="flex items-start gap-4">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                      task.status === 'completed'
                        ? 'bg-green-100 text-green-600'
                        : task.status === 'analyzing'
                        ? 'bg-yellow-100 text-yellow-600'
                        : 'bg-gray-100 text-gray-400'
                    }`}>
                      3
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-sm font-medium text-gray-900">
                          LLM 生成改进内容（根据分析建议修改 Skill）
                        </h3>
                        {task.status === 'completed' && (
                          <CheckCircle size={16} className="text-green-600" />
                        )}
                        {task.status === 'analyzing' && (
                          <Loader2 size={16} className="text-yellow-600 animate-spin" />
                        )}
                      </div>
                      <div className="bg-gray-50 p-3 rounded-lg text-xs">
                        <div className="flex items-center gap-4">
                          <div>
                            <p className="text-gray-500 mb-1">输入数据</p>
                            <p className="text-gray-700">
                              分析结果 + 原始 Skill
                              <br />
                              + 改进建议
                            </p>
                          </div>
                          <div className="text-gray-400">→</div>
                          <div>
                            <p className="text-gray-500 mb-1">输出结果</p>
                            <p className="text-gray-700">
                              {improvement?.improvedContent 
                                ? `改进后内容 (${improvement.improvedContent.length} 字符)`
                                : '待生成'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">进化前精准率</span>
                      <span className={`font-medium ${
                        (task.precisionBefore ?? 0) >= 0.7 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {formatPrecision(task.precisionBefore)}
                      </span>
                    </div>
                  </div>
                </div>
</div>
            </div>
          )}

          {/* Cases Tab */}
      {activeTab === 'cases' && (
        <div className="space-y-6">
          {/* False Positive Cases */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-red-50 border-b border-red-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-600" />
                <h2 className="text-lg font-semibold text-gray-900">误报案例</h2>
                <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded-full">
                  {realtimeCases?.falsePositives?.length || improvement?.falsePositiveCases?.length || 0} 个
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
                {(() => {
                  const fpCases = realtimeCases?.falsePositives || improvement?.falsePositiveCases || [];
                  if (fpCases.length === 0) {
                    return (
                      <div className="p-8 text-center">
                        <XCircle className="mx-auto h-12 w-12 text-gray-400" />
                        <p className="mt-2 text-sm text-gray-600">暂无误报案例</p>
                      </div>
                    );
                  }
                  return fpCases.map((caseItem, index) => (
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
                          {caseItem.location && (
                            <pre className="text-xs text-gray-500 p-2 bg-gray-100 rounded overflow-x-auto max-h-32">
                              {caseItem.location}
                            </pre>
                          )}
                          {caseItem.falsePositiveReason && (
                            <p className="text-xs text-orange-600 mt-2 flex items-center gap-1">
                              <AlertTriangle size={12} />
                              误报原因: {caseItem.falsePositiveReason}
                            </p>
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
                  ));
                })()}
              </div>
            )}
          </div>

          {/* Confirmed Cases */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-green-50 border-b border-green-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <h2 className="text-lg font-semibold text-gray-900">正确发现案例</h2>
                <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full">
                  {realtimeCases?.confirmedCases?.length || improvement?.confirmedCases?.length || 0} 个
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
                {(() => {
                  const ccCases = realtimeCases?.confirmedCases || improvement?.confirmedCases || [];
                  if (ccCases.length === 0) {
                    return (
                      <div className="p-8 text-center">
                        <CheckCircle className="mx-auto h-12 w-12 text-gray-400" />
                        <p className="mt-2 text-sm text-gray-600">暂无正确发现案例</p>
                      </div>
                    );
                  }
                  return ccCases.map((caseItem, index) => (
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
                          {caseItem.location && (
                            <pre className="text-xs text-gray-500 p-2 bg-gray-100 rounded overflow-x-auto max-h-32">
                              {caseItem.location}
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
                  ));
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Analysis Tab */}
      {activeTab === 'analysis' && analysis && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-purple-50 border-b border-purple-200 flex items-center gap-2">
            <Sparkles size={20} className="text-purple-600" />
            <h2 className="text-lg font-semibold text-gray-900">LLM 分析结果</h2>
          </div>
          
          <div className="p-6">
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
        </div>
      )}

      {/* Improvement Tab */}
      {activeTab === 'improvement' && (
        <div className="space-y-6">
          {/* Improved Skill Content */}
          {improvement && improvement.improvedContent && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 bg-green-50 border-b border-green-200 flex items-center gap-2">
                <FileText size={20} className="text-green-600" />
                <h2 className="text-lg font-semibold text-gray-900">改进方案</h2>
                <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(improvement.status)}`}>
                  {improvement.status === 'pending' ? '待审批' :
                   improvement.status === 'applied' ? '已应用' :
                   improvement.status === 'rejected' ? '已拒绝' : improvement.status}
                </span>
              </div>
              
              <div className="p-6">
                <div className="mb-4 flex items-center gap-2">
                  <span className="text-xs text-gray-500">
                    创建时间: {new Date(improvement.createdAt).toLocaleString('zh-CN')}
                  </span>
                  <span className="text-xs text-gray-400">
                    内容长度: {improvement.improvedContent.length} 字符
                  </span>
                </div>

                <button
                  onClick={() => setShowDiffModal(true)}
                  className="inline-flex items-center px-4 py-2 bg-indigo-100 text-indigo-800 rounded-lg hover:bg-indigo-200 transition-colors mb-4"
                >
                  <GitCompare size={16} className="mr-2" />
                  查看内容对比
                </button>

                <div className="border border-green-200 rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-green-50 border-b border-green-200 flex items-center gap-2">
                    <FileText size={16} className="text-green-600" />
                    <span className="font-medium text-green-700">改进后内容（完整）</span>
                  </div>
                  <pre className="p-4 text-sm text-gray-700 overflow-auto max-h-[600px] whitespace-pre-wrap font-mono">
                    {improvement.improvedContent}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* Backtest Validation */}
          {improvement && improvement.status === 'pending' && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 bg-purple-50 border-b border-purple-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-purple-600" />
                  <h2 className="text-lg font-semibold text-gray-900">回测验证</h2>
                  {backtestResult && (
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      backtestResult.isSuccessful ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {backtestResult.isSuccessful ? '验证成功' : '验证失败'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRunBacktest}
                    disabled={backtestLoading}
                    className="inline-flex items-center px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors text-sm"
                  >
                    {backtestLoading ? (
                      <>
                        <Loader2 size={14} className="mr-2 animate-spin" />
                        正在验证...
                      </>
                    ) : (
                      <>
                        <RefreshCw size={14} className="mr-2" />
                        运行回测
                      </>
                    )}
                  </button>
                  {backtestResult && (
                    <button
                      onClick={() => setExpandedBacktest(!expandedBacktest)}
                      className="p-1 hover:bg-purple-100 rounded transition-colors"
                    >
                      {expandedBacktest ? (
                        <ChevronUp size={20} className="text-purple-600" />
                      ) : (
                        <ChevronDown size={20} className="text-purple-600" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              {backtestResult && expandedBacktest && (
                <div className="p-4">
                  {/* Summary */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs text-gray-500">总案例数</p>
                      <p className="text-lg font-semibold text-gray-900">{backtestResult.summary.totalCases}</p>
                    </div>
                    <div className="p-3 bg-green-50 rounded-lg">
                      <p className="text-xs text-gray-500">通过数</p>
                      <p className="text-lg font-semibold text-green-600">{backtestResult.summary.passedCount}</p>
                    </div>
                    <div className="p-3 bg-red-50 rounded-lg">
                      <p className="text-xs text-gray-500">失败数</p>
                      <p className="text-lg font-semibold text-red-600">{backtestResult.summary.failedCount}</p>
                    </div>
                    <div className="p-3 bg-blue-50 rounded-lg">
                      <p className="text-xs text-gray-500">回测精准率</p>
                      <p className="text-lg font-semibold text-blue-600">
                        {(backtestResult.summary.backtestPrecision * 100).toFixed(1)}%
                      </p>
                    </div>
                  </div>

                  {/* Detailed metrics */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                      <p className="text-xs text-gray-500">误报已修复</p>
                      <p className="text-lg font-semibold text-green-600">{backtestResult.summary.falsePositiveFixed}</p>
                    </div>
                    <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                      <p className="text-xs text-gray-500">误报仍存在</p>
                      <p className="text-lg font-semibold text-red-600">{backtestResult.summary.falsePositiveRemaining}</p>
                    </div>
                    <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                      <p className="text-xs text-gray-500">正确发现已检出</p>
                      <p className="text-lg font-semibold text-green-600">{backtestResult.summary.confirmedDetected}</p>
                    </div>
                    <div className="p-3 bg-orange-50 rounded-lg border border-orange-200">
                      <p className="text-xs text-gray-500">正确发现漏检</p>
                      <p className="text-lg font-semibold text-orange-600">{backtestResult.summary.confirmedMissed}</p>
                    </div>
                  </div>

                  {/* Improvement Score */}
                  <div className="mb-6 p-3 bg-indigo-50 rounded-lg border border-indigo-200">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-indigo-700">改进分数</span>
                      <span className={`text-lg font-semibold ${
                        backtestResult.summary.improvementScore >= 0.7 ? 'text-green-600' : 
                        backtestResult.summary.improvementScore >= 0.5 ? 'text-yellow-600' : 'text-red-600'
                      }`}>
                        {(backtestResult.summary.improvementScore * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  {/* Recommendation */}
                  <div className={`p-4 rounded-lg mb-6 ${
                    backtestResult.isSuccessful ? 'bg-green-50 border border-green-200' : 'bg-orange-50 border border-orange-200'
                  }`}>
                    <div className="flex items-start gap-2">
                      {backtestResult.isSuccessful ? (
                        <CheckCircle size={18} className="text-green-600 mt-0.5" />
                      ) : (
                        <AlertTriangle size={18} className="text-orange-600 mt-0.5" />
                      )}
                      <p className={`text-sm ${backtestResult.isSuccessful ? 'text-green-700' : 'text-orange-700'}`}>
                        {backtestResult.recommendation}
                      </p>
                    </div>
                  </div>

                  {/* Detailed Cases Table */}
                  {backtestDetailRows.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                        <Target size={16} className="text-purple-500" />
                        详细案例验证结果
                      </h3>
                      <div className="mb-2 text-xs text-gray-500 bg-gray-50 p-2 rounded">
                        <span className="font-medium">验证目标：</span>
                        <span className="text-green-600 mx-1">确认是漏洞→仍能扫描出来 ✓</span>
                        <span className="text-red-600 mx-1">误报（非漏洞）→不再报告 ✓</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">案例标题</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">人工判定</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">新版本预期</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">新版本实际</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">结果</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">LLM判断原因</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {backtestDetailRows.map((row, idx) => (
                              <tr key={idx} className={row.passed ? 'bg-green-50/30' : 'bg-red-50/30'}>
                                <td className="px-3 py-2 text-sm text-gray-900">{row.caseTitle}</td>
                                <td className="px-3 py-2">
                                  <span className={`px-2 py-0.5 text-xs rounded ${
                                    row.caseType === '误报案例' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                                  }`}>
                                    {row.caseType === '误报案例' ? '确认非漏洞（误报）' : '确认是漏洞'}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-600">{row.expectedAction}</td>
                                <td className="px-3 py-2">
                                  <span className={`px-2 py-0.5 text-xs rounded ${
                                    row.newSkillAction === '已报告' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-700'
                                  }`}>
                                    {row.newSkillAction}
                                  </span>
                                </td>
                                <td className="px-3 py-2">
                                  {row.passed ? (
                                    <span className="inline-flex items-center gap-1 text-green-600">
                                      <CheckCircle size={14} />
                                      {row.caseType === '误报案例' ? '不再报告' : '仍能检出'}
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-red-600">
                                      <XCircle size={14} />
                                      {row.caseType === '误报案例' ? '仍报告(失败)' : '漏检(失败)'}
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-sm text-gray-600 max-w-xs truncate">{row.reason}</td>
                                <td className="px-3 py-2">
                                  <Link
                                    href={`/dashboard/admin/vulnerabilities?id=${row.vulnerabilityId}`}
                                    className="inline-flex items-center px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                                  >
                                    <ExternalLink size={12} className="mr-1" />
                                    详情
                                  </Link>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!backtestResult && !backtestLoading && (
                <div className="p-8 text-center">
                  <Shield className="mx-auto h-12 w-12 text-gray-400" />
                  <p className="mt-2 text-sm text-gray-600">点击"运行回测"验证改进效果</p>
                  <p className="mt-1 text-xs text-gray-400">回测将使用新 Skill 内容分析历史案例，验证改进是否有效</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* History Tab - Evolution Attempts */}
      {activeTab === 'history' && (
        <div className="space-y-6">
          {loadingAttempts ? (
            <div className="p-8 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-gray-400" />
              <p className="mt-2 text-sm text-gray-600">加载尝试历史...</p>
            </div>
          ) : attempts.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
              <History className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2 text-sm text-gray-600">暂无进化尝试记录</p>
              <p className="mt-1 text-xs text-gray-400">任务开始后将记录每次尝试的过程和结果</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <History size={20} className="text-gray-600" />
                  进化尝试历史
                  <span className="px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded-full">
                    共 {attempts.length} 次
                  </span>
                </h2>
              </div>
              
              <div className="divide-y divide-gray-200">
                {attempts.map((attempt) => (
                  <div 
                    key={attempt.id} 
                    className="p-4 hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => fetchAttemptDetail(attempt.id)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${
                          attempt.isPassed 
                            ? 'bg-green-100 text-green-600' 
                            : 'bg-red-100 text-red-600'
                        }`}>
                          #{attempt.attemptNumber}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 text-xs rounded ${
                              attempt.isPassed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}>
                              {attempt.isPassed ? '达标' : '未达标'}
                            </span>
                            <span className="text-sm font-medium text-gray-900">
                              排除率: {(attempt.falsePositiveExclusionRate * 100).toFixed(1)}%
                            </span>
                            <span className="text-sm text-gray-600">
                              漏检: {attempt.confirmedMissed} 个
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            {new Date(attempt.createdAt).toLocaleString('zh-CN')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button className="p-1 hover:bg-gray-200 rounded">
                          <ChevronRight size={16} className="text-gray-400" />
                        </button>
                      </div>
                    </div>
                    {attempt.failureReason && !attempt.isPassed && (
                      <div className="mt-3 ml-14 p-2 bg-red-50 rounded border border-red-200">
                        <p className="text-xs text-red-700">
                          <span className="font-medium">失败原因：</span>{attempt.failureReason}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Selected Attempt Detail */}
          {selectedAttempt && expandedAttemptDetail && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers size={20} className="text-indigo-600" />
                  <h2 className="text-lg font-semibold text-gray-900">
                    尝试 #{selectedAttempt.attemptNumber} 详情
                  </h2>
                </div>
                <button
                  onClick={() => setExpandedAttemptDetail(false)}
                  className="p-1 hover:bg-indigo-100 rounded transition-colors"
                >
                  <ChevronUp size={20} className="text-indigo-600" />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                {/* Summary */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500">状态</p>
                    <p className={`text-lg font-semibold ${selectedAttempt.isPassed ? 'text-green-600' : 'text-red-600'}`}>
                      {selectedAttempt.isPassed ? '达标' : '未达标'}
                    </p>
                  </div>
                  <div className="p-3 bg-green-50 rounded-lg">
                    <p className="text-xs text-gray-500">误报排除率</p>
                    <p className={`text-lg font-semibold ${
                      selectedAttempt.falsePositiveExclusionRate >= 0.5 ? 'text-green-600' : 'text-yellow-600'
                    }`}>
                      {(selectedAttempt.falsePositiveExclusionRate * 100).toFixed(1)}%
                    </p>
                  </div>
                  <div className="p-3 bg-orange-50 rounded-lg">
                    <p className="text-xs text-gray-500">漏检数</p>
                    <p className={`text-lg font-semibold ${
                      selectedAttempt.confirmedMissed === 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {selectedAttempt.confirmedMissed}
                    </p>
                  </div>
                  <div className="p-3 bg-blue-50 rounded-lg">
                    <p className="text-xs text-gray-500">回测通过率</p>
                    <p className="text-lg font-semibold text-blue-600">
                      {selectedAttempt.backtestSummary ? 
                        `${((selectedAttempt.backtestSummary.passedCount / selectedAttempt.backtestSummary.totalCases) * 100).toFixed(1)}%` 
                        : 'N/A'}
                    </p>
                  </div>
                </div>

                {/* Failure Reason */}
                {selectedAttempt.failureReason && (
                  <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={18} className="text-red-600 mt-0.5" />
                      <div>
                        <h3 className="text-sm font-medium text-red-700">失败原因</h3>
                        <p className="text-sm text-red-600 mt-1">{selectedAttempt.failureReason}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Cases Used */}
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                    <Database size={16} className="text-gray-500" />
                    使用的案例集
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                      <p className="text-xs text-gray-500 mb-2">误报案例 ({selectedAttempt.falsePositiveCasesUsed?.length || 0} 个)</p>
                      <div className="space-y-1">
                        {selectedAttempt.falsePositiveCasesUsed?.slice(0, 5).map((c, i) => (
                          <p key={i} className="text-xs text-gray-700 truncate">{c.title}</p>
                        ))}
                        {selectedAttempt.falsePositiveCasesUsed?.length > 5 && (
                          <p className="text-xs text-gray-400">... 还有 {selectedAttempt.falsePositiveCasesUsed.length - 5} 个</p>
                        )}
                      </div>
                    </div>
                    <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                      <p className="text-xs text-gray-500 mb-2">正确发现案例 ({selectedAttempt.confirmedCasesUsed?.length || 0} 个)</p>
                      <div className="space-y-1">
                        {selectedAttempt.confirmedCasesUsed?.slice(0, 5).map((c, i) => (
                          <p key={i} className="text-xs text-gray-700 truncate">{c.title}</p>
                        ))}
                        {selectedAttempt.confirmedCasesUsed?.length > 5 && (
                          <p className="text-xs text-gray-400">... 还有 {selectedAttempt.confirmedCasesUsed.length - 5} 个</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Missed Cases Info */}
                {selectedAttempt.missedCasesInfo && selectedAttempt.missedCasesInfo.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-red-700 mb-3 flex items-center gap-2">
                      <XCircle size={16} className="text-red-500" />
                      漏检案例详情
                    </h3>
                    <div className="space-y-2">
                      {selectedAttempt.missedCasesInfo.map((c, i) => (
                        <div key={i} className="p-3 bg-red-50 rounded-lg border border-red-200">
                          <p className="text-sm font-medium text-red-700">{c.title}</p>
                          <p className="text-xs text-red-600 mt-1">{c.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Remaining False Positives */}
                {selectedAttempt.remainingFalsePositive && selectedAttempt.remainingFalsePositive.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-orange-700 mb-3 flex items-center gap-2">
                      <AlertTriangle size={16} className="text-orange-500" />
                      未排除的误报案例
                    </h3>
                    <div className="space-y-2">
                      {selectedAttempt.remainingFalsePositive.slice(0, 5).map((c, i) => (
                        <div key={i} className="p-3 bg-orange-50 rounded-lg border border-orange-200">
                          <p className="text-sm font-medium text-orange-700">{c.title}</p>
                          <p className="text-xs text-orange-600 mt-1">{c.description}</p>
                        </div>
                      ))}
                      {selectedAttempt.remainingFalsePositive.length > 5 && (
                        <p className="text-xs text-gray-400">... 还有 {selectedAttempt.remainingFalsePositive.length - 5} 个</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Improved Content Preview */}
                {selectedAttempt.improvedContent && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                      <FileText size={16} className="text-gray-500" />
                      生成的改进内容（完整）
                    </h3>
                    <pre className="p-3 bg-gray-100 rounded-lg text-xs overflow-x-auto max-h-[400px] whitespace-pre-wrap">
                      {selectedAttempt.improvedContent}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Actions Tab */}
      {activeTab === 'actions' && (
        <div className="space-y-6">
          {improvement && improvement.status === 'pending' && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Zap size={20} className="text-yellow-600" />
                审批操作
              </h2>

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

          {improvement && improvement.status !== 'pending' && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
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

          {!improvement && (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
              <Clock className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2 text-sm text-gray-600">改进方案尚未生成</p>
              <p className="mt-1 text-xs text-gray-400">等待任务完成后可进行审批操作</p>
            </div>
          )}
        </div>
      )}
        </div>
      </div>

      {/* Diff Modal */}
      <DiffModal
        isOpen={showDiffModal}
        onClose={() => setShowDiffModal(false)}
        originalContent={skill?.content || ''}
        improvedContent={improvement?.improvedContent || ''}
        originalLabel={`原始内容 (v${skill?.version || 1})`}
        improvedLabel="改进后内容"
      />
    </div>
  );
}

export default function EvolutionAnalysisPage() {
  return (
    <AdminGuard>
      <Suspense fallback={<LoadingSpinner />}>
        <EvolutionAnalysisContent />
      </Suspense>
    </AdminGuard>
  );
}