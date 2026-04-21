'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Activity,
  AlertTriangle,
  Award,
  BarChart3,
  RefreshCw,
  Clock,
  Layers,
  Minus,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

// Types from API response
interface ObservationStatsSummary {
  totalSkills: number;
  totalObservations: number;
  totalWarnings: number;
  totalMatches: number;
  totalOverlaps: number;
  avgMatchRate: number;
  avgWarningRate: number;
  highRiskSkills: number;
  recentObservations: number;
}

interface TrendMetric {
  label: string;
  value: number;
  unit: string;
  trend: 'up' | 'down' | 'stable';
  trendValue: number;
  color: string;
  icon: React.ReactNode;
}

export default function TrendsPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <TrendsPageContent />
    </Suspense>
  );
}

function TrendsPageContent() {
  const [stats, setStats] = useState<ObservationStatsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      const response = await fetch('/api/admin/skills-governance/stats', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '获取统计数据失败');
      }

      const result = await response.json();
      setStats(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  // Calculate trend metrics
  const getTrendMetrics = (): TrendMetric[] => {
    if (!stats) return [];
    
    return [
      {
        label: 'Skills 总数',
        value: stats.totalSkills,
        unit: '个',
        trend: stats.totalSkills > 0 ? 'up' : 'stable',
        trendValue: 0,
        color: 'text-blue-600',
        icon: <Award className="text-blue-500" size={20} />,
      },
      {
        label: '总观测次数',
        value: stats.totalObservations,
        unit: '次',
        trend: stats.recentObservations > stats.totalObservations * 0.1 ? 'up' : 'stable',
        trendValue: stats.recentObservations,
        color: 'text-green-600',
        icon: <Activity className="text-green-500" size={20} />,
      },
      {
        label: '预警记录',
        value: stats.totalWarnings,
        unit: '次',
        trend: stats.avgWarningRate > 0.3 ? 'up' : 'down',
        trendValue: stats.avgWarningRate * 100,
        color: 'text-orange-600',
        icon: <AlertTriangle className="text-orange-500" size={20} />,
      },
      {
        label: '匹配次数',
        value: stats.totalMatches,
        unit: '次',
        trend: stats.avgMatchRate > 0.5 ? 'up' : 'stable',
        trendValue: stats.avgMatchRate * 100,
        color: 'text-purple-600',
        icon: <Layers className="text-purple-500" size={20} />,
      },
      {
        label: '重叠检测',
        value: stats.totalOverlaps,
        unit: '次',
        trend: stats.totalOverlaps > 10 ? 'up' : 'stable',
        trendValue: 0,
        color: 'text-indigo-600',
        icon: <BarChart3 className="text-indigo-500" size={20} />,
      },
      {
        label: '高风险 Skills',
        value: stats.highRiskSkills,
        unit: '个',
        trend: stats.highRiskSkills > 0 ? 'up' : 'stable',
        trendValue: 0,
        color: 'text-red-600',
        icon: <AlertTriangle className="text-red-500" size={20} />,
      },
    ];
  };

  // Get trend icon
  const getTrendIcon = (trend: 'up' | 'down' | 'stable') => {
    switch (trend) {
      case 'up':
        return <TrendingUp className="text-green-500" size={16} />;
      case 'down':
        return <TrendingDown className="text-red-500" size={16} />;
      default:
        return <Minus className="text-gray-400" size={16} />;
    }
  };

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
          onClick={fetchStats}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <RefreshCw size={20} className="mr-2" />
          重新加载
        </button>
      </div>
    );
  }

  const trendMetrics = getTrendMetrics();

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
          <h1 className="text-2xl font-bold text-gray-900">观测趋势分析</h1>
          <p className="mt-1 text-sm text-gray-600">
            Skills 观测数据的整体趋势和统计摘要
          </p>
        </div>
        <button
          onClick={fetchStats}
          disabled={loading}
          className="inline-flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={20} className={`mr-2 ${loading ? 'animate-spin' : ''}`} />
          刷新数据
        </button>
      </div>

      {/* Summary Overview */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <BarChart3 className="mr-2" size={20} />
          统计摘要
        </h2>
        
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {trendMetrics.map((metric) => (
            <div
              key={metric.label}
              className="p-4 bg-gray-50 rounded-lg border border-gray-200"
            >
              <div className="flex items-center justify-between mb-2">
                {metric.icon}
                {getTrendIcon(metric.trend)}
              </div>
              <p className="text-xs text-gray-500 mb-1">{metric.label}</p>
              <p className={`text-2xl font-bold ${metric.color}`}>
                {metric.value}
                <span className="text-sm text-gray-500 ml-1">{metric.unit}</span>
              </p>
              {metric.trendValue > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  {metric.trendValue.toFixed(1)}%
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <Clock className="mr-2" size={20} />
          最近7天活动
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Recent Observations */}
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center">
                <Activity className="text-blue-600 mr-2" size={20} />
                <span className="font-medium text-blue-900">最近观测</span>
              </div>
              <TrendingUp className="text-blue-500" size={20} />
            </div>
            <p className="text-3xl font-bold text-blue-700 mb-2">
              {stats?.recentObservations || 0}
            </p>
            <p className="text-sm text-blue-600">
              最近7天内的观测记录总数
            </p>
            <div className="mt-3 pt-3 border-t border-blue-200">
              <div className="flex items-center justify-between text-sm">
                <span className="text-blue-500">日均观测</span>
                <span className="font-medium text-blue-700">
                  {((stats?.recentObservations || 0) / 7).toFixed(1)}
                </span>
              </div>
            </div>
          </div>

          {/* Warning Rate */}
          <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center">
                <AlertTriangle className="text-orange-600 mr-2" size={20} />
                <span className="font-medium text-orange-900">平均预警率</span>
              </div>
              {(stats?.avgWarningRate ?? 0) > 0.3 ? (
                <TrendingUp className="text-red-500" size={20} />
              ) : (
                <TrendingDown className="text-green-500" size={20} />
              )}
            </div>
            <p className="text-3xl font-bold text-orange-700 mb-2">
              {((stats?.avgWarningRate || 0) * 100).toFixed(1)}%
            </p>
            <p className="text-sm text-orange-600">
              所有 Skills 的平均预警比例
            </p>
            <div className="mt-3 pt-3 border-t border-orange-200">
              <div className="flex items-center justify-between text-sm">
                <span className="text-orange-500">高风险 Skills</span>
                <span className="font-medium text-red-700">
                  {stats?.highRiskSkills || 0} 个
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Rate Analysis */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <BarChart3 className="mr-2" size={20} />
          比率分析
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Match Rate */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">匹配率分布</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">平均匹配率</span>
                <div className="flex items-center">
                  <div className="w-24 bg-gray-200 rounded-full h-2 mr-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full"
                      style={{ width: `${Math.min((stats?.avgMatchRate || 0) * 100, 100)}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-900">
                    {((stats?.avgMatchRate || 0) * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                匹配率表示 Skill 在请求中被选中的比例
              </p>
            </div>
          </div>

          {/* Warning Rate */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">预警率分布</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">平均预警率</span>
                <div className="flex items-center">
                  <div className="w-24 bg-gray-200 rounded-full h-2 mr-2">
                    <div
                      className={`h-2 rounded-full ${
                        (stats?.avgWarningRate || 0) >= 0.5 ? 'bg-red-500' :
                        (stats?.avgWarningRate || 0) >= 0.3 ? 'bg-orange-500' :
                        'bg-yellow-500'
                      }`}
                      style={{ width: `${Math.min((stats?.avgWarningRate || 0) * 100, 100)}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-900">
                    {((stats?.avgWarningRate || 0) * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                预警率表示 Skill 触发预警的比例（≥50% 为高风险）
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Data Overview */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <Layers className="mr-2" size={20} />
          数据概览
        </h2>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500 mb-1">总观测</p>
            <p className="text-xl font-bold text-gray-900">{stats?.totalObservations || 0}</p>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500 mb-1">总匹配</p>
            <p className="text-xl font-bold text-gray-900">{stats?.totalMatches || 0}</p>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500 mb-1">总预警</p>
            <p className="text-xl font-bold text-gray-900">{stats?.totalWarnings || 0}</p>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500 mb-1">总重叠</p>
            <p className="text-xl font-bold text-gray-900">{stats?.totalOverlaps || 0}</p>
          </div>
        </div>
        
        <div className="mt-4 pt-4 border-t border-gray-200">
          <p className="text-sm text-gray-600">
            <Activity size={14} className="inline mr-1" />
            数据来源于 Skills 观测日志的聚合统计，反映整体 Skills 使用和治理情况。
          </p>
        </div>
      </div>

      {/* Quick Links */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">快速导航</h3>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/admin/skills-governance/high-frequency"
            className="inline-flex items-center px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <TrendingUp size={16} className="mr-1" />
            高频重复排行
          </Link>
          <Link
            href="/dashboard/admin/skills-governance/merge-candidates"
            className="inline-flex items-center px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <Layers size={16} className="mr-1" />
            合并候选列表
          </Link>
          <Link
            href="/dashboard/admin/skills-governance/new-impact"
            className="inline-flex items-center px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <AlertTriangle size={16} className="mr-1" />
            新增影响分析
          </Link>
          <Link
            href="/dashboard/admin/skills-governance/merge"
            className="inline-flex items-center px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <BarChart3 size={16} className="mr-1" />
            合并操作
          </Link>
        </div>
      </div>
    </div>
  );
}