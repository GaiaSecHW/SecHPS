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
} from 'lucide-react';

interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status?: string;
  config?: any;
  messages?: any[];
}

interface Stats {
  total: number;
  running: number;
  completed: number;
  failed: number;
  waiting: number;
}

interface VulnerabilityStats {
  total: number;
  pending: number;
  confirmed: number;
  fixed: number;
  verified: number;
  falsePositive: number;
}

export default function DashboardPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<Stats>({
    total: 0,
    running: 0,
    completed: 0,
    failed: 0,
    waiting: 0,
  });
  const [vulnStats, setVulnStats] = useState<VulnerabilityStats>({
    total: 0,
    pending: 0,
    confirmed: 0,
    fixed: 0,
    verified: 0,
    falsePositive: 0,
  });

  useEffect(() => {
    fetchData();
    fetchVulnStats();
  }, []);

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
        setError(data.error || '获取项目失败');
        setLoading(false);
        return;
      }

      const data = await response.json();
      const projectList = data.projects || [];
      setSessions(projectList);

      // 计算统计数据
      const running = projectList.filter((s: Session) => s.status === 'running').length;
      const completed = projectList.filter((s: Session) => s.status === 'completed').length;
      const failed = projectList.filter((s: Session) => s.status === 'failed').length;
      const waiting = projectList.length - running - completed - failed;

      const newStats = {
        total: projectList.length,
        running,
        completed,
        failed,
        waiting,
      };
      setStats(newStats);
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
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        const stats = data.stats;

        const newVulnStats = {
          total: stats.total || 0,
          pending: stats.byStatus?.new || 0,
          confirmed: stats.byStatus?.confirmed || 0,
          fixed: stats.byStatus?.fixed || 0,
          verified: stats.byStatus?.verified || 0,
          falsePositive: stats.byStatus?.['false-positive'] || 0,
        };
        setVulnStats(newVulnStats);
      }
    } catch (err) {
      console.error('获取漏洞统计失败:', err);
    }
  };

  const getStatusText = (status?: string) => {
    switch (status) {
      case 'running':
        return '运行中';
      case 'completed':
        return '已完成';
      case 'failed':
        return '失败';
      default:
        return '等待中';
    }
  };

  const getStatusBgColor = (status?: string) => {
    switch (status) {
      case 'running':
        return 'bg-blue-50 text-blue'700 border-blue-200';
      case 'completed':
        return 'bg-green-50 text-green-700 border-green-200';
      case 'failed':
        return 'bg-red-50 text-red-700 border-red-200';
      default:
        return 'bg-yellow-50 text-yellow-700 border-yellow-200';
    }
  };

  const getProgressPercentage = (session: Session) => {
    if (!session.messages || session.messages.length === 0) return 0;
    // 简单的进度计算：根据消息数量
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
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">数据看板</h1>
          <p className="mt-2 text-sm text-gray-600">
            实时监控项目状态和任务进度
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* 统计卡片 - 项目统计 */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <MessageSquare size={20} className="mr-2 text-primary-500" />
          项目统计
        </h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard
            title="总项目数"
            value={stats.total}
            icon={<MessageSquare size={24} />}
            color="bg-primary-500"
            bgColor="bg-primary-50"
            textColor="text-primary-700"
          />
          <StatCard
            title="运行中"
            value={stats.running}
            icon={<Activity size={24} />}
            color="bg-blue-500"
            bgColor="bg-blue-50"
            textColor="text-blue-700"
          />
          <StatCard
            title="等待中"
            value={stats.waiting}
            icon={<Hourglass size={24} />}
            color="bg-yellow-500"
            bgColor="bg-yellow-50"
            textColor="text-yellow-700"
          />
          <StatCard
            title="已完成"
            value={stats.completed}
            icon={<CheckCircle2 size={24} />}
            color="bg-green-500"
            bgColor="bg-green-50"
            textColor="text-green-700"
          />
          <StatCard
            title="失败"
            value={stats.failed}
            icon={<XCircle size={24} />}
            color="bg-red-500"
            bgColor="bg-red-50"
            textColor="text-red-700"
          />
        </div>
      </div>

      {/* 统计卡片 - 漏洞统计 */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <Shield size={20} className="mr-2 text-primary-500" />
          漏洞统计
        </h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-6">
          <StatCard
            title="总漏洞数"
            value={vulnStats.total}
            icon={<Bug size={24} />}
            color="bg-purple-500"
            bgColor="bg-purple-50"
            textColor="text-purple-700"
          />
          <StatCard
            title="待处理"
            value={vulnStats.pending}
            icon={<Clock size={24} />}
            color="bg-gray-500"
            bgColor="bg-gray-50"
            textColor="text-gray-700"
          />
          <StatCard
            title="已确认"
            value={vulnStats.confirmed}
            icon={<CheckCircle2 size={24} />}
            color="bg-yellow-500"
            bgColor="bg-yellow-50"
            textColor="text-yellow-700"
          />
          <StatCard
            title="已修复"
            value={vulnStats.fixed}
            icon={<Shield size={24} />}
            color="bg-green-500"
            bgColor="bg-green-50"
            textColor="text-green-700"
          />
          <StatCard
            title="已验证"
            value={vulnStats.verified}
            icon={<TrendingUp size={24} />}
            color="bg-blue-500"
            bgColor="bg-blue-50"
            textColor="text-blue-700"
          />
          <StatCard
            title="误报"
            value={vulnStats.falsePositive}
            icon={<XCircle size={24} />}
            color="bg-orange-500"
            bgColor="bg-orange-50"
            textColor="text-orange-700"
          />
        </div>
      </div>

      {/* 项目状态分布 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <TrendingUp size={20} className="mr-2 text-primary-500" />
          项目状态分布
        </h2>
        {stats.total === 0 ? (
          <p className="text-gray-500 text-center py-8">暂无数据</p>
        ) : (
          <div className="space-y-4">
            <StatusItem
              label="运行中"
              count={stats.running}
              total={stats.total}
              color="bg-blue-500"
            />
            <StatusItem
              label="等待中"
              count={stats.waiting}
              total={stats.total}
              color="bg-yellow-500"
            />
            <StatusItem
              label="已完成"
              count={stats.completed}
              total={stats.total}
              color="bg-green-500"
            />
            <StatusItem
              label="失败"
              count={stats.failed}
              total={stats.total}
              color="bg-red-500"
            />
          </div>
        )}
      </div>

      {/* 最近项目列表 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center">
            <Clock size={20} className="mr-2 text-primary-500" />
            最近项目
          </h2>
          <Link
            href="/dashboard/sessions"
            className="flex items-center text-sm text-primary-600 hover:text-primary-800 transition-colors"
          >
            查看全部
            <ArrowRight size={16} className="ml-1" />
          </Link>
        </div>

        {sessions.length === 0 ? (
          <div className="text-center py-12">
            <MessageSquare className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-4 text-lg font-medium text-gray-900">
              暂无项目
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              创建您的第一个项目开始使用 AI4WEB
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {sessions.slice(0, 5).map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                getStatusText={getStatusText}
                getStatusBgColor={getStatusBgColor}
                getProgressPercentage={getProgressPercentage}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );

function StatCard({
  title,
  value,
  icon,
  color,
  bgColor,
  textColor,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  textColor: string;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <div className={color + ' p-3 rounded-lg'}>
          <div className={textColor}>{icon}</div>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-gray-900">{value}</p>
          <p className="text-sm text-gray-600 mt-1">{title}</p>
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
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <span className="text-sm text-gray-600">
          {count} ({percentage.toFixed(1)}%)
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2.5">
        <div
          className={color + ' h-2.5 rounded-full transition-all duration-500'}
          style={{ width: `${percentage}%` }}
        ></div>
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
  const' progress = getProgressPercentage(session);

  return (
    <div className="border border-gray-200 rounded-lg p-4 hover:border-primary-300 hover:bg-primary-50/30 transition-all">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-3">
            <h3 className="text-base font-semibold text-gray-900">
              {session.title || '未命名项目'}
            </h3>
            <span
              className={
                'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ' +
                getStatusBgColor(session.status)
              }
            >
              {getStatusText(session.status)}
            </span>
          </div>
          <p className="mt-2 text-sm text-gray-600">
            创建于 {new Date(session.createdAt).toLocaleString('zh-CN')}
          </p>
          {session.config && (
            <p className="mt-1 text-xs text-gray-500">
              配置: {session.config.name}
            </p>
          )}
        </div>
        <Link
          href={`/dashboard/sessions/${session.id}`}
          className="flex items-center text-sm text-primary-600 hover:text-primary-800 transition-colors"
        >
          查看详情
          <ArrowRight size={16} className="ml-1" />
        </Link>
      </div>

      {session.messages && session.messages.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-700">任务进度</span>
            <span className="text-xs text-gray-600">{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-primary-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>
      )}
    </div>
  );
}
