'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import toast from 'react-hot-toast';
import { Search, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { AdminGuard } from '@/components/PermissionGuard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface Vulnerability {
  id: string;
  taskId: string | null;
  title: string;
  description: string;
  type: string;
  cwe: string | null;
  severity: string;
  status: string;
  location: string | null;
  createdAt: string;
  TaskInstance?: { id: string; name: string } | null;
}

interface VulnStats {
  total: number;
  bySeverity: Record<string, number>;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
}

interface TaskOption {
  id: string;
  name: string;
  agentName: string;
  count: number;
}

const severityColors: Record<string, string> = {
  critical: '#EF4444',
  high: '#F97316',
  medium: '#EAB308',
  low: '#3B82F6',
  info: '#6B7280',
};

const statusColors: Record<string, string> = {
  new: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  confirmed: 'bg-green-500/20 text-green-400 border-green-500/30',
  'false-positive': 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  fixed: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  verified: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};

const severityLabels: Record<string, string> = {
  critical: '严重',
  high: '高危',
  medium: '中危',
  low: '低危',
  info: '信息',
};

const statusLabels: Record<string, string> = {
  new: '新建',
  confirmed: '已确认',
  'false-positive': '误报',
  fixed: '已修复',
  verified: '已验证',
};

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

function VulnerabilitiesContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [vulnerabilities, setVulnerabilities] = useState<Vulnerability[]>([]);
  const [stats, setStats] = useState<VulnStats | null>(null);
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [loading, setLoading] = useState(true);

  // URL params
  const search = searchParams.get('search') || '';
  const severity = searchParams.get('severity') || '';
  const status = searchParams.get('status') || '';
  const taskFilter = searchParams.get('task') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);

  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 20;

  useEffect(() => {
    fetchStats();
    fetchVulnerabilities();
  }, [search, severity, status, taskFilter, page]);

  const fetchStats = async () => {
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      if (taskFilter) params.append('taskId', taskFilter);
      const response = await fetch(`/api/vulnerabilities/stats?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setStats(data.stats);
        setTasks(data.tasks || []);
      }
    } catch (err) {
      console.error('获取统计数据失败:', err);
      toast.error('获取统计数据失败');
    }
  };

  const fetchVulnerabilities = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (severity) params.append('severity', severity);
      if (status) params.append('status', status);
      if (taskFilter) params.append('taskId', taskFilter);
      params.append('page', page.toString());
      params.append('limit', pageSize.toString());

      const response = await fetch(`/api/vulnerabilities?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error('获取漏洞列表失败');
      }

      const data = await response.json();
      setVulnerabilities(data.data || []);
      setTotalCount(data.pagination?.total || 0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '获取数据失败');
    } finally {
      setLoading(false);
    }
  };

  const updateUrl = (updates: Record<string, string | number>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value === '' || value === 1) {
        params.delete(key);
      } else {
        params.set(key, String(value));
      }
    });
    router.push(`${pathname}?${params.toString()}`);
  };

  const handleRowClick = (vulnId: string) => {
    router.push(`/dashboard/admin/vulnerabilities/${vulnId}`);
  };

  const pieData = stats
    ? [
        { name: '严重', value: stats.bySeverity?.critical || 0, color: severityColors.critical },
        { name: '高危', value: stats.bySeverity?.high || 0, color: severityColors.high },
        { name: '中危', value: stats.bySeverity?.medium || 0, color: severityColors.medium },
        { name: '低危', value: stats.bySeverity?.low || 0, color: severityColors.low },
        { name: '信息', value: stats.bySeverity?.info || 0, color: severityColors.info },
      ].filter((d) => d.value > 0)
    : [];

  const barData = stats
    ? [
        { name: '新建', value: stats.byStatus?.new || 0, color: '#A855F7' },
        { name: '已确认', value: stats.byStatus?.confirmed || 0, color: '#22C55E' },
        { name: '误报', value: (stats.byStatus?.['false-positive'] || stats.byStatus?.false_positive || 0), color: '#6B7280' },
        { name: '已修复', value: stats.byStatus?.fixed || 0, color: '#3B82F6' },
        { name: '已验证', value: stats.byStatus?.verified || 0, color: '#10B981' },
      ].filter((d) => d.value > 0)
    : [];

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-[#1E293B] rounded-xl border border-gray-700/50 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">漏洞总数</p>
                <p className="text-3xl font-bold text-white mt-1">{stats.total}</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <AlertCircle className="text-blue-400" size={24} />
              </div>
            </div>
          </div>

          <div className="bg-[#1E293B] rounded-xl border border-gray-700/50 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">严重+高危</p>
                <p className="text-3xl font-bold text-white mt-1">
                  {(stats.bySeverity?.critical || 0) + (stats.bySeverity?.high || 0)}
                </p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-red-500/20 flex items-center justify-center">
                <AlertCircle className="text-red-400" size={24} />
              </div>
            </div>
          </div>

          <div className="bg-[#1E293B] rounded-xl border border-gray-700/50 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">待处理</p>
                <p className="text-3xl font-bold text-white mt-1">
                  {(stats.byStatus?.new || 0) + (stats.byStatus?.pending || 0)}
                </p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                <AlertCircle className="text-yellow-400" size={24} />
              </div>
            </div>
          </div>

          <div className="bg-[#1E293B] rounded-xl border border-gray-700/50 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">已修复/已验证</p>
                <p className="text-3xl font-bold text-white mt-1">
                  {(stats.byStatus?.fixed || 0) + (stats.byStatus?.verified || 0)}
                </p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-green-500/20 flex items-center justify-center">
                <AlertCircle className="text-green-400" size={24} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Charts */}
      {stats && (pieData.length > 0 || barData.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {pieData.length > 0 && (
            <div className="bg-[#1E293B] rounded-xl border border-gray-700/50 p-5">
              <h3 className="text-lg font-semibold text-white mb-4">严重程度分布</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) =>
                        `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                      }
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => [`${value} 条`, '数量']}
                      contentStyle={{
                        background: '#1E293B',
                        border: '1px solid #374151',
                        borderRadius: 8,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {barData.length > 0 && (
            <div className="bg-[#1E293B] rounded-xl border border-gray-700/50 p-5">
              <h3 className="text-lg font-semibold text-white mb-4">状态分布</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <BarChart data={barData} layout="vertical">
                    <XAxis type="number" stroke="#6B7280" />
                    <YAxis dataKey="name" type="category" stroke="#6B7280" width={60} />
                    <Tooltip
                      formatter={(value) => [`${value} 条`, '数量']}
                      contentStyle={{
                        background: '#1E293B',
                        border: '1px solid #374151',
                        borderRadius: 8,
                      }}
                    />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {barData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-[#1E293B] rounded-xl border border-gray-700/50 p-4">
        <div className="flex flex-wrap gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              size={18}
            />
            <input
              type="text"
              placeholder="搜索漏洞..."
              value={search}
              onChange={(e) => updateUrl({ search: e.target.value, page: 1 })}
              className="w-full pl-10 pr-4 py-2.5 bg-[#0F172A] border border-gray-700/50 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white placeholder-gray-500 text-sm"
            />
          </div>

          <select
            value={severity}
            onChange={(e) => updateUrl({ severity: e.target.value, page: 1 })}
            className="px-4 py-2.5 bg-[#0F172A] border border-gray-700/50 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white text-sm"
          >
            <option value="">所有严重程度</option>
            <option value="critical">严重</option>
            <option value="high">高危</option>
            <option value="medium">中危</option>
            <option value="low">低危</option>
            <option value="info">信息</option>
          </select>

          <select
            value={status}
            onChange={(e) => updateUrl({ status: e.target.value, page: 1 })}
            className="px-4 py-2.5 bg-[#0F172A] border border-gray-700/50 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white text-sm"
          >
            <option value="">所有状态</option>
            <option value="new">新建</option>
            <option value="confirmed">已确认</option>
            <option value="false-positive">误报</option>
            <option value="fixed">已修复</option>
            <option value="verified">已验证</option>
          </select>

          {tasks.length > 0 && (
            <select
              value={taskFilter}
              onChange={(e) => updateUrl({ task: e.target.value, page: 1 })}
              className="px-4 py-2.5 bg-[#0F172A] border border-gray-700/50 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white text-sm"
            >
              <option value="">所有任务</option>
              {tasks.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.count})</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Vulnerability List */}
      <div className="bg-[#1E293B] rounded-xl border border-gray-700/50">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <LoadingSpinner size="xl" />
          </div>
        ) : vulnerabilities.length === 0 ? (
          <div className="p-12 text-center">
            <AlertCircle className="mx-auto h-16 w-16 text-gray-400" />
            <h3 className="mt-4 text-lg font-medium text-white">暂无漏洞</h3>
            <p className="mt-2 text-sm text-gray-400">
              {search || severity || status
                ? '没有找到匹配的漏洞'
                : '系统运行良好，暂未发现安全漏洞'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-700/50">
            {vulnerabilities.map((vuln) => (
              <div
                key={vuln.id}
                className="px-4 py-4 hover:bg-[#0F172A]/50 cursor-pointer transition-colors"
                onClick={() => handleRowClick(vuln.id)}
              >
                <div className="flex items-center gap-4">
                  {/* Severity indicator */}
                  <div
                    className="w-2 h-10 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: severityColors[vuln.severity] || '#6B7280',
                    }}
                  />

                  {/* Status badge */}
                  <span
                    className={`px-3 py-1 text-xs font-medium rounded-full border flex-shrink-0 ${statusColors[vuln.status] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}
                  >
                    {statusLabels[vuln.status] || vuln.status}
                  </span>

                  {/* Title */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-white font-medium truncate">{vuln.title}</h3>
                    <p className="text-sm text-gray-400 truncate mt-0.5">
                      {vuln.location || '无位置信息'}
                    </p>
                  </div>

                  {/* Task name */}
                  {vuln.TaskInstance && (
                    <a
                      href={`/dashboard/task-builder/${vuln.TaskInstance.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-blue-400 hover:text-blue-300 flex-shrink-0 max-w-[120px] truncate"
                      title={vuln.TaskInstance.name}
                    >
                      {vuln.TaskInstance.name}
                    </a>
                  )}

                  {/* Type */}
                  <span className="text-sm text-gray-400 flex-shrink-0">
                    {vuln.type}
                  </span>

                  {/* CWE */}
                  {vuln.cwe && (
                    <span className="text-sm text-gray-500 flex-shrink-0">
                      {vuln.cwe}
                    </span>
                  )}

                  {/* Date */}
                  <span className="text-sm text-gray-500 flex-shrink-0">
                    {new Date(vuln.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalCount > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-400">
            共 {totalCount} 条记录，第 {page}/{Math.ceil(totalCount / pageSize)} 页
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => updateUrl({ page: page - 1 })}
              disabled={page === 1}
              className="p-2 border border-gray-600 rounded-lg hover:bg-[#0F172A] disabled:opacity-50 disabled:cursor-not-allowed text-gray-400 hover:text-white"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm text-gray-400">第 {page} 页</span>
            <button
              onClick={() => updateUrl({ page: page + 1 })}
              disabled={page >= Math.ceil(totalCount / pageSize)}
              className="p-2 border border-gray-600 rounded-lg hover:bg-[#0F172A] disabled:opacity-50 disabled:cursor-not-allowed text-gray-400 hover:text-white"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function VulnerabilitiesPage() {
  return (
    <AdminGuard>
      <Suspense fallback={<LoadingSpinner size="xl" />}>
        <VulnerabilitiesContent />
      </Suspense>
    </AdminGuard>
  );
}