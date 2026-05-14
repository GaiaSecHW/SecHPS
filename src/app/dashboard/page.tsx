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
  Zap,
  Target,
  BarChart3,
  Play,
  Pause,
  LayoutDashboard,
} from 'lucide-react';
import { formatBeijingTime } from '@/lib/beijing-time';
import { extractErrorMessage } from '@/lib/api-client';
import dynamic from 'next/dynamic';
const QueueMonitor = dynamic(() => import('@/components/evaluation/QueueMonitor').then(m => ({ default: m.QueueMonitor })), { ssr: false });

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
        setError(extractErrorMessage(data, '获取任务失败'));
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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <div className="relative">
          <div className="animate-spin rounded-full h-12 w-12 border-2 border-cyan-500/20 border-t-cyan-500"></div>
        </div>
        <p className="text-sm text-gray-400">正在加载仪表盘数据...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-gradient-to-br from-primary-400 to-primary-600 rounded-lg flex items-center justify-center">
              <LayoutDashboard size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">
                安全评估数据看板
              </h1>
              <p className="text-sm text-gray-400 mt-0.5">
                实时监控任务状态与评估进度
              </p>
            </div>
          </div>
          <Link
            href="/dashboard/sessions"
            className="group flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 bg-primary-500 text-white shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:bg-primary-400"
          >
            <Play size={16} className="transition-transform group-hover:rotate-90 duration-200" />
            <span>创建评估</span>
          </Link>
        </div>
      </header>

      {error && (
        <div className="bg-red-900/20 border border-red-500/30 text-red-300 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Main Layout - Bento Grid */}
      <div className="grid grid-cols-12 gap-5">
        {/* Left Section - 8 cols */}
        <div className="col-span-12 lg:col-span-8 space-y-5">
          {/* Task Statistics */}
          <section className="bg-dark-surface border border-gray-700/50 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Target size={18} className="text-cyan-400" />
                <h2 className="text-base font-semibold text-white">任务概览</h2>
              </div>
              <Link
                href="/dashboard/sessions"
                className="flex items-center gap-1.5 px-3 py-1 text-sm text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 rounded-lg transition-colors"
              >
                <span>查看全部</span>
                <ArrowRight size={14} />
              </Link>
            </div>

            <div className="grid grid-cols-5 gap-3">
              <MetricCard
                label="总任务"
                value={stats.total}
                icon={<MessageSquare size={20} />}
                color="violet"
              />
              <MetricCard
                label="运行中"
                value={stats.runningEvaluations}
                icon={<Activity size={20} />}
                color="cyan"
                active={stats.runningEvaluations > 0}
              />
              <MetricCard
                label="队列中"
                value={stats.queuedEvaluations}
                icon={<Hourglass size={20} />}
                color="amber"
              />
              <MetricCard
                label="已完成"
                value={stats.completed}
                icon={<CheckCircle2 size={20} />}
                color="emerald"
              />
              <MetricCard
                label="失败"
                value={stats.failed}
                icon={<XCircle size={20} />}
                color="rose"
              />
            </div>
          </section>

          {/* Queue Monitor */}
          {isAdmin && (
            <section className="bg-dark-surface border border-gray-700/50 rounded-xl overflow-hidden">
              <QueueMonitor autoRefresh refreshInterval={10000} pageSize={5} />
            </section>
          )}

          {/* Vulnerability Stats */}
          <section className="bg-dark-surface border border-gray-700/50 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Shield size={18} className="text-purple-400" />
                <h2 className="text-base font-semibold text-white">漏洞分析</h2>
                {isAdmin && (
                  <span className="px-2 py-0.5 text-xs bg-purple-500/15 text-purple-300 rounded">
                    全局视图
                  </span>
                )}
              </div>
              <Link
                href="/dashboard/admin/vulnerabilities"
                className="flex items-center gap-1.5 px-3 py-1 text-sm text-purple-400 hover:text-purple-300 bg-purple-500/10 rounded-lg transition-colors"
              >
                <span>漏洞管理</span>
                <ArrowRight size={14} />
              </Link>
            </div>

            <div className="grid grid-cols-6 gap-3">
              <CompactMetric label="总漏洞" value={vulnStats.total} color="purple" />
              <CompactMetric label="待处理" value={vulnStats.pending} color="gray" />
              <CompactMetric label="已确认" value={vulnStats.confirmed} color="amber" />
              <CompactMetric label="已修复" value={vulnStats.fixed} color="emerald" />
              <CompactMetric label="已验证" value={vulnStats.verified} color="cyan" />
              <CompactMetric label="误报" value={vulnStats.falsePositive} color="rose" />
            </div>

            {/* Vulnerability Progress Bar */}
            {vulnStats.total > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-700/50">
                <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
                  <span>处理进度</span>
                  <span>{((vulnStats.confirmed + vulnStats.fixed + vulnStats.verified + vulnStats.falsePositive) / vulnStats.total * 100).toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-gray-700/50 rounded-full flex gap-0.5 overflow-hidden">
                  <div className="bg-amber-500 h-full" style={{ width: `${vulnStats.confirmed / vulnStats.total * 100}%` }}></div>
                  <div className="bg-emerald-500 h-full" style={{ width: `${vulnStats.fixed / vulnStats.total * 100}%` }}></div>
                  <div className="bg-cyan-500 h-full" style={{ width: `${vulnStats.verified / vulnStats.total * 100}%` }}></div>
                  <div className="bg-rose-500 h-full" style={{ width: `${vulnStats.falsePositive / vulnStats.total * 100}%` }}></div>
                </div>
                <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-500 rounded-full"></span>已确认</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded-full"></span>已修复</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 bg-cyan-500 rounded-full"></span>已验证</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 bg-rose-500 rounded-full"></span>误报</span>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Right Section - 4 cols */}
        <div className="col-span-12 lg:col-span-4 space-y-5">
          {/* Token Consumption */}
          <section className="bg-dark-surface border border-gray-700/50 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Coins size={18} className="text-amber-400" />
                <h2 className="text-base font-semibold text-white">资源消耗</h2>
                {isAdmin && (
                  <span className="px-2 py-0.5 text-xs bg-amber-500/15 text-amber-300 rounded">
                    全局视图
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <TokenRow
                label="输入 Token"
                value={formatNumber(tokenStats.totalInputTokens)}
                icon={<TrendingUp size={16} />}
                color="cyan"
              />
              <TokenRow
                label="输出 Token"
                value={formatNumber(tokenStats.totalOutputTokens)}
                icon={<Activity size={16} />}
                color="emerald"
              />
              <div className="h-px bg-gray-700/50 my-2"></div>
              <TokenRow
                label="总 Token"
                value={formatNumber(tokenStats.totalTokens)}
                icon={<Coins size={16} />}
                color="amber"
                highlight
              />
              <TokenRow
                label="预估费用"
                value={`¥${tokenStats.estimatedCost.toFixed(2)}`}
                icon={<Zap size={16} />}
                color="orange"
                highlight
              />
              <TokenRow
                label="评估次数"
                value={tokenStats.evaluationCount.toString()}
                icon={<CheckCircle2 size={16} />}
                color="purple"
              />
            </div>

            <div className="mt-4 pt-4 border-t border-gray-700/50 grid grid-cols-2 gap-2">
              {isAdmin && (
                <Link
                  href="/dashboard/token-stats/users"
                  className="flex items-center justify-center gap-2 px-3 py-2 text-sm text-cyan-400 bg-cyan-500/10 rounded-lg hover:bg-cyan-500/20 transition-colors"
                >
                  <Users size={14} />
                  用户统计
                </Link>
              )}
              <Link
                href="/dashboard/token-stats"
                className="flex items-center justify-center gap-2 px-3 py-2 text-sm text-gray-300 bg-gray-700/30 rounded-lg hover:bg-gray-700/50 transition-colors"
              >
                <BarChart3 size={14} />
                详细报表
              </Link>
            </div>
          </section>

          {/* Quick Actions */}
          <section className="bg-dark-surface border border-gray-700/50 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={18} className="text-cyan-400" />
              <h2 className="text-base font-semibold text-white">快捷入口</h2>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <QuickLink href="/dashboard/sessions" label="评估任务" icon={<Play size={18} />} color="cyan" />
              <QuickLink href="/dashboard/skills" label="Skill 库" icon={<Shield size={18} />} color="purple" />
              <QuickLink href="/dashboard/models" label="模型管理" icon={<Zap size={18} />} color="amber" />
              <QuickLink href="/dashboard/workflows" label="编排设计" icon={<BarChart3 size={18} />} color="emerald" />
            </div>
          </section>

          {/* System Status Mini */}
          <section className="bg-dark-surface border border-gray-700/50 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Activity size={18} className="text-emerald-400" />
              <h2 className="text-base font-semibold text-white">系统状态</h2>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">数据库连接</span>
                <span className="flex items-center gap-1.5 text-sm text-emerald-400">
                  <span className="w-2 h-2 bg-emerald-400 rounded-full"></span>
                  正常
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">评估引擎</span>
                <span className={`flex items-center gap-1.5 text-sm ${stats.runningEvaluations > 0 ? 'text-cyan-400' : 'text-emerald-400'}`}>
                  <span className={`w-2 h-2 rounded-full ${stats.runningEvaluations > 0 ? 'bg-cyan-400 animate-pulse' : 'bg-emerald-400'}`}></span>
                  {stats.runningEvaluations > 0 ? '运行中' : '就绪'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">队列状态</span>
                <span className={`flex items-center gap-1.5 text-sm ${stats.queuedEvaluations > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  <span className={`w-2 h-2 rounded-full ${stats.queuedEvaluations > 0 ? 'bg-amber-400' : 'bg-emerald-400'}`}></span>
                  {stats.queuedEvaluations > 0 ? `${stats.queuedEvaluations} 待执行` : '空闲'}
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

function MetricCard({
  label,
  value,
  icon,
  color,
  active = false,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  active?: boolean;
}) {
  const styles: Record<string, { bg: string; iconBg: string; text: string }> = {
    violet: { bg: 'bg-violet-500/10', iconBg: 'bg-gradient-to-br from-violet-400 to-purple-500', text: 'text-violet-400' },
    cyan: { bg: 'bg-cyan-500/10', iconBg: 'bg-gradient-to-br from-cyan-400 to-blue-500', text: 'text-cyan-400' },
    amber: { bg: 'bg-amber-500/10', iconBg: 'bg-gradient-to-br from-amber-400 to-orange-500', text: 'text-amber-400' },
    emerald: { bg: 'bg-emerald-500/10', iconBg: 'bg-gradient-to-br from-emerald-400 to-green-500', text: 'text-emerald-400' },
    rose: { bg: 'bg-rose-500/10', iconBg: 'bg-gradient-to-br from-rose-400 to-red-500', text: 'text-rose-400' },
  };

  const style = styles[color] || styles.cyan;

  return (
    <div className={`${style.bg} rounded-lg p-3.5 border border-gray-700/30`}>
      <div className="flex items-center justify-between mb-2">
        <div className={`w-8 h-8 ${style.iconBg} rounded-lg flex items-center justify-center`}>
          <div className="text-white">{icon}</div>
        </div>
        {active && <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></span>}
      </div>
      <div className="text-xl font-bold text-white">{value}</div>
      <div className={`text-xs ${style.text} mt-0.5`}>{label}</div>
    </div>
  );
}

function CompactMetric({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const colors: Record<string, string> = {
    purple: 'bg-purple-500/15 text-purple-300',
    gray: 'bg-gray-500/15 text-gray-300',
    amber: 'bg-amber-500/15 text-amber-300',
    emerald: 'bg-emerald-500/15 text-emerald-300',
    cyan: 'bg-cyan-500/15 text-cyan-300',
    rose: 'bg-rose-500/15 text-rose-300',
  };

  return (
    <div className={`${colors[color]} rounded-lg p-2.5 text-center`}>
      <div className="text-base font-bold">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

function TokenRow({
  label,
  value,
  icon,
  color,
  highlight = false,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
  highlight?: boolean;
}) {
  const colors: Record<string, string> = {
    cyan: 'text-cyan-400',
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    orange: 'text-orange-400',
    purple: 'text-purple-400',
  };

  return (
    <div className={`flex items-center justify-between ${highlight ? 'py-1.5 bg-gray-700/20 rounded px-2' : ''}`}>
      <div className="flex items-center gap-2">
        <div className={`${colors[color]} opacity-60`}>{icon}</div>
        <span className="text-sm text-gray-300">{label}</span>
      </div>
      <span className={`text-base font-semibold ${highlight ? colors[color] : 'text-white'}`}>{value}</span>
    </div>
  );
}

function QuickLink({
  href,
  label,
  icon,
  color,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  color: string;
}) {
  const colors: Record<string, { bg: string; text: string }> = {
    cyan: { bg: 'bg-cyan-500/10 hover:bg-cyan-500/20', text: 'text-cyan-400' },
    purple: { bg: 'bg-purple-500/10 hover:bg-purple-500/20', text: 'text-purple-400' },
    amber: { bg: 'bg-amber-500/10 hover:bg-amber-500/20', text: 'text-amber-400' },
    emerald: { bg: 'bg-emerald-500/10 hover:bg-emerald-500/20', text: 'text-emerald-400' },
  };

  const style = colors[color] || colors.cyan;

  return (
    <Link
      href={href}
      className={`flex flex-col items-center justify-center gap-2 p-3 rounded-lg ${style.bg} ${style.text} border border-gray-700/30 transition-colors`}
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </Link>
  );
}