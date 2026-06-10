'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  CheckCircle2,
  XCircle,
  TrendingUp,
  MessageSquare,
  ArrowRight,
  Shield,
  Bug,
  Hourglass,
  Coins,
  Users,
  Zap,
  Target,
  BarChart3,
  ClipboardList,
  Brain,
  Layers,
} from 'lucide-react';
import { extractErrorMessage } from '@/lib/api-client';
import dynamic from 'next/dynamic';
const QueueMonitor = dynamic(() => import('@/components/evaluation/QueueMonitor').then(m => ({ default: m.QueueMonitor })), { ssr: false });

interface Stats {
  total: number;
  completed: number;
  failed: number;
  running: number;
  pending: number;
  queued: number;
  dispatched: number;
  executing: number;
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

export default function OverviewPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<Stats>({
    total: 0,
    completed: 0,
    failed: 0,
    running: 0,
    pending: 0,
    queued: 0,
    dispatched: 0,
    executing: 0,
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
  const [hasRunningTasks, setHasRunningTasks] = useState(false);
  const [showRunningDetail, setShowRunningDetail] = useState(false);

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
    if (!hasRunningTasks) return;
    const pollInterval = setInterval(() => {
      fetchData();
    }, 5000);
    return () => clearInterval(pollInterval);
  }, [hasRunningTasks]);

