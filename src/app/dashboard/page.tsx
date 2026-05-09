'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
  MessageSquare,
  ArrowRight,
  Shield,
  Bug,
  Hourglass,
  Coins,
  Info,
  Users,
} from 'lucide-react';
import { formatBeijingTime } from '@/lib/beijing-time';
import { extractErrorMessage } from '@/lib/api-client';
import { QueueMonitor } from '@/components/evaluation/QueueMonitor';

interface Session {
  id: string;
  name: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  status?: string;
  evaluationStatus?: string;
  hasWaitingEvaluation?: boolean;
  evaluationCounts?: { running: number; waiting: number; completed: number; failed: number };
  config?: any;
  messages?: any[];
  evaluations?: { id: string; status: string; startedAt: string; completedAt: string | null }[];
}

interface Stats {
  total: number;
  completed: number;
  failed: number;
  runningEvaluations: number;
  queuedEvaluations: number;
}

interface VulnerabilityStats {
  total: number;
  pending: number;
  confirmed: number;
  fixed: number;
  verified: number;
  falsePositive: number;
}

interface TokenStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  evaluationCount: number;
  callCount: number;
}

export default function DashboardPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<Stats>({
    total: 0,
    completed: 0,
    failed: 0,
    runningEvaluations: 0,
    queuedEvaluations: 0,
  });
  const [vulnStats, setVulnStats] = useState<VulnerabilityStats>({
    total: 0,
    pending: 0,
    confirmed: 0,
    fixed: 0,
    verified: 0,
    falsePositive: 0,
  });
  const [tokenStats, setTokenStats] = useState<TokenStats>({
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    evaluationCount: 0,
    callCount: 0,
  });
  const [isAdmin, setIsAdmin] = useState(false);
  const [hasRunningEvaluations, setHasRunningEvaluations] = useState(false);

  useEffect(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      const user = JSON.parse(userStr);
      setIsAdmin(user.roles?.includes('admin') || false);
    }

    fetchData();
    fetchVulnStats();
    fetchTokenStats();
  }, []);

  useEffect(() => {
    if (!hasRunningEvaluations) return;
    const pollInterval = setInterval(() => {
      fetchData();
    }, 5000);
    return () => clearInterval(pollInterval);
  }, [hasRunningEvaluations]);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/projects', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        setError(extractErrorMessage(data, '获取项目失败'));
        setLoading(false);
        return;
      }

      const data = await response.json();
      const projectList = data.projects || [];
      setSessions(projectList);

      const hasRunning = projectList.some((p: any) =>
        p.evaluationStatus === 'running' || p.hasWaitingEvaluation ||
        p.evaluations?.some((e: any) => e.status === 'running' || e.status === 'preparing' || e.status === 'ready')
      );
      setHasRunningEvaluations(hasRunning);

      let completed = 0;
      let failed = 0;
      let runningEvaluations = 0;
      let queuedEvaluations = 0;

      for (const project of projectList) {
        const evaluations = project.evaluations || [];
        if (evaluations.length === 0) continue;

        const sortedEvaluations = evaluations.sort((a: any, b: any) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
        );
        const lastEvaluation = sortedEvaluations[0];
        if (!lastEvaluation) continue;

        const lastStatus = lastEvaluation.status;
        if (lastStatus === 'completed') {
          completed++;
        } else if (lastStatus === 'failed') {
          failed++;
        } else if (lastStatus === 'queued') {
          queuedEvaluations++;
        } else if (['running', 'preparing'].includes(lastStatus)) {
          runningEvaluations++;
        }
      }

      setStats({
        total: projectList.length,
        completed,
        failed,
        runningEvaluations,
        queuedEvaluations,
      });
      setLoading(false);
    } catch (err) {
      setError('网络错误，请重试');
      setLoading(false);
    }
  };

  const fetchVulnStats = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/vulnerabilities/stats', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        const stats = data.stats;
        setVulnStats({
          total: stats.total || 0,
          pending: stats.byStatus?.new || 0,
          confirmed: stats.byStatus?.confirmed || 0,
          fixed: stats.byStatus?.fixed || 0,
          verified: stats.byStatus?.verified || 0,
          falsePositive: stats.byStatus?.['false-positive'] || 0,
        });
      }
    } catch (err) {
      console.error('获取漏洞统计失败:', err);
    }
  };

  const fetchTokenStats = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/token-stats?period=year', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setTokenStats({
          totalInputTokens: data.summary?.totalInputTokens || 0,
          totalOutputTokens: data.summary?.totalOutputTokens || 0,
          totalTokens: data.summary?.totalTokens || 0,
          estimatedCost: data.summary?.estimatedCost || 0,
          evaluationCount: data.summary?.evaluationCount || 0,
          callCount: data.summary?.callCount || 0,
        });
      }
    } catch (err) {
      console.error('获取Token统计失败:', err);
    }
  };

  const getStatusText = (status?: string) => {
    switch (status) {
      case 'running': return '运行中';
      case 'waiting': return '排队中';
      case 'preparing': return '准备中';
      case 'ready': return '就绪';
      case 'completed': return '已完成';
      case 'failed': return '失败';
      case 'cancelled': return '已取消';
      default: return '空闲';
    }
  };

  const getStatusBgColor = (status?: string) => {
    switch (status) {
      case 'running':
        return 'bg-blue-500/15 text-blue-400 border-blue-500/20';
      case 'waiting':
      case 'preparing':
      case 'ready':
        return 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20';
      case 'completed':
        return 'bg-green-500/15 text-green-400 border-green-500/20';
      case 'failed':
        return 'bg-red-500/15 text-red-400 border-red-500/20';
      case 'cancelled':
        return 'bg-gray-500/15 text-gray-400 border-gray-500/20';
      default:
        return 'bg-gray-500/15 text-gray-500 border-gray-500/20';
    }
  };

  const getProgressPercentage = (session: Session) => {
    if (!session.messages || session.messages.length === 0) return 0;
    return Math.min(100, session.messages.length * 10);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-t-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">数据看板</h1>
          <p className="mt-1 text-sm text-gray-400">
            实时监控项目状态和任务进度
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-800/40 text-red-300 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Project stats */}
      <div className="mb-6">
        <h2 className="text-base font-semibold text-gray-200 mb-4 flex items-center">
          <MessageSquare size={18} className="mr-2 text-primary-400" />
          项目统计
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard title="总项目数" value={stats.total} icon={<MessageSquare size={22} />} color="from-primary-600 to-primary-700" />
          <StatCard title="评估运行" value={stats.runningEvaluations} icon={<Activity size={22} />} color="from-blue-600 to-blue-700" />
          <StatCard title="队列中" value={stats.queuedEvaluations} icon={<Hourglass size={22} />} color="from-yellow-600 to-yellow-700" />
          <StatCard title="已完成" value={stats.completed} icon={<CheckCircle2 size={22} />} color="from-green-600 to-green-700" />
          <StatCard title="失败" value={stats.failed} icon={<XCircle size={22} />} color="from-red-600 to-red-700" />
        </div>
      </div>

      {/* Queue monitor */}
      {isAdmin && (
        <div className="mb-6">
          <QueueMonitor autoRefresh refreshInterval={10000} pageSize={5} />
        </div>
      )}

      {/* Vulnerability stats */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-200 flex items-center">
            <Shield size={18} className="mr-2 text-primary-400" />
            漏洞统计
            {isAdmin && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-purple-500/15 text-purple-400 rounded-full border border-purple-500/20">
                管理员视图（全部用户）
              </span>
            )}
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <StatCard title="总漏洞数" value={vulnStats.total} icon={<Bug size={22} />} color="from-purple-600 to-purple-700" />
          <StatCard title="待处理" value={vulnStats.pending} icon={<Clock size={22} />} color="from-gray-600 to-gray-700" />
          <StatCard title="已确认" value={vulnStats.confirmed} icon={<CheckCircle2 size={22} />} color="from-yellow-600 to-yellow-700" />
          <StatCard title="已修复" value={vulnStats.fixed} icon={<Shield size={22} />} color="from-green-600 to-green-700" />
          <StatCard title="已验证" value={vulnStats.verified} icon={<TrendingUp size={22} />} color="from-blue-600 to-blue-700" />
          <StatCard title="误报" value={vulnStats.falsePositive} icon={<XCircle size={22} />} color="from-orange-600 to-orange-700" />
        </div>
      </div>

      {/* Token stats */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-200 flex items-center">
            <Coins size={18} className="mr-2 text-primary-400" />
            Token 消耗统计
            {isAdmin && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-blue-500/15 text-blue-400 rounded-full border border-blue-500/20">
                管理员视图（全部用户）
              </span>
            )}
          </h2>
          <div className="flex items-center space-x-3">
            {isAdmin && (
              <Link
                href="/dashboard/token-stats/users"
                className="flex items-center text-sm text-primary-400 hover:text-primary-300 transition-colors"
              >
                <Users size={16} className="mr-1" />
                查看用户统计
              </Link>
            )}
            <Link
              href="/dashboard/token-stats"
              className="flex items-center text-sm text-primary-400 hover:text-primary-300 transition-colors"
            >
              查看详情
              <ArrowRight size={16} className="ml-1" />
            </Link>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <TokenStatCard title="总输入 Token" value={formatTokenNumber(tokenStats.totalInputTokens)} subtitle="发送给模型" icon={<TrendingUp size={22} />} color="from-blue-600 to-blue-700" />
          <TokenStatCard title="总输出 Token" value={formatTokenNumber(tokenStats.totalOutputTokens)} subtitle="模型返回" icon={<Activity size={22} />} color="from-green-600 to-green-700" />
          <TokenStatCard title="总 Token" value={formatTokenNumber(tokenStats.totalTokens)} subtitle="累计消耗" icon={<Coins size={22} />} color="from-purple-600 to-purple-700" />
          <TokenStatCard title="预估费用" value={`¥${tokenStats.estimatedCost.toFixed(2)}`} subtitle="累计成本" icon={<Shield size={22} />} color="from-orange-600 to-orange-700" tooltip="费用 = 输入Token × ¥6/百万 + 输出Token × ¥22/百万" />
          <TokenStatCard title="评估次数" value={tokenStats.evaluationCount} subtitle="累计执行" icon={<CheckCircle2 size={22} />} color="from-indigo-600 to-indigo-700" />
        </div>
      </div>
    </div>
  );
}

function formatTokenNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

function StatCard({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="bg-dark-surface rounded-xl border border-gray-700/50 p-5 hover:border-gray-600/50 transition-colors">
      <div className="flex items-center justify-between">
        <div className={`bg-gradient-to-br ${color} p-2.5 rounded-lg`}>
          <div className="text-white">{icon}</div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-gray-100">{value}</p>
          <p className="text-xs text-gray-400 mt-0.5">{title}</p>
        </div>
      </div>
    </div>
  );
}

function TokenStatCard({
  title,
  value,
  subtitle,
  icon,
  color,
  tooltip,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ReactNode;
  color: string;
  tooltip?: string;
}) {
  return (
    <div className="bg-dark-surface rounded-xl border border-gray-700/50 p-5 hover:border-gray-600/50 transition-colors">
      <div className="flex items-center justify-between">
        <div className={`bg-gradient-to-br ${color} p-2.5 rounded-lg`}>
          <div className="text-white">{icon}</div>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold text-gray-100">{value}</p>
          <p className="text-xs text-gray-400 mt-0.5 flex items-center justify-end">
            {title}
            {tooltip && (
              <span className="ml-1 cursor-help relative group">
                <Info size={12} className="text-gray-500 hover:text-gray-400" />
                <span className="absolute right-0 bottom-full mb-2 hidden group-hover:block bg-gray-800 text-gray-200 text-xs rounded-lg p-2 whitespace-nowrap z-10 shadow-xl border border-gray-700">
                  {tooltip}
                </span>
              </span>
            )}
          </p>
          <p className="text-[10px] text-gray-500 mt-0.5">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

function StatusItem({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const percentage = total > 0 ? (count / total) * 100 : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-300">{label}</span>
        <span className="text-sm text-gray-400">
          {count} ({percentage.toFixed(1)}%)
        </span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-2">
        <div
          className={`${color} h-2 rounded-full transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function SessionRow({
  session,
  getStatusText,
  getStatusBgColor,
  getProgressPercentage,
}: {
  session: Session;
  getStatusText: (status?: string) => string;
  getStatusBgColor: (status?: string) => string;
  getProgressPercentage: (session: Session) => number;
}) {
  const progress = getProgressPercentage(session);

  const evaluationStatus = session.evaluationStatus ||
    ((session.evaluations?.length ?? 0) > 0
      ? (session.evaluations![0]?.status === 'preparing' || session.evaluations![0]?.status === 'ready'
        ? 'waiting'
        : session.evaluations![0]?.status)
      : 'idle');

  const latestEvaluation = session.evaluations?.[0];
  const detailHref = latestEvaluation
    ? `/dashboard/sessions/${session.id}?evaluationId=${latestEvaluation.id}`
    : `/dashboard/sessions`;

  return (
    <div className="bg-dark-surface border border-gray-700/50 rounded-xl p-4 hover:border-primary-500/30 hover:bg-dark-surface-hover/50 transition-all">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-3">
            <h3 className="text-base font-semibold text-gray-100">
              {session.name || session.title || '未命名项目'}
            </h3>
            <span
              className={
                'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ' +
                getStatusBgColor(evaluationStatus)
              }
            >
              {getStatusText(evaluationStatus)}
            </span>
          </div>
          <p className="mt-2 text-sm text-gray-400">
            创建于 {formatBeijingTime(session.createdAt, 'short')}
          </p>
          {session.config && (
            <p className="mt-1 text-xs text-gray-500">
              配置: {session.config.name}
            </p>
          )}
        </div>
        <Link
          href={detailHref}
          className="flex items-center text-sm text-primary-400 hover:text-primary-300 transition-colors"
        >
          查看详情
          <ArrowRight size={16} className="ml-1" />
        </Link>
      </div>

      {session.messages && session.messages.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-400">任务进度</span>
            <span className="text-xs text-gray-500">{progress}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-1.5">
            <div
              className="bg-primary-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
