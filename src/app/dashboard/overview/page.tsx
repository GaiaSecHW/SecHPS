'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { extractErrorMessage } from '@/lib/api-client';
import dynamic from 'next/dynamic';

const QueueMonitor = dynamic(
  () => import('@/components/evaluation/QueueMonitor').then(m => ({ default: m.QueueMonitor })),
  { ssr: false }
);

interface TaskInstance {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface Stats {
  total: number;
  completed: number;
  failed: number;
  running: number;
  pending: number;
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
  const [stats, setStats] = useState<Stats>({ total: 0, completed: 0, failed: 0, running: 0, pending: 0 });
  const [vulnStats, setVulnStats] = useState<VulnerabilityStats>({ total: 0, pending: 0, confirmed: 0, fixed: 0, verified: 0, falsePositive: 0 });
  const [tokenStats, setTokenStats] = useState<TokenStats>({ totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, estimatedCost: 0, evaluationCount: 0, callCount: 0 });
  const [isAdmin, setIsAdmin] = useState(false);
  const [hasRunningTasks, setHasRunningTasks] = useState(false);

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
    const pollInterval = setInterval(fetchData, 5000);
    return () => clearInterval(pollInterval);
  }, [hasRunningTasks]);

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/task-builder/tasks?limit=1000', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const data = await response.json();
        setError(extractErrorMessage(data, '获取任务失败'));
        setLoading(false);
        return;
      }
      const data = await response.json();
      const taskList = data.tasks || [];
      setHasRunningTasks(taskList.some((t: TaskInstance) => t.status === 'running' || t.status === 'pending'));

      let completed = 0, failed = 0, running = 0, pending = 0;
      for (const task of taskList) {
        if (task.status === 'completed') completed++;
        else if (task.status === 'failed') failed++;
        else if (task.status === 'running') running++;
        else if (task.status === 'pending') pending++;
      }
      setStats({ total: taskList.length, completed, failed, running, pending });
      setLoading(false);
    } catch {
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
        const s = data.stats;
        setVulnStats({
          total: s.total || 0,
          pending: s.byStatus?.new || 0,
          confirmed: s.byStatus?.confirmed || 0,
          fixed: s.byStatus?.fixed || 0,
          verified: s.byStatus?.verified || 0,
          falsePositive: s.byStatus?.['false-positive'] || 0,
        });
      }
    } catch {}
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
    } catch {}
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-500/20 border-t-indigo-500"></div>
        <p className="text-sm text-dark-text-muted">加载中...</p>
      </div>
    );
  }

  const vulnProcessed = vulnStats.confirmed + vulnStats.fixed + vulnStats.verified + vulnStats.falsePositive;
  const vulnProgress = vulnStats.total > 0 ? (vulnProcessed / vulnStats.total * 100) : 0;

  return (
    <div className="space-y-8 w-full min-w-0">
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-300 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Hero: Task KPIs */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-medium text-dark-text">任务概览</h2>
          <Link href="/dashboard/task-builder" className="text-sm text-dark-text-muted hover:text-dark-text transition-colors">
            查看全部 →
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <KpiCard label="总任务" value={stats.total} />
          <KpiCard label="运行中" value={stats.running} status="active" pulse={stats.running > 0} />
          <KpiCard label="待执行" value={stats.pending} status="warning" />
          <KpiCard label="已完成" value={stats.completed} status="success" />
          <KpiCard label="失败" value={stats.failed} status="error" />
        </div>
      </section>

      {/* QueueMonitor (admin) */}
      {isAdmin && (
        <section className="rounded-xl overflow-hidden border border-dark-border/40">
          <QueueMonitor autoRefresh refreshInterval={10000} pageSize={5} />
        </section>
      )}

      {/* Two-column: Vulnerabilities + Resources */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <section className="lg:col-span-3 bg-dark-surface/60 border border-dark-border/40 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-base font-medium text-dark-text">漏洞分析</h2>
            <Link href="/dashboard/admin/vulnerabilities" className="text-sm text-dark-text-muted hover:text-dark-text transition-colors">
              管理 →
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5">
            <div><div className="text-2xl font-semibold text-dark-text tabular-nums">{vulnStats.total}</div><div className="text-sm text-dark-text-muted mt-0.5">总漏洞</div></div>
            <div><div className="text-2xl font-semibold text-amber-400 tabular-nums">{vulnStats.pending}</div><div className="text-sm text-dark-text-muted mt-0.5">待处理</div></div>
            <div><div className="text-2xl font-semibold text-indigo-400 tabular-nums">{vulnStats.confirmed}</div><div className="text-sm text-dark-text-muted mt-0.5">已确认</div></div>
            <div><div className="text-2xl font-semibold text-emerald-400 tabular-nums">{vulnStats.fixed}</div><div className="text-sm text-dark-text-muted mt-0.5">已修复</div></div>
            <div><div className="text-2xl font-semibold text-emerald-400 tabular-nums">{vulnStats.verified}</div><div className="text-sm text-dark-text-muted mt-0.5">已验证</div></div>
            <div><div className="text-2xl font-semibold text-dark-text-secondary tabular-nums">{vulnStats.falsePositive}</div><div className="text-sm text-dark-text-muted mt-0.5">误报</div></div>
          </div>
          {vulnStats.total > 0 && (
            <div className="mt-6 pt-5 border-t border-dark-border/30">
              <div className="flex items-center justify-between text-sm text-dark-text-muted mb-2.5">
                <span>处理进度</span>
                <span className="font-medium text-dark-text tabular-nums">{vulnProgress.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-dark-surface-hover rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-indigo-500 to-indigo-400 rounded-full transition-all duration-500" style={{ width: `${vulnProgress}%` }} />
              </div>
            </div>
          )}
        </section>

        <section className="lg:col-span-2 bg-dark-surface/60 border border-dark-border/40 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-base font-medium text-dark-text">资源消耗</h2>
            <Link href="/dashboard/token-stats" className="text-sm text-dark-text-muted hover:text-dark-text transition-colors">
              详情 →
            </Link>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between py-2"><span className="text-sm text-dark-text-muted">输入 Token</span><span className="text-sm font-medium text-dark-text tabular-nums">{formatNumber(tokenStats.totalInputTokens)}</span></div>
            <div className="flex items-center justify-between py-2"><span className="text-sm text-dark-text-muted">输出 Token</span><span className="text-sm font-medium text-dark-text tabular-nums">{formatNumber(tokenStats.totalOutputTokens)}</span></div>
            <div className="border-t border-dark-border/30" />
            <div className="flex items-center justify-between py-2"><span className="text-sm font-medium text-dark-text">总 Token</span><span className="text-base font-semibold text-dark-text tabular-nums">{formatNumber(tokenStats.totalTokens)}</span></div>
            <div className="flex items-center justify-between py-2"><span className="text-sm font-medium text-dark-text">预估费用</span><span className="text-base font-semibold text-dark-text tabular-nums">¥{tokenStats.estimatedCost.toFixed(2)}</span></div>
            <div className="border-t border-dark-border/30" />
            <div className="grid grid-cols-2 gap-4 pt-1">
              <div><div className="text-xl font-semibold text-dark-text tabular-nums">{tokenStats.evaluationCount}</div><div className="text-sm text-dark-text-muted mt-0.5">评估次数</div></div>
              <div><div className="text-xl font-semibold text-dark-text tabular-nums">{tokenStats.callCount}</div><div className="text-sm text-dark-text-muted mt-0.5">调用次数</div></div>
            </div>
          </div>
        </section>
      </div>

      {/* System Status */}
      <section className="flex flex-wrap items-center gap-x-8 gap-y-3 px-1">
        <StatusDot label="数据库" ok />
        <StatusDot label="任务引擎" ok active={stats.running > 0} detail={stats.running > 0 ? '运行中' : '就绪'} />
        <StatusDot label="队列" ok={stats.pending === 0} detail={stats.pending > 0 ? `${stats.pending} 待执行` : '空闲'} />
      </section>
    </div>
  );
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

function KpiCard({ label, value, status, pulse }: { label: string; value: number; status?: 'active' | 'warning' | 'success' | 'error'; pulse?: boolean }) {
  const statusColors = { active: 'text-indigo-400', warning: 'text-amber-400', success: 'text-emerald-400', error: 'text-red-400' };
  const borderAccent = { active: 'border-indigo-500/30', warning: 'border-amber-500/20', success: 'border-emerald-500/20', error: 'border-red-500/20' };
  const valueColor = status && value > 0 ? statusColors[status] : 'text-dark-text';
  const border = status && value > 0 ? borderAccent[status] : 'border-dark-border/40';
  return (
    <div className={`bg-dark-surface/60 border ${border} rounded-xl px-5 py-4 relative overflow-hidden`}>
      {pulse && <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />}
      <div className={`text-3xl font-semibold ${valueColor} tabular-nums leading-none`}>{value}</div>
      <div className="text-sm text-dark-text-muted mt-2">{label}</div>
    </div>
  );
}

function StatusDot({ label, ok, active, detail }: { label: string; ok: boolean; active?: boolean; detail?: string }) {
  const dotClass = active ? 'bg-indigo-400 animate-pulse' : ok ? 'bg-emerald-400' : 'bg-amber-400';
  return (
    <div className="flex items-center gap-2">
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
      <span className="text-sm text-dark-text-muted">{label}</span>
      {detail && <span className="text-sm text-dark-text-secondary">{detail}</span>}
    </div>
  );
}