'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  BarChart3,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Lightbulb,
  FileText,
  GitCompare,
  Loader2,
  RefreshCw,
  Check,
  X,
  ChevronRight,
  TrendingUp,
  Shield,
  Bug,
  Info,
  AlertOctagon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageLoading, Alert, ConfirmDialog } from '@/components/ui';

// ============================================================================
// Types
// ============================================================================

interface SkillMetrics {
  skillId: string;
  precision: number;
  recall: number;
  f1Score: number;
  falsePositiveRate: number;
  confirmedCaseCount: number;
  falsePositiveCount: number;
  lastUpdated: string;
}

interface CaseItem {
  id: string;
  timestamp: string;
  context: string;
  reason?: string;
  severity?: string;
  title?: string;
  description?: string;
  filePath?: string;
  status?: string;
}

interface CasesData {
  skillId: string;
  falsePositives: CaseItem[];
  confirmedCases: CaseItem[];
  totalCases: number;
  lastExtracted: string;
}

interface Recommendation {
  type: 'add_rule' | 'modify_rule' | 'add_exception' | 'refine_pattern' | string;
  description: string;
  impact: 'reduce_false_positive' | 'maintain_detection' | 'both' | string;
  priority?: string;
}

interface AnalysisResult {
  skillId: string;
  falsePositivePatterns: string[];
  falsePositiveCauses: string[];
  confirmedPatterns: string[];
  confirmedStrengths: string[];
  recommendations: Recommendation[];
  warnings: string[];
  analyzedAt: string;
}

interface SkillContent {
  id: string;
  name: string;
  displayName?: string;
  content: string;
  version?: number;
}

interface GeneratedImprovement {
  improvementId: string;
  improvedContent: string;
  changeSummary: string[];
  warnings: string[];
}

// ============================================================================
// Main Component
// ============================================================================

