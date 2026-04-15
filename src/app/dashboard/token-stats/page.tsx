'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Coins,
  TrendingUp,
  Calendar,
  Clock,
  ChevronRight,
  Loader2,
  AlertCircle,
  BarChart3,
  PieChart,
  Info,
  Users,
} from 'lucide-react';
import Link from 'next/link';

interface TokenSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  evaluationCount: number;
  callCount: number;
}

interface ModelStat {
  modelName: string;
  apiProvider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  callCount: number;
}

interface ProjectStat {
  projectId: string;
  projectName: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  evaluationCount: number;
}

interface TrendData {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  callCount: number;
}

export default function TokenStatsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  // 各时间段统计
  const [dailyStats, setDailyStats] = useState<TokenSummary | null>(null);
  const [weeklyStats, setWeeklyStats] = useState<TokenSummary | null>(null);
  const [monthlyStats, setMonthlyStats] = useState<TokenSummary | null>(null);
  const [yearlyStats, setYearlyStats] = useState<TokenSummary | null>(null);

  // 当前选中的时间段
  const [selectedPeriod, setSelectedPeriod] = useState<'day' | 'week' | 'month' | 'year'>('day');

  // 详细统计
  const [modelStats, setModelStats] = useState<ModelStat[]>([]);
  const [projectStats, setProjectStats] = useState<ProjectStat[]>([]);
  const [trendData, setTrendData] = useState<TrendData[]>([]);

  useEffect(() => {
    // 检查是否是管理员
    const userStr = localStorage.getItem('user');
    if (userStr) {
      const user = JSON.parse(userStr);
      setIsAdmin(user.roles?.includes('admin') || false);
    }
    
    fetchAllStats();
  }, []);

  const fetchAllStats = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');

      // 并行获取各时间段统计
      const [dayRes, weekRes, monthRes, yearRes] = await Promise.all([
        fetch(`/api/token-stats?period=day`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/token-stats?period=week`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/token-stats?period=month`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/token-stats?period=year`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (!dayRes.ok) {
        const data = await dayRes.json();
        setError(data.error || '获取统计数据失败');
        setLoading(false);
        return;
      }

      const dayData = await dayRes.json();
      const weekData = await weekRes.json();
      const monthData = await monthRes.json();
      const yearData = await yearRes.json();

      setDailyStats(dayData.summary);
      setWeeklyStats(weekData.summary);
      setMonthlyStats(monthData.summary);
      setYearlyStats(yearData.summary);

      // 默认显示今日的详细数据
      updateDetailStats(dayData);
      setLoading(false);
    } catch (err) {
      console.error('Fetch stats error:', err);
      setError('网络错误，请重试');
      setLoading(false);
    }
  };

  const updateDetailStats = (data: any) => {
    setModelStats(data.modelStats || []);
    setProjectStats(data.projectStats || []);
    setTrendData(data.trendData || []);
  };

  const fetchPeriodStats = async (period: 'day' | 'week' | 'month' | 'year') => {
    setSelectedPeriod(period);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/token-stats?period=${period}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        updateDetailStats(data);
      }
    } catch (err) {
      console.error('Fetch period stats error:', err);
    }
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

  const formatCost = (cost: number) => {
    if (cost === 0) {
      return '¥0';
    }
    return `¥${cost.toFixed(4)}`;
  };

  // 费用显示组件（带计费规则提示）
  const CostWithTooltip = ({ cost }: { cost: number }) => (
    <span className="flex items-center">
      {formatCost(cost)}
      <span className="ml-1 cursor-help relative group">
        <Info size={10} className="text-gray-400 hover:text-gray-600" />
        <span className="absolute right-0 bottom-full mb-1 hidden group-hover:block bg-gray-800 text-white text-xs rounded p-1.5 whitespace-nowrap z-10 shadow-lg">
          ¥6/百万输入 + ¥22/百万输出
        </span>
      </span>
    </span>
  );

  const formatTokensWithColor = (input: number, output: number) => {
    return (
      <div className="flex items-center space-x-2 text-xs">
        <span className="text-blue-600">↑ {formatNumber(input)}</span>
        <span className="text-green-600">↓ {formatNumber(output)}</span>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">加载失败</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => router.push('/dashboard')}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            <Coins className="mr-2 text-blue-600" size={28} />
            Token 消耗统计
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            查看大模型 API 调用的 Token 消耗情况
          </p>
        </div>
      </div>

      {/* 时间段选择 + 管理员按钮 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2 bg-white rounded-lg shadow border border-gray-200 p-4">
          <Calendar className="text-gray-400" size={20} />
          <span className="text-sm font-medium text-gray-700">时间范围：</span>
          <div className="flex space-x-2">
            {(['day', 'week', 'month', 'year'] as const).map((period) => (
              <button
                key={period}
                onClick={() => fetchPeriodStats(period)}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  selectedPeriod === period
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {period === 'day' ? '今日' : period === 'week' ? '本周' : period === 'month' ? '本月' : '本年'}
              </button>
            ))}
          </div>
        </div>
        
        {/* 管理员专属：查看用户统计 */}
        {isAdmin && (
          <Link
            href="/dashboard/token-stats/users"
            className="flex items-center px-4 py-3 bg-blue-500 text-white rounded-lg shadow hover:bg-blue-600 transition-colors"
          >
            <Users size={18} className="mr-2" />
            查看用户统计
            <ChevronRight size={16} className="ml-1" />
          </Link>
        )}
      </div>

      {/* 汇总统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          title="今日消耗"
          stats={dailyStats}
          icon={<Clock className="text-blue-600" size={24} />}
          color="blue"
        />
        <SummaryCard
          title="本周消耗"
          stats={weeklyStats}
          icon={<Calendar className="text-green-600" size={24} />}
          color="green"
        />
        <SummaryCard
          title="本月消耗"
          stats={monthlyStats}
          icon={<TrendingUp className="text-purple-600" size={24} />}
          color="purple"
        />
        <SummaryCard
          title="本年消耗"
          stats={yearlyStats}
          icon={<BarChart3 className="text-orange-600" size={24} />}
          color="orange"
        />
      </div>

      {/* 当前时间段详情 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <PieChart className="mr-2 text-blue-600" size={20} />
          {selectedPeriod === 'day' ? '今日' : selectedPeriod === 'week' ? '本周' : selectedPeriod === 'month' ? '本月' : '本年'}详细统计
        </h2>

        {/* 总计 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 bg-gray-50 rounded-lg p-4">
          <div>
            <p className="text-xs text-gray-500">总输入 Token</p>
            <p className="text-lg font-semibold text-blue-600">
              {formatNumber(dailyStats?.totalInputTokens || 0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">总输出 Token</p>
            <p className="text-lg font-semibold text-green-600">
              {formatNumber(dailyStats?.totalOutputTokens || 0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">评估次数</p>
            <p className="text-lg font-semibold text-gray-900">
              {dailyStats?.evaluationCount || 0}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 flex items-center">
              预估费用
              <span 
                className="ml-1 cursor-help relative group"
                title="费用计算公式"
              >
                <Info size={12} className="text-gray-400 hover:text-gray-600" />
                <span className="absolute left-0 bottom-full mb-2 hidden group-hover:block bg-gray-800 text-white text-xs rounded p-2 whitespace-nowrap z-10 shadow-lg">
                  费用 = 输入Token × 单价 + 输出Token × 单价<br/>
                  <span className="text-gray-400">单价：输入 ¥6/百万，输出 ¥22/百万</span>
                </span>
              </span>
            </p>
            <p className="text-lg font-semibold text-orange-600">
              {formatCost(dailyStats?.estimatedCost || 0)}
            </p>
          </div>
        </div>

        {/* 模型使用统计 */}
        {modelStats.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3">模型使用分布</h3>
            <div className="space-y-2">
              {modelStats.map((stat, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                      <span className="text-xs font-medium text-blue-700">
                        {stat.apiProvider.substring(0, 2).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {stat.modelName || '未知模型'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {stat.apiProvider} · {stat.callCount} 次调用
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    {formatTokensWithColor(stat.inputTokens, stat.outputTokens)}
                    <p className="text-xs text-gray-500 mt-1">
                      <CostWithTooltip cost={stat.estimatedCost || 0} />
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 项目消耗统计 */}
        {projectStats.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">项目消耗明细</h3>
            <div className="space-y-2">
              {projectStats.map((stat) => (
                <Link
                  key={stat.projectId}
                  href={`/dashboard/token-stats/project/${stat.projectId}`}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-200 transition-colors cursor-pointer"
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                      <span className="text-xs font-medium text-purple-700">
                        {stat.projectName.substring(0, 2).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{stat.projectName}</p>
                      <p className="text-xs text-gray-500">
                        {stat.evaluationCount} 次评估
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <div className="text-right">
                      {formatTokensWithColor(stat.totalInputTokens, stat.totalOutputTokens)}
                      <p className="text-xs text-gray-500 mt-1">
                        <CostWithTooltip cost={stat.estimatedCost || 0} />
                      </p>
                    </div>
                    <ChevronRight className="text-gray-400" size={20} />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* 无数据提示 */}
        {modelStats.length === 0 && projectStats.length === 0 && (
          <div className="text-center py-8 bg-gray-50 rounded-lg">
            <Coins className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-4 text-sm text-gray-500">
              当前时间段内暂无 Token 使用记录
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// 汇总卡片组件
function SummaryCard({
  title,
  stats,
  icon,
  color,
}: {
  title: string;
  stats: TokenSummary | null;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'purple' | 'orange';
}) {
  const colorClasses = {
    blue: 'bg-blue-50 border-blue-200',
    green: 'bg-green-50 border-green-200',
    purple: 'bg-purple-50 border-purple-200',
    orange: 'bg-orange-50 border-orange-200',
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

  const formatCost = (cost: number) => {
    if (cost === 0) {
      return '¥0';
    }
    return `¥${cost.toFixed(4)}`;
  };

  return (
    <div className={`bg-white rounded-lg shadow border p-6`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
            {icon}
          </div>
          <h3 className="text-sm font-medium text-gray-600">{title}</h3>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">总 Token</span>
          <span className="text-lg font-bold text-gray-900">
            {formatNumber(stats?.totalTokens || 0)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">输入/输出</span>
          <div className="flex items-center space-x-2 text-xs">
            <span className="text-blue-600">↑{formatNumber(stats?.totalInputTokens || 0)}</span>
            <span className="text-green-600">↓{formatNumber(stats?.totalOutputTokens || 0)}</span>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">评估次数</span>
          <span className="text-sm font-medium text-gray-700">
            {stats?.evaluationCount || 0}
          </span>
        </div>
        <div className="flex items-center justify-between border-t border-gray-100 pt-2">
          <span className="text-xs text-gray-500 flex items-center">
            预估费用
            <span 
              className="ml-1 cursor-help relative group"
            >
              <Info size={12} className="text-gray-400 hover:text-gray-600" />
              <span className="absolute left-0 bottom-full mb-2 hidden group-hover:block bg-gray-800 text-white text-xs rounded p-2 whitespace-nowrap z-10 shadow-lg">
                费用 = 输入Token × 单价 + 输出Token × 单价<br/>
                <span className="text-gray-400">单价：输入 ¥6/百万，输出 ¥22/百万</span>
              </span>
            </span>
          </span>
          <span className="text-sm font-bold text-orange-600">
            {formatCost(stats?.estimatedCost || 0)}
          </span>
        </div>
      </div>
    </div>
  );
}