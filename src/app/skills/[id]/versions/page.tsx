'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  History,
  TrendingUp,
  TrendingDown,
  RotateCcw,
  GitCompare,
  CheckCircle,
  Loader2,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  ChevronLeft,
  Target,
  AlertCircle,
  Minus,
} from 'lucide-react';

// Types
interface SkillEvolution {
  skillId: string;
  changeDesc: string;
  reason: string;
  changeType: string;
  fromVersion: number;
  toVersion: number;
  beforeRate: number | null;
  afterRate: number | null;
}

interface SkillVersion {
  id: string;
  version: number;
  isLatest: boolean;
  createdAt: string;
  displayName: string;
  description: string;
  severity: string | null;
  evolution: SkillEvolution | null;
  successRate?: number | null;
}

interface VersionMetrics {
  precision: number;
  recall: number;
  falsePositiveRate: number;
  confirmedCount: number;
  falsePositiveCount: number;
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

export default function SkillVersionsPage() {
  const router = useRouter();
  const [skillId, setSkillId] = useState<string>('');
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  const [skillInfo, setSkillInfo] = useState<{ displayName: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Comparison state
  const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);
  const [comparing, setComparing] = useState(false);

  // Rollback state
  const [rollbackModal, setRollbackModal] = useState<{
    isOpen: boolean;
    targetVersionId: string;
    targetVersionNumber: number;
  } | null>(null);
  const [rollbackReason, setRollbackReason] = useState('');
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);

  // Get skillId from URL
  useEffect(() => {
    const path = window.location.pathname;
    const match = path.match(/\/skills\/([^\/]+)\/versions/);
    if (match) {
      setSkillId(match[1]);
    }
  }, []);

  // Fetch versions
  useEffect(() => {
    if (skillId) {
      fetchVersions();
    }
  }, [skillId]);

  const fetchVersions = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem('token');

      // Fetch skill info
      const skillResponse = await fetch(`/api/skills/${skillId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (skillResponse.ok) {
        const skillData = await skillResponse.json();
        setSkillInfo({
          displayName: skillData.skill?.displayName || skillData.skill?.name || 'Unknown',
          name: skillData.skill?.name || 'unknown',
        });
      }

      // Fetch versions
      const versionsResponse = await fetch(`/api/skills/${skillId}/versions`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!versionsResponse.ok) {
        throw new Error('获取版本列表失败');
      }

      const data = await versionsResponse.json();
      setVersions(data.versions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchMetrics = async (versionId: string): Promise<VersionMetrics> => {
    const token = localStorage.getItem('token');
    const response = await fetch(`/api/skills/${versionId}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.ok) {
      const data = await response.json();
      return {
        precision: data.precision || 0,
        recall: data.recall || 0,
        falsePositiveRate: data.falsePositiveRate || 0,
        confirmedCount: data.confirmedCaseCount || 0,
        falsePositiveCount: data.falsePositiveCount || 0,
      };
    }

