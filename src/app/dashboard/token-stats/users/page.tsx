'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  Coins,
  TrendingUp,
  Calendar,
  Loader2,
  AlertCircle,
  ChevronRight,
  Info,
  ArrowLeft,
  Search,
  Download,
  SortAsc,
  SortDesc,
} from 'lucide-react';

interface UserStats {
  userId: string;
  username: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  evaluationCount: number;
}

export default function UserTokenStatsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userStats, setUserStats] = useState<UserStats[]>([]);
  const [period, setPeriod] = useState('month');
  const [isAdmin, setIsAdmin] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<'username' | 'totalTokens' | 'estimatedCost' | 'evaluationCount'>('totalTokens');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    checkAdminAndFetch();
  }, [period]);

  const checkAdminAndFetch = async () => {
    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('token');
      const userStr = localStorage.getItem('user');
      
      // 检查是否是管理员
      if (userStr) {
        const user = JSON.parse(userStr);
        const userRoles = user.roles || [];
        setIsAdmin(userRoles.includes('admin'));
        
        if (!userRoles.includes('admin')) {
          setError('此页面仅管理员可访问');
          setLoading(false);
          return;
        }
      }

      const response = await fetch(`/api/token-stats?period=${period}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || '获取数据失败');
        setLoading(false);
        return;
      }

      const data = await response.json();
      setUserStats(data.userStats || []);
    } catch (err) {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
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

  // 过滤和排序
  const filteredAndSortedStats = userStats
    .filter(user => user.username.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      let comparison = 0;
      if (sortField === 'username') {
        comparison = a.username.localeCompare(b.username);
      } else {
        comparison = a[sortField] - b[sortField];
      }
      return sortDirection === 'desc' ? -comparison : comparison;
    });

  // 导出 CSV
  const exportCSV = () => {
    const headers = ['用户名', '输入Token', '输出Token', '总Token', '预估费用(¥)', '评估次数'];
    const rows = filteredAndSortedStats.map(user => [
      user.username,
      user.inputTokens,
      user.outputTokens,
      user.totalTokens,
      user.estimatedCost.toFixed(4),
      user.evaluationCount,
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(',')),
    ].join('\n');
    
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `用户Token统计_${period}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 切换排序
  const toggleSort = (field: 'username' | 'totalTokens' | 'estimatedCost' | 'evaluationCount') => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // 计算汇总
  const totalInputTokens = userStats.reduce((sum, u) => sum + u.inputTokens, 0);
  const totalOutputTokens = userStats.reduce((sum, u) => sum + u.outputTokens, 0);
  const totalCost = userStats.reduce((sum, u) => sum + u.estimatedCost, 0);
  const totalEvaluations = userStats.reduce((sum, u) => sum + u.evaluationCount, 0);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-gray-400">此页面仅管理员可访问</p>
          <button
            onClick={() => router.push('/dashboard/token-stats')}
            className="mt-4 px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-600"
          >
            返回 Token 统计
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-gray-400">{error}</p>
          <button
            onClick={checkAdminAndFetch}
            className="mt-4 px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-600"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0F172A] p-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => router.push('/dashboard/token-stats')}
          className="flex items-center text-gray-400 hover:text-gray-100 mb-4"
        >
          <ArrowLeft size={20} className="mr-2" />
          返回 Token 统计
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-100 flex items-center">
              <Users className="mr-2" size={28} />
              用户 Token 统计
            </h1>
            <p className="text-gray-400 mt-1">查看所有用户的 Token 使用情况</p>
          </div>
          <div className="flex items-center space-x-3">
            {/* 搜索框 */}
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="搜索用户..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 w-200"
              />
            </div>
            {/* 时间选择 */}
            <div className="flex items-center space-x-2">
              <Calendar size={20} className="text-gray-400" />
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="w-[100px] px-3 py-2 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="day">今日</option>
                <option value="week">本周</option>
                <option value="month">本月</option>
                <option value="year">本年</option>
              </select>
            </div>
            {/* 导出按钮 */}
            <button
              onClick={exportCSV}
              className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-600 transition-colors"
            >
              <Download size={18} className="mr-2" />
              导出 CSV
            </button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-dark-surface rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="text-blue-500">
              <TrendingUp size={24} />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-100">{formatNumber(totalInputTokens)}</p>
              <p className="text-xs text-gray-500">总输入 Token</p>
            </div>
          </div>
        </div>
        <div className="bg-dark-surface rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="text-green-500">
              <TrendingUp size={24} />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-100">{formatNumber(totalOutputTokens)}</p>
              <p className="text-xs text-gray-500">总输出 Token</p>
            </div>
          </div>
        </div>
        <div className="bg-dark-surface rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="text-orange-500">
              <Coins size={24} />
            </div>
            <div className="text-right">
              <p className="text-xl font-bold text-orange-600 flex items-center">
                {formatCost(totalCost)}
                <span className="ml-1 cursor-help relative group">
                  <Info size={12} className="text-orange-400 hover:text-orange-600" />
                  <span className="absolute right-0 bottom-full mb-1 hidden group-hover:block bg-gray-800 text-white text-xs rounded p-1.5 whitespace-nowrap z-10 shadow-lg">
                    ¥6/百万输入 + ¥22/百万输出
                  </span>
                </span>
              </p>
              <p className="text-xs text-gray-500">总预估费用</p>
            </div>
          </div>
        </div>
        <div className="bg-dark-surface rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="text-purple-500">
              <Users size={24} />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-100">{userStats.length}</p>
              <p className="text-xs text-gray-500">活跃用户数</p>
            </div>
          </div>
        </div>
      </div>

      {/* User Stats Table */}
      <div className="bg-dark-surface rounded-lg">
        <div className="px-6 py-4 border-b border-gray-700/50">
          <h2 className="text-lg font-semibold text-gray-100">用户消耗排行</h2>
          <p className="text-sm text-gray-500 mt-1">按 Token 使用量排序</p>
        </div>
        
        {userStats.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">
            暂无数据
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-[#162032]">
                <tr>
                  <th 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-dark-surface-hover"
                    onClick={() => toggleSort('username')}
                  >
                    <div className="flex items-center">
                      用户名
                      {sortField === 'username' && (
                        sortDirection === 'asc' ? <SortAsc size={14} className="ml-1" /> : <SortDesc size={14} className="ml-1" />
                      )}
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    输入 Token
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    输出 Token
                  </th>
                  <th 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-dark-surface-hover"
                    onClick={() => toggleSort('totalTokens')}
                  >
                    <div className="flex items-center">
                      总 Token
                      {sortField === 'totalTokens' && (
                        sortDirection === 'asc' ? <SortAsc size={14} className="ml-1" /> : <SortDesc size={14} className="ml-1" />
                      )}
                    </div>
                  </th>
                  <th 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-dark-surface-hover"
                    onClick={() => toggleSort('estimatedCost')}
                  >
                    <div className="flex items-center">
                      预估费用
                      {sortField === 'estimatedCost' && (
                        sortDirection === 'asc' ? <SortAsc size={14} className="ml-1" /> : <SortDesc size={14} className="ml-1" />
                      )}
                    </div>
                  </th>
                  <th 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-dark-surface-hover"
                    onClick={() => toggleSort('evaluationCount')}
                  >
                    <div className="flex items-center">
                      评估次数
                      {sortField === 'evaluationCount' && (
                        sortDirection === 'asc' ? <SortAsc size={14} className="ml-1" /> : <SortDesc size={14} className="ml-1" />
                      )}
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {filteredAndSortedStats.map((user, index) => (
                  <tr key={user.userId} className="hover:bg-[#0F172A]">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <span className="text-sm font-medium text-gray-100">
                          {user.username}
                        </span>
                        {index === 0 && (
                          <span className="ml-2 px-2 py-0.5 text-xs bg-yellow-500/15 text-yellow-400 rounded-full">
                            🏆 Top 1
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-blue-400 font-medium">
                        {formatNumber(user.inputTokens)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-green-400 font-medium">
                        {formatNumber(user.outputTokens)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-purple-600 font-medium">
                        {formatNumber(user.totalTokens)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-orange-600 font-medium flex items-center">
                        {formatCost(user.estimatedCost)}
                        <span className="ml-1 cursor-help relative group">
                          <Info size={10} className="text-orange-400 hover:text-orange-600" />
                          <span className="absolute right-0 bottom-full mb-1 hidden group-hover:block bg-gray-800 text-white text-xs rounded p-1.5 whitespace-nowrap z-10 shadow-lg">
                            ¥6/百万输入 + ¥22/百万输出
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-gray-400">
                        {user.evaluationCount}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button
                        onClick={() => router.push(`/dashboard/users/${user.userId}`)}
                        className="text-blue-400 hover:text-blue-800 flex items-center"
                      >
                        查看详情
                        <ChevronRight size={16} className="ml-1" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}