  useEffect(() => {
    if (!showRunningDetail) return;
    const handler = () => setShowRunningDetail(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showRunningDetail]);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/task-builder/stats', {
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
      const s = data.stats;

      setHasRunningTasks((s.queued + s.dispatched + s.executing) > 0);

      setStats({
        total: s.total,
        completed: s.completed,
        failed: s.failed,
        running: s.queued + s.dispatched + s.executing,
        pending: s.pending,
        queued: s.queued,
        dispatched: s.dispatched,
        executing: s.executing,
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
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="relative">
          <div className="animate-spin rounded-full h-12 w-12 border-2 border-cyan-500/20 border-t-cyan-500"></div>
        </div>
        <p className="text-sm text-zinc-400">正在加载仪表盘数据...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 md:space-y-6 w-full min-w-0">
      <header className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 md:px-5 py-3 md:py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 md:gap-4 min-w-0">
            <div className="w-9 md:w-10 h-9 md:h-10 bg-gradient-to-br from-cyan-400 to-cyan-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <Target size={18} className="text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg md:text-xl font-semibold text-zinc-100 truncate">
                安全评估数据看板
              </h1>
              <p className="text-sm text-zinc-400 truncate">
                实时监控任务状态与评估进度
              </p>
            </div>
          </div>
          <Link
            href="/dashboard/task-builder"
            className="group flex items-center gap-2 px-3 md:px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 bg-cyan-500 text-white shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:bg-cyan-400 flex-shrink-0"
          >
            <Zap size={16} className="transition-transform group-hover:rotate-90 duration-200" />
            <span className="hidden sm:inline">创建任务</span>
            <span className="sm:hidden">创建</span>
          </Link>
        </div>
      </header>

      {error && (
        <div className="bg-red-900/20 border border-red-500/30 text-red-300 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-5 w-full">
        <div className="lg:col-span-8 xl:col-span-9 space-y-4 md:space-y-5 min-w-0">
          <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 md:p-5">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <Target size={18} className="text-cyan-400 flex-shrink-0" />
                <h2 className="text-base font-semibold text-zinc-100">任务概览</h2>
              </div>
              <Link
                href="/dashboard/task-builder"
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 rounded-lg transition-colors flex-shrink-0"
              >
                <span className="hidden md:inline">查看全部</span>
                <span className="md:hidden">全部</span>
                <ArrowRight size={14} />
              </Link>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 md:gap-3">
              <MetricCard
                label="总任务"
                value={stats.total}
                icon={<MessageSquare size={18} />}
                color="violet"
              />
              <div className="relative">
                <MetricCard
                  label="运行中"
                  value={stats.running}
                  icon={<Activity size={18} />}
                  color="cyan"
                  active={stats.running > 0}
                  onClick={() => stats.running > 0 && setShowRunningDetail(v => !v)}
                  clickable={stats.running > 0}
                />
                {showRunningDetail && stats.running > 0 && (
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl p-3 min-w-[160px]" onClick={e => e.stopPropagation()}>
                    <div className="text-xs text-zinc-400 mb-2 text-center font-medium">运行中详情</div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-zinc-300">排队中</span>
                        <span className="text-xs font-semibold text-amber-400">{stats.queued}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-zinc-300">已分发</span>
                        <span className="text-xs font-semibold text-blue-400">{stats.dispatched}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-zinc-300">执行中</span>
                        <span className="text-xs font-semibold text-cyan-400">{stats.executing}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <MetricCard
                label="待执行"
                value={stats.pending}
                icon={<Hourglass size={18} />}
                color="amber"
              />
              <MetricCard
                label="已完成"
                value={stats.completed}
                icon={<CheckCircle2 size={18} />}
                color="emerald"
              />
              <MetricCard
                label="失败"
                value={stats.failed}
                icon={<XCircle size={18} />}
                color="rose"
              />
            </div>
          </section>

          {isAdmin && (
            <section className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden min-h-0">
              <QueueMonitor autoRefresh refreshInterval={10000} pageSize={5} />
            </section>
          )}

          <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 md:p-5">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <Shield size={18} className="text-purple-400 flex-shrink-0" />
                <h2 className="text-base font-semibold text-zinc-100">漏洞分析</h2>
                {isAdmin && (
                  <span className="px-2 py-0.5 text-xs bg-purple-500/15 text-purple-300 rounded hidden sm:inline-flex">
                    全局视图
                  </span>
                )}
              </div>
              {isAdmin && (
                <Link
                  href="/dashboard/admin/vulnerabilities"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-purple-400 hover:text-purple-300 bg-purple-500/10 rounded-lg transition-colors flex-shrink-0"
                >
                  <span className="hidden md:inline">漏洞管理</span>
                  <span className="md:hidden">管理</span>
                  <ArrowRight size={14} />
                </Link>
              )}
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 md:gap-3">
              <CompactMetric label="总漏洞" value={vulnStats.total} color="purple" />
              <CompactMetric label="待处理" value={vulnStats.pending} color="gray" />
              <CompactMetric label="已确认" value={vulnStats.confirmed} color="amber" />
              <CompactMetric label="已修复" value={vulnStats.fixed} color="emerald" />
              <CompactMetric label="已验证" value={vulnStats.verified} color="cyan" />
              <CompactMetric label="误报" value={vulnStats.falsePositive} color="rose" />
            </div>

            {vulnStats.total > 0 && (
              <div className="mt-4 pt-4 border-t border-zinc-800">
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-2">
                  <span>处理进度</span>
                  <span>{((vulnStats.confirmed + vulnStats.fixed + vulnStats.verified + vulnStats.falsePositive) / vulnStats.total * 100).toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full flex gap-0.5 overflow-hidden">
                  <div className="bg-amber-500 h-full transition-all" style={{ width: `${vulnStats.confirmed / vulnStats.total * 100}%` }}></div>
                  <div className="bg-emerald-500 h-full transition-all" style={{ width: `${vulnStats.fixed / vulnStats.total * 100}%` }}></div>
                  <div className="bg-cyan-500 h-full transition-all" style={{ width: `${vulnStats.verified / vulnStats.total * 100}%` }}></div>
                  <div className="bg-rose-500 h-full transition-all" style={{ width: `${vulnStats.falsePositive / vulnStats.total * 100}%` }}></div>
                </div>
                <div className="flex items-center gap-3 md:gap-4 mt-2 text-xs text-zinc-500 flex-wrap">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-500 rounded-full"></span>已确认</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded-full"></span>已修复</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 bg-cyan-500 rounded-full"></span>已验证</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 bg-rose-500 rounded-full"></span>误报</span>
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="lg:col-span-4 xl:col-span-3 space-y-4 md:space-y-5 min-w-0">
          <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 md:p-5">
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2 min-w-0">
                <Coins size={18} className="text-amber-400 flex-shrink-0" />
                <h2 className="text-base font-semibold text-zinc-100">资源消耗</h2>
                {isAdmin && (
                  <span className="px-2 py-0.5 text-xs bg-amber-500/15 text-amber-300 rounded hidden sm:inline-flex">
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
              <div className="h-px bg-zinc-800 my-2"></div>
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

            <div className="mt-4 pt-4 border-t border-zinc-800 grid grid-cols-2 gap-2">
              {isAdmin && (
                <Link
                  href="/dashboard/token-stats/users"
                  className="flex items-center justify-center gap-2 px-3 py-2 text-sm text-cyan-400 bg-cyan-500/10 rounded-lg hover:bg-cyan-500/20 transition-colors"
                >
                  <Users size={14} />
                  <span className="hidden md:inline">用户统计</span>
                  <span className="md:hidden">用户</span>
                </Link>
              )}
              <Link
                href="/dashboard/token-stats"
                className={`flex items-center justify-center gap-2 px-3 py-2 text-sm text-zinc-300 bg-zinc-800/50 rounded-lg hover:bg-zinc-800 transition-colors ${isAdmin ? '' : 'col-span-2'}`}
              >
                <BarChart3 size={14} />
                <span className="hidden md:inline">详细报表</span>
                <span className="md:hidden">报表</span>
              </Link>
            </div>
          </section>

          <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 md:p-5">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={18} className="text-cyan-400 flex-shrink-0" />
              <h2 className="text-base font-semibold text-zinc-100">快捷入口</h2>
            </div>

            <div className="grid grid-cols-2 gap-2 md:gap-3">
              <QuickLink href="/dashboard/task-builder" label="我的任务" icon={<ClipboardList size={16} />} color="cyan" />
              <QuickLink href="/dashboard/skills" label="Skills 库" icon={<Shield size={16} />} color="purple" />
              <QuickLink href="/dashboard/models" label="我的模型" icon={<Brain size={16} />} color="amber" />
              <QuickLink href="/dashboard/agentflow-pipelines" label="工作流" icon={<Layers size={16} />} color="emerald" />
            </div>
          </section>

          <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 md:p-5">
            <div className="flex items-center gap-2 mb-4">
              <Activity size={18} className="text-emerald-400 flex-shrink-0" />
              <h2 className="text-base font-semibold text-zinc-100">系统状态</h2>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-zinc-400 truncate">数据库连接</span>
                <span className="flex items-center gap-1.5 text-sm text-emerald-400 flex-shrink-0">
                  <span className="w-2 h-2 bg-emerald-400 rounded-full"></span>
                  正常
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-zinc-400 truncate">任务引擎</span>
                <span className={`flex items-center gap-1.5 text-sm flex-shrink-0 ${stats.running > 0 ? 'text-cyan-400' : 'text-emerald-400'}`}>
                  <span className={`w-2 h-2 rounded-full ${stats.running > 0 ? 'bg-cyan-400 animate-pulse' : 'bg-emerald-400'}`}></span>
                  {stats.running > 0 ? '运行中' : '就绪'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-zinc-400 truncate">待执行任务</span>
                <span className={`flex items-center gap-1.5 text-sm flex-shrink-0 ${stats.pending > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  <span className={`w-2 h-2 rounded-full ${stats.pending > 0 ? 'bg-amber-400' : 'bg-emerald-400'}`}></span>
                  {stats.pending > 0 ? `${stats.pending} 待执行` : '空闲'}
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
  onClick,
  clickable = false,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  active?: boolean;
  onClick?: () => void;
  clickable?: boolean;
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
    <div
      className={`${style.bg} rounded-lg p-3 md:p-3.5 border border-zinc-800/50 min-w-0 ${clickable ? 'cursor-pointer hover:border-cyan-500/30 transition-colors' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-2">
        <div className={`w-7 h-7 md:w-8 md:h-8 ${style.iconBg} rounded-lg flex items-center justify-center flex-shrink-0`}>
          <div className="text-white text-sm">{icon}</div>
        </div>
        {active && <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse flex-shrink-0"></span>}
      </div>
      <div className="text-lg md:text-xl font-bold text-zinc-100 truncate">{value}</div>
      <div className={`text-xs ${style.text} mt-0.5 truncate`}>{label}</div>
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
    gray: 'bg-zinc-700/50 text-zinc-300',
    amber: 'bg-amber-500/15 text-amber-300',
    emerald: 'bg-emerald-500/15 text-emerald-300',
    cyan: 'bg-cyan-500/15 text-cyan-300',
    rose: 'bg-rose-500/15 text-rose-300',
  };

  return (
    <div className={`${colors[color]} rounded-lg p-2 md:p-2.5 text-center min-w-0`}>
      <div className="text-sm md:text-base font-bold truncate">{value}</div>
      <div className="text-xs text-zinc-500 mt-0.5 truncate">{label}</div>
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
    <div className={`flex items-center justify-between gap-2 min-w-0 ${highlight ? 'py-1.5 bg-zinc-800/50 rounded px-2' : ''}`}>
      <div className="flex items-center gap-2 min-w-0">
        <div className={`${colors[color]} opacity-60 flex-shrink-0`}>{icon}</div>
        <span className="text-sm text-zinc-300 truncate">{label}</span>
      </div>
      <span className={`text-sm md:text-base font-semibold flex-shrink-0 ${highlight ? colors[color] : 'text-zinc-100'}`}>{value}</span>
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
      className={`flex flex-col items-center justify-center gap-1.5 md:gap-2 p-2 md:p-3 rounded-lg ${style.bg} ${style.text} border border-zinc-800/50 transition-colors min-w-0`}
    >
      <span className="flex-shrink-0">{icon}</span>
      <span className="text-xs md:text-sm font-medium truncate">{label}</span>
    </Link>
  );
}