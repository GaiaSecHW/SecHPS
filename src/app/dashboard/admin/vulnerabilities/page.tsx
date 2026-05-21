'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import toast from 'react-hot-toast';
import { Search, ChevronLeft, ChevronRight, AlertCircle, Shield, AlertTriangle, Clock, CheckCircle } from 'lucide-react';
import { AdminGuard } from '@/components/PermissionGuard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

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

function SeverityProgressBar({ stats }: { stats: VulnStats }) {
  const total = stats.total || 1;
  
  return (
    <div className="space-y-3">
      {SEVERITY_ORDER.map(severity => {
        const count = stats.bySeverity?.[severity] || 0;
        const percent = Math.round((count / total) * 100);
        const color = severityColors[severity];
        const label = severityLabels[severity];
        
        return (
          <div key={severity} className="flex items-center gap-3">
            <div className="flex items-center gap-2 w-16">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-sm text-gray-400">{label}</span>
            </div>
            <div className="flex-1 h-8 bg-dark-bg rounded-lg overflow-hidden">
              <div
                className="h-full rounded-lg flex items-center px-3 transition-all duration-500"
                style={{
                  width: `${Math.max(percent, count > 0 ? 8 : 0)}%`,
                  backgroundColor: color,
                  minWidth: count > 0 ? '50px' : '0'
                }}
              >
                <span className="text-sm font-semibold text-white">{count}</span>
              </div>
            </div>
            <span className="text-sm text-gray-500 w-12 text-right">{percent}%</span>
          </div>
        );
      })}
    </div>
  );
}

function StatusProgressBar({ stats }: { stats: VulnStats }) {
  const total = stats.total || 1;
  const statusOrder = ['new', 'confirmed', 'fixed', 'verified', 'false-positive'];
  const statusColors: Record<string, string> = {
    new: '#A855F7',
    confirmed: '#22C55E',
    fixed: '#3B82F6',
    verified: '#10B981',
    'false-positive': '#6B7280',
  };
  
  return (
    <div className="space-y-3">
      {statusOrder.map(status => {
        const count = stats.byStatus?.[status] || stats.byStatus?.[status.replace('-', '_')] || 0;
        const percent = Math.round((count / total) * 100);
        const color = statusColors[status];
        const label = statusLabels[status];
        
        return (
          <div key={status} className="flex items-center gap-3">
            <div className="flex items-center gap-2 w-16">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-sm text-gray-400">{label}</span>
            </div>
            <div className="flex-1 h-8 bg-dark-bg rounded-lg overflow-hidden">
              <div
                className="h-full rounded-lg flex items-center px-3 transition-all duration-500"
                style={{
                  width: `${Math.max(percent, count > 0 ? 8 : 0)}%`,
                  backgroundColor: color,
                  minWidth: count > 0 ? '50px' : '0'
                }}
              >
                <span className="text-sm font-semibold text-white">{count}</span>
              </div>
            </div>
            <span className="text-sm text-gray-500 w-12 text-right">{percent}%</span>
          </div>
        );
      })}
    </div>
  );
}

function VulnerabilitiesContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [vulnerabilities, setVulnerabilities] = useState<Vulnerability[]>([]);
  const [stats, setStats] = useState<VulnStats | null>(null);
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [loading, setLoading] = useState(true);

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

  const criticalHigh = (stats?.bySeverity?.critical || 0) + (stats?.bySeverity?.high || 0);
  const pending = (stats?.byStatus?.new || 0) + (stats?.byStatus?.pending || 0);
  const resolved = (stats?.byStatus?.fixed || 0) + (stats?.byStatus?.verified || 0);

  return (
    <div className="space-y-6">
      {/* ========== 第一行：4个指标卡片 ========== */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-dark-surface rounded-xl border border-gray-700/50 p-5 hover:border-blue-500/50 transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">漏洞总数</p>
                <p className="text-3xl font-bold text-white mt-1">{stats.total}</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Shield className="text-blue-400" size={24} />
              </div>
            </div>
          </div>

          <div className="bg-dark-surface rounded-xl border border-red-500/30 p-5 hover:border-red-500/50 transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">高危威胁</p>
                <p className="text-3xl font-bold text-red-400 mt-1">{criticalHigh}</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="text-red-400" size={24} />
              </div>
            </div>
            {stats.total > 0 && (
              <p className="text-xs text-gray-500 mt-2">
                占比 {Math.round((criticalHigh / stats.total) * 100)}%
              </p>
            )}
          </div>

          <div className="bg-dark-surface rounded-xl border border-yellow-500/30 p-5 hover:border-yellow-500/50 transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">待处理</p>
                <p className="text-3xl font-bold text-yellow-400 mt-1">{pending}</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                <Clock className="text-yellow-400" size={24} />
              </div>
            </div>
            {stats.total > 0 && (
              <p className="text-xs text-gray-500 mt-2">
                占比 {Math.round((pending / stats.total) * 100)}%
              </p>
            )}
          </div>

          <div className="bg-dark-surface rounded-xl border border-green-500/30 p-5 hover:border-green-500/50 transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-400">已解决</p>
                <p className="text-3xl font-bold text-green-400 mt-1">{resolved}</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-green-500/20 flex items-center justify-center">
                <CheckCircle className="text-green-400" size={24} />
              </div>
            </div>
            {stats.total > 0 && (
              <p className="text-xs text-gray-500 mt-2">
                占比 {Math.round((resolved / stats.total) * 100)}%
              </p>
            )}
          </div>
        </div>
      )}

      {/* ========== 第二行：两个进度条图表 ========== */}
      {stats && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-dark-surface rounded-xl border border-gray-700/50 p-5">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <AlertTriangle size={18} className="text-red-400" />
              严重程度分布
            </h3>
            <SeverityProgressBar stats={stats} />
          </div>

          <div className="bg-dark-surface rounded-xl border border-gray-700/50 p-5">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <CheckCircle size={18} className="text-purple-400" />
              状态分布
            </h3>
            <StatusProgressBar stats={stats} />
          </div>
        </div>
      )}

      {/* ========== 漏洞列表卡片（含搜索筛选） ========== */}
      <div className="bg-dark-surface rounded-xl border border-gray-700/50">
        {/* 搜索筛选栏 */}
        <div className="px-5 py-4 border-b border-gray-700/50">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="搜索漏洞..."
                value={search}
                onChange={(e) => updateUrl({ search: e.target.value, page: 1 })}
                className="w-full pl-10 pr-3 py-2.5 bg-dark-bg border border-gray-700/50 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white placeholder-gray-500 text-sm"
              />
            </div>

            <select
              value={severity}
              onChange={(e) => updateUrl({ severity: e.target.value, page: 1 })}
              className="w-[140px] px-3 py-2.5 bg-dark-bg border border-gray-700/50 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white text-sm"
            >
              <option value="">所有级别</option>
              <option value="critical">严重</option>
              <option value="high">高危</option>
              <option value="medium">中危</option>
              <option value="low">低危</option>
              <option value="info">信息</option>
            </select>

            <select
              value={status}
              onChange={(e) => updateUrl({ status: e.target.value, page: 1 })}
              className="w-[130px] px-3 py-2.5 bg-dark-bg border border-gray-700/50 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white text-sm"
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
                className="w-[180px] px-3 py-2.5 bg-dark-bg border border-gray-700/50 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white text-sm"
              >
                <option value="">所有任务</option>
                {tasks.map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.count})</option>
                ))}
              </select>
            )}

            <div className="text-sm text-gray-500 flex items-center ml-auto">
              共 <span className="text-white font-medium ml-1">{totalCount}</span> 条
            </div>
          </div>
        </div>

        {/* 漏洞表格 */}
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
          <div className="overflow-x-auto">
            <table className="w-full table-fixed">
              <thead>
                <tr className="border-b border-gray-700/50 bg-dark-bg/50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider min-w-[100px] w-[100px] whitespace-nowrap">严重程度</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider overflow-hidden">标题</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider overflow-hidden min-w-[200px] w-[200px]">类型</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider min-w-[100px] w-[100px]">状态</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider min-w-[120px] w-[120px]">任务</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider min-w-[100px] w-[100px]">发现时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {vulnerabilities.map((vuln) => (
                  <tr
                    key={vuln.id}
                    className="hover:bg-dark-bg/50 cursor-pointer transition-colors"
                    onClick={() => handleRowClick(vuln.id)}
                  >
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium"
                        style={{
                          backgroundColor: `${severityColors[vuln.severity] || '#6B7280'}20`,
                          color: severityColors[vuln.severity] || '#6B7280'
                        }}
                      >
                        {severityLabels[vuln.severity] || vuln.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="overflow-hidden">
                        <p className="text-white font-medium truncate">{vuln.title}</p>
                        <p className="text-xs text-gray-500 truncate mt-0.5">{vuln.location || '无位置信息'}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">{vuln.type}</td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium"
                        style={{
                          backgroundColor: vuln.status === 'new' ? '#A855F720' :
                            vuln.status === 'confirmed' ? '#22C55E20' :
                            vuln.status === 'fixed' ? '#3B82F620' :
                            vuln.status === 'verified' ? '#10B98120' :
                            '#6B728020',
                          color: vuln.status === 'new' ? '#A855F7' :
                            vuln.status === 'confirmed' ? '#22C55E' :
                            vuln.status === 'fixed' ? '#3B82F6' :
                            vuln.status === 'verified' ? '#10B981' :
                            '#6B7280'
                        }}
                      >
                        {statusLabels[vuln.status] || vuln.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {vuln.TaskInstance ? (
                        <a
                          href={`/dashboard/task-builder/${vuln.TaskInstance.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-blue-400 hover:text-blue-300 hover:underline truncate block max-w-[120px]"
                          title={vuln.TaskInstance.name}
                        >
                          {vuln.TaskInstance.name}
                        </a>
                      ) : (
                        <span className="text-xs text-gray-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {new Date(vuln.createdAt).toLocaleDateString('zh-CN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 分页 */}
        {totalCount > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700/50">
            <div className="text-sm text-gray-400">
              第 {page}/{Math.ceil(totalCount / pageSize)} 页
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateUrl({ page: page - 1 })}
                disabled={page === 1}
                className="p-2 border border-gray-600 rounded-lg hover:bg-dark-bg disabled:opacity-50 disabled:cursor-not-allowed text-gray-400 hover:text-white transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => updateUrl({ page: page + 1 })}
                disabled={page >= Math.ceil(totalCount / pageSize)}
                className="p-2 border border-gray-600 rounded-lg hover:bg-dark-bg disabled:opacity-50 disabled:cursor-not-allowed text-gray-400 hover:text-white transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
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