    return {
      precision: 0,
      recall: 0,
      falsePositiveRate: 0,
      confirmedCount: 0,
      falsePositiveCount: 0,
    };
  };

  const handleVersionSelect = (versionId: string) => {
    if (selectedVersions.includes(versionId)) {
      setSelectedVersions(selectedVersions.filter(id => id !== versionId));
    } else if (selectedVersions.length < 2) {
      setSelectedVersions([...selectedVersions, versionId]);
    } else {
      // Replace the first selection
      setSelectedVersions([selectedVersions[1], versionId]);
    }
  };

  const handleCompare = async () => {
    if (selectedVersions.length !== 2) return;

    try {
      setComparing(true);
      setComparisonResult(null);

      const [oldMetrics, newMetrics] = await Promise.all([
        fetchMetrics(selectedVersions[0]),
        fetchMetrics(selectedVersions[1]),
      ]);

      const oldVersion = versions.find(v => v.id === selectedVersions[0]);
      const newVersion = versions.find(v => v.id === selectedVersions[1]);

      // Ensure old version is the earlier one
      const isOldFirst = (oldVersion?.version || 0) < (newVersion?.version || 0);
      const before = isOldFirst ? oldMetrics : newMetrics;
      const after = isOldFirst ? newMetrics : oldMetrics;
      const beforeVersion = isOldFirst ? oldVersion?.version || 0 : newVersion?.version || 0;
      const afterVersion = isOldFirst ? newVersion?.version || 0 : oldVersion?.version || 0;

      const precisionChange = after.precision - before.precision;
      const recallChange = after.recall - before.recall;
      const falsePositiveRateChange = after.falsePositiveRate - before.falsePositiveRate;

      const isSuccess = precisionChange > 0 && recallChange >= -0.05;

      let successReason: string;
      if (isSuccess) {
        successReason = `精准率提升 ${(precisionChange * 100).toFixed(1)}%，召回率保持稳定`;
      } else if (precisionChange <= 0) {
        successReason = '精准率未提升';
      } else if (recallChange < -0.05) {
        successReason = `召回率显著下降 ${(recallChange * 100).toFixed(1)}%`;
      } else {
        successReason = '未知原因';
      }

      setComparisonResult({
        oldVersion: beforeVersion,
        newVersion: afterVersion,
        precisionBefore: before.precision,
        precisionAfter: after.precision,
        precisionChange,
        recallBefore: before.recall,
        recallAfter: after.recall,
        recallChange,
        falsePositiveRateBefore: before.falsePositiveRate,
        falsePositiveRateAfter: after.falsePositiveRate,
        falsePositiveRateChange,
        isSuccess,
        successReason,
      });
    } catch (err) {
      console.error('Comparison failed:', err);
    } finally {
      setComparing(false);
    }
  };

  const handleRollback = async () => {
    if (!rollbackModal || !rollbackReason.trim()) return;

    try {
      setRollbackLoading(true);
      setRollbackError(null);

      const token = localStorage.getItem('token');
      const response = await fetch(`/api/skills/${skillId}/rollback`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          targetVersionId: rollbackModal.targetVersionId,
          reason: rollbackReason.trim(),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '回滚失败');
      }

      // Success - refresh versions
      setRollbackModal(null);
      setRollbackReason('');
      fetchVersions();
    } catch (err) {
      setRollbackError(err instanceof Error ? err.message : '回滚失败');
    } finally {
      setRollbackLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getChangeTypeLabel = (changeType: string) => {
    const labels: Record<string, string> = {
      'prompt-update': '提示词更新',
      'parameter-tune': '参数调优',
      'tool-add': '添加工具',
      'tool-remove': '移除工具',
    };
    return labels[changeType] || changeType;
  };

  const getChangeTypeColor = (changeType: string) => {
    const colors: Record<string, string> = {
      'prompt-update': 'bg-blue-100 text-blue-700 border-blue-200',
      'parameter-tune': 'bg-yellow-100 text-yellow-700 border-yellow-200',
      'tool-add': 'bg-green-100 text-green-700 border-green-200',
      'tool-remove': 'bg-red-100 text-red-700 border-red-200',
    };
    return colors[changeType] || 'bg-gray-100 text-gray-700 border-gray-200';
  };

  // Calculate trend data for chart
  const getTrendData = () => {
    return versions
      .sort((a, b) => a.version - b.version)
      .map(v => ({
        version: v.version,
        precision: v.evolution?.afterRate || v.successRate || 0,
        createdAt: v.createdAt,
      }));
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
          <span className="text-gray-600 font-medium">加载版本数据...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md mx-4">
          <div className="flex items-center gap-3 text-red-600 mb-4">
            <AlertTriangle size={24} />
            <span className="font-semibold">加载失败</span>
          </div>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => router.push('/skills')}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            返回技能列表
          </button>
        </div>
      </div>
    );
  }

  // Single version case
  if (versions.length <= 1) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <button
              onClick={() => router.push('/skills')}
              className="p-2 hover:bg-white/80 rounded-lg transition-colors"
            >
              <ChevronLeft size={24} className="text-gray-600" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{skillInfo?.displayName || '版本对比'}</h1>
              <p className="text-gray-500 text-sm">版本效果对比分析</p>
            </div>
          </div>

          {/* Single version message */}
          <div className="bg-white rounded-xl shadow-lg p-8 text-center">
            <History size={48} className="mx-auto text-gray-400 mb-4" />
            <h2 className="text-xl font-semibold text-gray-700 mb-2">暂无历史版本</h2>
            <p className="text-gray-500 mb-6">
              当前技能只有一个版本，无法进行版本对比分析。
              请先进行技能进化操作以生成新版本。
            </p>
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-100 text-green-700 rounded-lg">
              <CheckCircle size={16} />
              <span>当前版本: v{versions[0]?.version || 1}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const trendData = getTrendData();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/skills')}
              className="p-2 hover:bg-white/80 rounded-lg transition-colors shadow-sm"
            >
              <ChevronLeft size={24} className="text-gray-600" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{skillInfo?.displayName}</h1>
              <p className="text-gray-500 text-sm flex items-center gap-2">
                <History size={14} />
                版本效果对比分析 · {versions.length} 个版本
              </p>
            </div>
          </div>

          {/* Compare button */}
          {selectedVersions.length === 2 && (
            <button
              onClick={handleCompare}
              disabled={comparing}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 shadow-md"
            >
              {comparing ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <GitCompare size={18} />
              )}
              <span>{comparing ? '对比中...' : '对比选中版本'}</span>
            </button>
          )}
        </div>

        {/* Trend Chart */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="flex items-center gap-3">
              <BarChart3 size={20} className="text-blue-600" />
              <h2 className="font-semibold text-gray-900">精准率趋势</h2>
            </div>
          </div>
          <div className="p-6">
            {/* CSS-based Line Chart */}
            <div className="relative h-64">
              {/* Y-axis labels */}
              <div className="absolute left-0 top-0 bottom-0 w-12 flex flex-col justify-between text-xs text-gray-500 py-2">
                <span>100%</span>
                <span>75%</span>
                <span>50%</span>
                <span>25%</span>
                <span>0%</span>
              </div>

              {/* Chart area */}
              <div className="ml-14 h-full relative bg-gradient-to-b from-blue-50/30 to-transparent rounded-lg border border-gray-100">
                {/* Grid lines */}
                <div className="absolute inset-0 flex flex-col justify-between">
                  {[0, 25, 50, 75, 100].map((val) => (
                    <div
                      key={val}
                      className="border-t border-gray-100/50 relative"
                      style={{ height: '20%' }}
                    />
                  ))}
                </div>

                {/* Data points and line */}
                {trendData.length > 1 && (
                  <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
                    {/* Line path */}
                    <path
                      d={trendData.map((d, i) => {
                        const x = (i / (trendData.length - 1)) * 100;
                        const y = 100 - (d.precision * 100);
                        return `${i === 0 ? 'M' : 'L'} ${x}% ${y}%`;
                      }).join(' ')}
                      fill="none"
                      stroke="url(#gradient)"
                      strokeWidth="3"
                      className="drop-shadow-sm"
                    />
                    {/* Gradient definition */}
                    <defs>
                      <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#3b82f6" />
                        <stop offset="100%" stopColor="#6366f1" />
                      </linearGradient>
                    </defs>
                  </svg>
                )}

                {/* Data points */}
                {trendData.map((d, i) => {
                  const xPercent = (i / (trendData.length - 1 || 1)) * 100;
                  const yPercent = 100 - (d.precision * 100);
                  return (
                    <div
                      key={d.version}
                      className="absolute transform -translate-x-1/2 -translate-y-1/2 group"
                      style={{ left: `${xPercent}%`, top: `${yPercent}%` }}
                    >
                      {/* Point */}
                      <div
                        className={`w-4 h-4 rounded-full border-2 shadow-md transition-all group-hover:scale-150 ${
                          d.precision >= 0.7
                            ? 'bg-green-500 border-green-300'
                            : d.precision >= 0.5
                            ? 'bg-blue-500 border-blue-300'
                            : 'bg-orange-500 border-orange-300'
                        }`}
                      />
                      {/* Tooltip */}
                      <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-900 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap">
                        v{d.version}: {(d.precision * 100).toFixed(1)}%
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* X-axis labels */}
              <div className="ml-14 mt-2 flex justify-between text-xs text-gray-500">
                {trendData.map((d) => (
                  <span key={d.version}>v{d.version}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Comparison Result */}
        {comparisonResult && (
          <div className="bg-white rounded-xl shadow-lg overflow-hidden border-2 border-indigo-200">
            <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-purple-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <GitCompare size={20} className="text-indigo-600" />
                  <h2 className="font-semibold text-gray-900">对比结果</h2>
                </div>
                <div className={`flex items-center gap-2 px-3 py-1 rounded-lg ${
                  comparisonResult.isSuccess
                    ? 'bg-green-100 text-green-700'
                    : 'bg-orange-100 text-orange-700'
                }`}>
                  {comparisonResult.isSuccess ? (
                    <CheckCircle size={16} />
                  ) : (
                    <AlertCircle size={16} />
                  )}
                  <span className="font-medium">
                    {comparisonResult.isSuccess ? '进化成功' : '需要优化'}
                  </span>
                </div>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-3 gap-6">
                {/* Precision */}
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-100">
                  <div className="flex items-center gap-2 mb-3">
                    <Target size={18} className="text-blue-600" />
                    <span className="font-medium text-gray-700">精准率</span>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-500">v{comparisonResult.oldVersion}</span>
                    <span className="text-lg font-bold text-gray-900">
                      {(comparisonResult.precisionBefore * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-gray-500">v{comparisonResult.newVersion}</span>
                    <span className="text-lg font-bold text-gray-900">
                      {(comparisonResult.precisionAfter * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2 pt-2 border-t border-blue-100">
                    {comparisonResult.precisionChange > 0 ? (
                      <TrendingUp size={16} className="text-green-600" />
                    ) : comparisonResult.precisionChange < 0 ? (
                      <TrendingDown size={16} className="text-red-600" />
                    ) : (
                      <Minus size={16} className="text-gray-400" />
                    )}
                    <span className={`font-medium ${
                      comparisonResult.precisionChange > 0 ? 'text-green-600' :
                      comparisonResult.precisionChange < 0 ? 'text-red-600' :
                      'text-gray-500'
                    }`}>
                      {(comparisonResult.precisionChange * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>

                {/* Recall */}
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4 border border-green-100">
                  <div className="flex items-center gap-2 mb-3">
                    <BarChart3 size={18} className="text-green-600" />
                    <span className="font-medium text-gray-700">召回率</span>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-500">v{comparisonResult.oldVersion}</span>
                    <span className="text-lg font-bold text-gray-900">
                      {(comparisonResult.recallBefore * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-gray-500">v{comparisonResult.newVersion}</span>
                    <span className="text-lg font-bold text-gray-900">
                      {(comparisonResult.recallAfter * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2 pt-2 border-t border-green-100">
                    {comparisonResult.recallChange > 0 ? (
                      <TrendingUp size={16} className="text-green-600" />
                    ) : comparisonResult.recallChange < 0 ? (
                      <TrendingDown size={16} className="text-red-600" />
                    ) : (
                      <Minus size={16} className="text-gray-400" />
                    )}
                    <span className={`font-medium ${
                      comparisonResult.recallChange > 0 ? 'text-green-600' :
                      comparisonResult.recallChange < 0 ? 'text-red-600' :
                      'text-gray-500'
                    }`}>
                      {(comparisonResult.recallChange * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>

                {/* False Positive Rate */}
                <div className="bg-gradient-to-br from-orange-50 to-red-50 rounded-lg p-4 border border-orange-100">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle size={18} className="text-orange-600" />
                    <span className="font-medium text-gray-700">误报率</span>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-500">v{comparisonResult.oldVersion}</span>
                    <span className="text-lg font-bold text-gray-900">
                      {(comparisonResult.falsePositiveRateBefore * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-gray-500">v{comparisonResult.newVersion}</span>
                    <span className="text-lg font-bold text-gray-900">
                      {(comparisonResult.falsePositiveRateAfter * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2 pt-2 border-t border-orange-100">
                    {comparisonResult.falsePositiveRateChange < 0 ? (
                      <TrendingDown size={16} className="text-green-600" />
                    ) : comparisonResult.falsePositiveRateChange > 0 ? (
                      <TrendingUp size={16} className="text-red-600" />
                    ) : (
                      <Minus size={16} className="text-gray-400" />
                    )}
                    <span className={`font-medium ${
                      comparisonResult.falsePositiveRateChange < 0 ? 'text-green-600' :
                      comparisonResult.falsePositiveRateChange > 0 ? 'text-red-600' :
                      'text-gray-500'
                    }`}>
                      {(comparisonResult.falsePositiveRateChange * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Summary */}
              <div className={`mt-4 p-4 rounded-lg ${
                comparisonResult.isSuccess
                  ? 'bg-green-50 border border-green-200'
                  : 'bg-orange-50 border border-orange-200'
              }`}>
                <p className={`text-sm ${
                  comparisonResult.isSuccess ? 'text-green-700' : 'text-orange-700'
                }`}>
                  <strong>分析结论:</strong> {comparisonResult.successReason}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Version List */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-slate-50 to-gray-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <History size={20} className="text-gray-600" />
                <h2 className="font-semibold text-gray-900">版本列表</h2>
              </div>
              {selectedVersions.length > 0 && (
                <span className="text-sm text-gray-500">
                  已选择 {selectedVersions.length} 个版本进行对比
                </span>
              )}
            </div>
          </div>

          <div className="divide-y divide-gray-100">
            {versions.map((v) => (
              <div
                key={v.id}
                className={`p-4 transition-all cursor-pointer ${
                  selectedVersions.includes(v.id)
                    ? 'bg-indigo-50 border-l-4 border-indigo-500'
                    : v.isLatest
                    ? 'bg-green-50/30'
                    : 'hover:bg-gray-50'
                }`}
                onClick={() => handleVersionSelect(v.id)}
              >
                <div className="flex items-start justify-between">
                  {/* Version Info */}
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      {/* Selection indicator */}
                      <div
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                          selectedVersions.includes(v.id)
                            ? 'bg-indigo-600 border-indigo-600'
                            : 'border-gray-300'
                        }`}
                      >
                        {selectedVersions.includes(v.id) && (
                          <CheckCircle size={14} className="text-white" />
                        )}
                      </div>

                      {/* Version Number */}
                      <span className={`px-3 py-1 rounded-lg font-medium text-sm ${
                        v.isLatest
                          ? 'bg-green-100 text-green-800 border border-green-200'
                          : 'bg-gray-100 text-gray-700 border border-gray-200'
                      }`}>
                        v{v.version}
                      </span>

                      {/* Latest Badge */}
                      {v.isLatest && (
                        <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                          <CheckCircle size={14} />
                          当前版本
                        </span>
                      )}

                      {/* Change Type Badge */}
                      {v.evolution && (
                        <span className={`px-2 py-0.5 rounded text-xs border ${getChangeTypeColor(v.evolution.changeType)}`}>
                          {getChangeTypeLabel(v.evolution.changeType)}
                        </span>
                      )}
                    </div>

                    {/* Change Description */}
                    {v.evolution?.changeDesc && (
                      <p className="text-sm text-gray-700 mb-1 ml-8">
                        {v.evolution.changeDesc}
                      </p>
                    )}

                    {/* Reason */}
                    {v.evolution?.reason && (
                      <p className="text-xs text-gray-500 mb-2 ml-8">
                        原因: {v.evolution.reason}
                      </p>
                    )}

                    {/* Metrics */}
                    {(v.evolution?.afterRate || v.successRate) && (
                      <div className="flex items-center gap-4 ml-8 mb-2">
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <Target size={12} className="text-blue-500" />
                          精准率: {((v.evolution?.afterRate || v.successRate || 0) * 100).toFixed(1)}%
                        </span>
                      </div>
                    )}

                    {/* Timestamp */}
                    <div className="flex items-center gap-1 text-xs text-gray-400 ml-8">
                      <History size={12} />
                      <span>{formatDate(v.createdAt)}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 ml-4">
                    {/* Rollback (not for latest) */}
                    {!v.isLatest && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setRollbackModal({
                            isOpen: true,
                            targetVersionId: v.id,
                            targetVersionNumber: v.version,
                          });
                        }}
                        className="inline-flex items-center px-3 py-1.5 text-xs bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition-colors border border-orange-200"
                        title="回滚到此版本"
                      >
                        <RotateCcw size={14} className="mr-1" />
                        回滚
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Rollback Modal */}
        {rollbackModal?.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-orange-50 to-red-50">
                <div className="flex items-center gap-3">
                  <RotateCcw size={20} className="text-orange-600" />
                  <h2 className="text-lg font-semibold text-gray-900">版本回滚确认</h2>
                </div>
                <button
                  onClick={() => {
                    setRollbackModal(null);
                    setRollbackReason('');
                    setRollbackError(null);
                  }}
                  className="p-2 hover:bg-orange-100 rounded-lg transition-colors"
                >
                  <ChevronLeft size={20} className="text-gray-500 rotate-180" />
                </button>
              </div>

              {/* Content */}
              <div className="px-6 py-5 space-y-4">
                {/* Warning */}
                <div className="flex items-start gap-3 p-4 bg-orange-50 border border-orange-200 rounded-lg">
                  <AlertTriangle size={20} className="text-orange-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-orange-800 mb-1">
                      您即将执行版本回滚操作
                    </p>
                    <p className="text-xs text-orange-700">
                      回滚将基于 v{rollbackModal.targetVersionNumber} 创建新的版本，
                      当前版本的内容将被替换为目标版本的内容。
                    </p>
                  </div>
                </div>

                {/* Info */}
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Skill 名称:</span>
                    <span className="font-medium text-gray-900">{skillInfo?.displayName}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-2">
                    <span className="text-gray-600">目标版本:</span>
                    <span className="font-medium text-green-700">v{rollbackModal.targetVersionNumber}</span>
                  </div>
                </div>

                {/* Reason Input */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    回滚原因 <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={rollbackReason}
                    onChange={(e) => setRollbackReason(e.target.value)}
                    placeholder="请填写回滚原因..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none"
                    rows={3}
                  />
                </div>

                {/* Error */}
                {rollbackError && (
                  <div className="flex items-center gap-2 text-red-600 text-sm">
                    <AlertTriangle size={16} />
                    <span>{rollbackError}</span>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end gap-3">
                <button
                  onClick={() => {
                    setRollbackModal(null);
                    setRollbackReason('');
                    setRollbackError(null);
                  }}
                  disabled={rollbackLoading}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={handleRollback}
                  disabled={rollbackLoading || !rollbackReason.trim()}
                  className="inline-flex items-center px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {rollbackLoading ? (
                    <>
                      <Loader2 size={16} className="mr-2 animate-spin" />
                      回滚中...
                    </>
                  ) : (
                    <>
                      <RotateCcw size={16} className="mr-2" />
                      确认回滚
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}