export default function SkillEvolutionPage() {
  const params = useParams();
  const router = useRouter();
  const skillId = params.id as string;

  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skill, setSkill] = useState<SkillContent | null>(null);
  const [metrics, setMetrics] = useState<SkillMetrics | null>(null);
  const [cases, setCases] = useState<CasesData | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [improvement, setImprovement] = useState<GeneratedImprovement | null>(null);
  const [viewMode, setViewMode] = useState<'side-by-side' | 'inline'>('side-by-side');
  const [analyzing, setAnalyzing] = useState(false);
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [applying, setApplying] = useState(false);

  // Fetch initial data
  useEffect(() => {
    fetchAllData();
  }, [skillId]);

  const fetchAllData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const token = localStorage.getItem('token');
      if (!token) {
        router.push('/login');
        return;
      }

      // Fetch skill content
      const skillRes = await fetch(`/api/skills/${skillId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (skillRes.ok) {
        const skillData = await skillRes.json();
        setSkill(skillData.skill || null);
      }

      // Fetch metrics
      const metricsRes = await fetch(`/api/skills/${skillId}/metrics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (metricsRes.ok) {
        setMetrics(await metricsRes.json());
      }

      // Fetch cases
      const casesRes = await fetch(`/api/skills/${skillId}/cases`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (casesRes.ok) {
        setCases(await casesRes.json());
      }

      // Try to fetch existing analysis (if available)
      // Note: This endpoint may not exist yet, so we handle gracefully
      try {
        const analysisRes = await fetch(`/api/skills/${skillId}/analysis`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (analysisRes.ok) {
          setAnalysis(await analysisRes.json());
        }
      } catch {
        // Analysis endpoint may not exist
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const runAnalysis = async () => {
    try {
      setAnalyzing(true);
      setError(null);
      
      const token = localStorage.getItem('token');
      
      const response = await fetch(`/api/skills/${skillId}/analyze`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('分析请求失败');
      }

      const data = await response.json();
      setAnalysis(data);

      // Generate mock improvement preview based on analysis
      // In real implementation, this would come from improvement-generator service
      if (skill) {
        setImprovement({
          improvementId: `imp-${Date.now()}`,
          improvedContent: generateMockImprovedContent(skill.content, data),
          changeSummary: data.recommendations?.map((r: Recommendation) => r.description) || [],
          warnings: data.warnings || [],
        });
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : '分析失败');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleApply = async () => {
    try {
      setApplying(true);
      
      const token = localStorage.getItem('token');
      
      const response = await fetch(`/api/skills/${skillId}/evolve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recommendations: analysis?.recommendations || [],
          improvementId: improvement?.improvementId,
        }),
      });

      if (!response.ok) {
        throw new Error('应用改进失败');
      }

      // Success - navigate back to skill detail
      router.push(`/dashboard/skills/${skillId}`);

    } catch (err) {
      setError(err instanceof Error ? err.message : '应用失败');
    } finally {
      setApplying(false);
      setShowApplyConfirm(false);
    }
  };

  const handleReject = async () => {
    // In real implementation, this would save the rejection reason
    setShowRejectConfirm(false);
    setRejectReason('');
    router.push(`/dashboard/skills/${skillId}`);
  };

  // Mock improved content generator (for demo purposes)
  const generateMockImprovedContent = (original: string, analysisData: AnalysisResult): string => {
    if (!original) return '';
    
    // Add a mock "Common False Positive Exclusions" section
    const exclusionSection = `
## 常见误报排除

基于分析结果，以下情况应排除检测：

${analysisData.falsePositivePatterns?.map((p, i) => `${i + 1}. ${p}`).join('\n') || '暂无'}

### 排除规则
${analysisData.recommendations?.filter(r => r.type === 'add_exception').map((r, i) => `- ${r.description}`).join('\n') || '暂无'}
`;
    
    // Insert before the last section or at the end
    const lastSectionIndex = original.lastIndexOf('##');
    if (lastSectionIndex > 0) {
      return original.slice(0, lastSectionIndex) + exclusionSection + '\n\n' + original.slice(lastSectionIndex);
    }
    return original + '\n\n' + exclusionSection;
  };

  // Compute diff for inline view
  const computeDiff = useCallback((before: string, after: string) => {
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
  }, []);

  if (loading) {
    return <PageLoading text="加载进化分析数据..." />;
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href={`/dashboard/skills/${skillId}`}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} className="text-gray-600" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              进化分析
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              {skill?.displayName || skill?.name || 'Skill'} - 误报分析与改进建议
            </p>
          </div>
        </div>
        
        <button
          onClick={runAnalysis}
          disabled={analyzing}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors',
            analyzing
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-indigo-600 text-white hover:bg-indigo-700'
          )}
        >
          {analyzing ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <RefreshCw size={18} />
          )}
          {analyzing ? '分析中...' : '运行分析'}
        </button>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert type="error" dismissible onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Metrics Section */}
      {metrics && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <BarChart3 size={20} className="mr-2 text-indigo-500" />
            当前效果指标
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
            <MetricCard
              title="精确率"
              value={`${(metrics.precision * 100).toFixed(1)}%`}
              icon={<CheckCircle size={18} />}
              color="green"
            />
            <MetricCard
              title="召回率"
              value={`${(metrics.recall * 100).toFixed(1)}%`}
              icon={<TrendingUp size={18} />}
              color="blue"
            />
            <MetricCard
              title="F1 分数"
              value={`${(metrics.f1Score * 100).toFixed(1)}%`}
              icon={<BarChart3 size={18} />}
              color="purple"
            />
            <MetricCard
              title="误报率"
              value={`${(metrics.falsePositiveRate * 100).toFixed(1)}%`}
              icon={<AlertTriangle size={18} />}
              color="orange"
            />
            <MetricCard
              title="确认案例"
              value={metrics.confirmedCaseCount}
              icon={<Shield size={18} />}
              color="green"
            />
            <MetricCard
              title="误报案例"
              value={metrics.falsePositiveCount}
              icon={<XCircle size={18} />}
              color="red"
            />
            <MetricCard
              title="总案例"
              value={metrics.confirmedCaseCount + metrics.falsePositiveCount}
              icon={<Bug size={18} />}
              color="gray"
            />
          </div>
        </div>
      )}

      {/* Cases Section */}
      {cases && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* False Positives */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <XCircle size={20} className="mr-2 text-red-500" />
              误报案例 ({cases.falsePositives.length})
            </h2>
            {cases.falsePositives.length === 0 ? (
              <p className="text-gray-500 text-center py-8">暂无误报案例</p>
            ) : (
              <div className="space-y-3 max-h-[300px] overflow-y-auto">
                {cases.falsePositives.map((caseItem) => (
                  <CaseRow
                    key={caseItem.id}
                    caseItem={caseItem}
                    type="false_positive"
                  />
                ))}
              </div>
            )}
          </div>

          {/* Confirmed Cases */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <CheckCircle size={20} className="mr-2 text-green-500" />
              正确发现案例 ({cases.confirmedCases.length})
            </h2>
            {cases.confirmedCases.length === 0 ? (
              <p className="text-gray-500 text-center py-8">暂无正确发现案例</p>
            ) : (
              <div className="space-y-3 max-h-[300px] overflow-y-auto">
                {cases.confirmedCases.map((caseItem) => (
                  <CaseRow
                    key={caseItem.id}
                    caseItem={caseItem}
                    type="confirmed"
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Analysis Results Section */}
      {analysis && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Lightbulb size={20} className="mr-2 text-yellow-500" />
            LLM 分析结果
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* False Positive Patterns */}
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <h3 className="font-medium text-red-800 mb-2 flex items-center">
                  <AlertTriangle size={16} className="mr-2" />
                  误报模式
                </h3>
                {analysis.falsePositivePatterns.length === 0 ? (
                  <p className="text-red-600 text-sm">暂无识别的误报模式</p>
                ) : (
                  <ul className="space-y-2">
                    {analysis.falsePositivePatterns.map((pattern, i) => (
                      <li key={i} className="text-sm text-red-700 flex items-start">
                        <span className="mr-2">{i + 1}.</span>
                        {pattern}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <h3 className="font-medium text-orange-800 mb-2 flex items-center">
                  <Info size={16} className="mr-2" />
                  误报原因
                </h3>
                {analysis.falsePositiveCauses.length === 0 ? (
                  <p className="text-orange-600 text-sm">暂无分析</p>
                ) : (
                  <ul className="space-y-2">
                    {analysis.falsePositiveCauses.map((cause, i) => (
                      <li key={i} className="text-sm text-orange-700 flex items-start">
                        <span className="mr-2">{i + 1}.</span>
                        {cause}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Confirmed Patterns */}
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="font-medium text-green-800 mb-2 flex items-center">
                  <CheckCircle size={16} className="mr-2" />
                  正确发现模式
                </h3>
                {analysis.confirmedPatterns.length === 0 ? (
                  <p className="text-green-600 text-sm">暂无识别的正确发现模式</p>
                ) : (
                  <ul className="space-y-2">
                    {analysis.confirmedPatterns.map((pattern, i) => (
                      <li key={i} className="text-sm text-green-700 flex items-start">
                        <span className="mr-2">{i + 1}.</span>
                        {pattern}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-medium text-blue-800 mb-2 flex items-center">
                  <Shield size={16} className="mr-2" />
                  必须保留的规则
                </h3>
                {analysis.confirmedStrengths.length === 0 ? (
                  <p className="text-blue-600 text-sm">暂无分析</p>
                ) : (
                  <ul className="space-y-2">
                    {analysis.confirmedStrengths.map((strength, i) => (
                      <li key={i} className="text-sm text-blue-700 flex items-start">
                        <span className="mr-2">{i + 1}.</span>
                        {strength}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* Recommendations */}
          <div className="mt-6 bg-indigo-50 border border-indigo-200 rounded-lg p-4">
            <h3 className="font-medium text-indigo-800 mb-3 flex items-center">
              <Lightbulb size={16} className="mr-2" />
              改进建议 ({analysis.recommendations.length})
            </h3>
            {analysis.recommendations.length === 0 ? (
              <p className="text-indigo-600 text-sm">暂无改进建议</p>
            ) : (
              <div className="space-y-3">
                {analysis.recommendations.map((rec, i) => (
                  <RecommendationCard key={i} recommendation={rec} index={i} />
                ))}
              </div>
            )}
          </div>

          {/* Warnings */}
          {analysis.warnings.length > 0 && (
            <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <h3 className="font-medium text-yellow-800 mb-2 flex items-center">
                <AlertOctagon size={16} className="mr-2" />
                注意事项
              </h3>
              <ul className="space-y-2">
                {analysis.warnings.map((warning, i) => (
                  <li key={i} className="text-sm text-yellow-700 flex items-start">
                    <AlertTriangle size={14} className="mr-2 mt-0.5" />
                    {warning}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Diff Preview Section */}
      {improvement && skill && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
            <div className="flex items-center gap-3">
              <GitCompare size={20} className="text-indigo-600" />
              <h2 className="text-lg font-semibold text-gray-900">
                改进内容预览
              </h2>
            </div>
            
            {/* View Mode Toggle */}
            <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setViewMode('side-by-side')}
                className={cn(
                  'px-3 py-1 rounded text-sm transition-colors',
                  viewMode === 'side-by-side'
                    ? 'bg-white shadow text-gray-900'
                    : 'text-gray-600 hover:text-gray-900'
                )}
              >
                并排对比
              </button>
              <button
                onClick={() => setViewMode('inline')}
                className={cn(
                  'px-3 py-1 rounded text-sm transition-colors',
                  viewMode === 'inline'
                    ? 'bg-white shadow text-gray-900'
                    : 'text-gray-600 hover:text-gray-900'
                )}
              >
                内联对比
              </button>
            </div>
          </div>

          {/* Change Summary */}
          <div className="px-6 py-3 bg-indigo-50 border-b border-indigo-100">
            <h3 className="text-sm font-medium text-indigo-800 mb-2">变更摘要</h3>
            <ul className="space-y-1">
              {improvement.changeSummary.map((summary, i) => (
                <li key={i} className="text-sm text-indigo-700 flex items-center">
                  <ChevronRight size={14} className="mr-1" />
                  {summary}
                </li>
              ))}
            </ul>
            {improvement.warnings.length > 0 && (
              <div className="mt-2 pt-2 border-t border-indigo-200">
                <p className="text-xs text-indigo-600 font-medium">警告:</p>
                {improvement.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-indigo-500">{w}</p>
                ))}
              </div>
            )}
          </div>

          {/* Diff Content */}
          <div className="p-6">
            {viewMode === 'side-by-side' ? (
              <div className="grid grid-cols-2 gap-4">
                {/* Original */}
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-gray-100 border-b border-gray-200 flex items-center gap-2">
                    <FileText size={16} className="text-gray-500" />
                    <span className="font-medium text-gray-700">原始内容</span>
                  </div>
                  <pre className="p-4 text-sm text-gray-700 overflow-auto max-h-[400px] whitespace-pre-wrap font-mono bg-gray-50">
                    {skill.content || '暂无内容'}
                  </pre>
                </div>

                {/* Improved */}
                <div className="border border-green-200 rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-green-50 border-b border-green-200 flex items-center gap-2">
                    <FileText size={16} className="text-green-600" />
                    <span className="font-medium text-green-700">改进后内容</span>
                  </div>
                  <pre className="p-4 text-sm text-gray-700 overflow-auto max-h-[400px] whitespace-pre-wrap font-mono bg-green-50/30">
                    {improvement.improvedContent || '暂无内容'}
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
                  {computeDiff(skill.content, improvement.improvedContent).map((line, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        'flex items-stretch font-mono text-sm',
                        line.type === 'removed' ? 'bg-red-50' :
                        line.type === 'added' ? 'bg-green-50' :
                        line.type === 'modified' ? 'bg-yellow-50' :
                        ''
                      )}
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
        </div>
      )}

      {/* Action Buttons */}
      {analysis && improvement && (
        <div className="flex items-center justify-end gap-4 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <button
            onClick={() => setShowRejectConfirm(true)}
            className="flex items-center gap-2 px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <X size={18} />
            拒绝改进
          </button>
          <button
            onClick={() => setShowApplyConfirm(true)}
            disabled={applying}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors',
              applying
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-green-600 text-white hover:bg-green-700'
            )}
          >
            {applying ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Check size={18} />
            )}
            {applying ? '应用中...' : '应用改进'}
          </button>
        </div>
      )}

      {/* No Analysis State */}
      {!analysis && !analyzing && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <Lightbulb size={48} className="mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            尚未进行进化分析
          </h3>
          <p className="text-gray-600 mb-6">
            点击上方"运行分析"按钮，启动 LLM 分析误报和正确发现案例
          </p>
          <button
            onClick={runAnalysis}
            className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <RefreshCw size={18} />
            开始分析
          </button>
        </div>
      )}

      {/* Confirmation Dialogs */}
      <ConfirmDialog
        isOpen={showApplyConfirm}
        onClose={() => setShowApplyConfirm(false)}
        onConfirm={handleApply}
        title="应用改进建议"
        message="确定要应用此改进建议吗？改进后的 Skill 内容将替换当前版本。"
        confirmText="确认应用"
        variant="info"
        loading={applying}
      />

      <ConfirmDialog
        isOpen={showRejectConfirm}
        onClose={() => setShowRejectConfirm(false)}
        onConfirm={handleReject}
        title="拒绝改进建议"
        message="确定要拒绝此改进建议吗？拒绝后可以重新运行分析。"
        confirmText="确认拒绝"
        variant="warning"
      />
    </div>
  );
}

// ============================================================================
// Sub Components
// ============================================================================

function MetricCard({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: 'green' | 'blue' | 'purple' | 'orange' | 'red' | 'gray';
}) {
  const colorStyles = {
    green: 'bg-green-50 text-green-600 border-green-200',
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    purple: 'bg-purple-50 text-purple-600 border-purple-200',
    orange: 'bg-orange-50 text-orange-600 border-orange-200',
    red: 'bg-red-50 text-red-600 border-red-200',
    gray: 'bg-gray-50 text-gray-600 border-gray-200',
  };

  return (
    <div className={cn('rounded-lg border p-3', colorStyles[color])}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs font-medium opacity-80">{title}</span>
      </div>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}

function CaseRow({
  caseItem,
  type,
}: {
  caseItem: CaseItem;
  type: 'false_positive' | 'confirmed';
}) {
  const bgColor = type === 'false_positive' ? 'bg-red-50 hover:bg-red-100' : 'bg-green-50 hover:bg-green-100';
  const borderColor = type === 'false_positive' ? 'border-red-200' : 'border-green-200';
  const textColor = type === 'false_positive' ? 'text-red-700' : 'text-green-700';
  const statusBadge = type === 'false_positive' ? (
    <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded text-xs">误报</span>
  ) : (
    <span className="px-2 py-0.5 bg-green-100 text-green-600 rounded text-xs">已确认</span>
  );

  return (
    <Link
      href={`/vulnerabilities/${caseItem.id}`}
      className={cn(
        'block border rounded-lg p-3 transition-colors',
        bgColor,
        borderColor
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {statusBadge}
            <span className="text-xs text-gray-500">
              {new Date(caseItem.timestamp).toLocaleDateString()}
            </span>
          </div>
          <p className={cn('text-sm font-medium truncate', textColor)}>
            {caseItem.title || caseItem.context || '未命名案例'}
          </p>
          {caseItem.filePath && (
            <p className="text-xs text-gray-500 mt-1 truncate">
              {caseItem.filePath}
            </p>
          )}
        </div>
        <ChevronRight size={16} className="text-gray-400" />
      </div>
    </Link>
  );
}

function RecommendationCard({
  recommendation,
  index,
}: {
  recommendation: Recommendation;
  index: number;
}) {
  const typeLabels: Record<string, string> = {
    'add_rule': '添加规则',
    'modify_rule': '修改规则',
    'add_exception': '添加排除条件',
    'refine_pattern': '细化模式',
    'threshold_adjustment': '阈值调整',
    'rule_refinement': '规则优化',
  };

  const typeColors: Record<string, string> = {
    'add_rule': 'bg-green-100 text-green-700',
    'modify_rule': 'bg-blue-100 text-blue-700',
    'add_exception': 'bg-yellow-100 text-yellow-700',
    'refine_pattern': 'bg-purple-100 text-purple-700',
    'threshold_adjustment': 'bg-orange-100 text-orange-700',
    'rule_refinement': 'bg-indigo-100 text-indigo-700',
  };

  const impactLabels: Record<string, string> = {
    'reduce_false_positive': '减少误报',
    'maintain_detection': '保持检测',
    'both': '平衡改进',
  };

  const impactColors: Record<string, string> = {
    'reduce_false_positive': 'bg-red-50 text-red-600',
    'maintain_detection': 'bg-green-50 text-green-600',
    'both': 'bg-blue-50 text-blue-600',
  };

  return (
    <div className="bg-white border border-indigo-100 rounded-lg p-3">
      <div className="flex items-start gap-3">
        <span className="text-sm font-medium text-indigo-600 min-w-[24px]">
          #{index + 1}
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className={cn('px-2 py-0.5 rounded text-xs font-medium', typeColors[recommendation.type] || 'bg-gray-100 text-gray-700')}>
              {typeLabels[recommendation.type] || recommendation.type}
            </span>
            <span className={cn('px-2 py-0.5 rounded text-xs', impactColors[recommendation.impact] || 'bg-gray-50 text-gray-600')}>
              {impactLabels[recommendation.impact] || recommendation.impact}
            </span>
            {recommendation.priority && (
              <span className={cn(
                'px-2 py-0.5 rounded text-xs',
                recommendation.priority === 'high' ? 'bg-red-50 text-red-600' :
                recommendation.priority === 'medium' ? 'bg-yellow-50 text-yellow-600' :
                'bg-gray-50 text-gray-600'
              )}>
                {recommendation.priority === 'high' ? '高优先级' :
                 recommendation.priority === 'medium' ? '中优先级' : '低优先级'}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-700">{recommendation.description}</p>
        </div>
      </div>
    </div>
  );
}