'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
  MessageSquare,
  ArrowRight,
  RefreshCw,
  Zap,
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

interface RealtimeEvent {
  type: string;
  timestamp: number;
  data?: any;
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
  const [isConnected, setIsConnected] = useState(false);
  const [recentEvents, setRecentEvents] = useState<RealtimeEvent[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    fetchData();
    connectEventStream();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const connectEventStream = () => {
    const token = localStorage.getItem('token');

    try {
      eventSourceRef.current = new EventSource(`/api/events?token=${encodeURIComponent(token || '')}`);

      eventSourceRef.current.onopen = () => {
        setIsConnected(true);
      };

      eventSourceRef.current.onmessage = (event) => {
        try {
          const eventData = JSON.parse(event.data);
          handleEvent(eventData);
        } catch (e) {
          // 忽略解析错误
        }
      };

      eventSourceRef.current.onerror = () => {
        setIsConnected(false);
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
      };
    } catch (error) {
      console.error('Failed to connect to event stream:', error);
      setIsConnected(false);
    }
  };

  const handleEvent = (eventData: any) => {
    // 过滤心跳事件，不显示在事件列表中
    if (eventData.type === 'server.heartbeat') {
      return;
    }

    // 添加到最近事件列表
    const newEvent: RealtimeEvent = {
      type: eventData.type || 'unknown',
      timestamp: Date.now(),
      data: eventData,
    };
    setRecentEvents(prev => [newEvent, ...prev].slice(0, 20));

    // 根据事件类型更新会话状态
    if (eventData.type === 'session.updated' && eventData.properties?.info) {
      const sessionInfo = eventData.properties.info;
      setSessions(prev => 
        prev.map(s => 
          s.id === sessionInfo.id 
            ? { ...s, ...sessionInfo }
            : s
        )
      );
      updateStats();
    } else if (eventData.type === 'session.created') {
      // 新会话创建，刷新列表
      fetchData();
    } else if (eventData.type === 'session.deleted') {
      // 会话删除，从列表移除
      setSessions(prev => prev.filter(s => s.id !== eventData.properties?.info?.id));
      updateStats();
    }
  };

  const updateStats = () => {
    setSessions(prev => {
      const running = prev.filter((s: Session) => s.status === 'running').length;
      const completed = prev.filter((s: Session) => s.status === 'completed').length;
      const failed = prev.filter((s: Session) => s.status === 'failed').length;
      const waiting = prev.length - running - completed - failed;
      
      const newStats = {
        total: prev.length,
        running,
        completed,
        failed,
        waiting,
      };
      setStats(newStats);
      return prev;
    });
  };

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

  const formatEventTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('zh-CN');
  };

  const getEventColor = (type: string) => {
    if (type.includes('created') || type.includes('completed')) return 'text-green-600 bg-green-50';
    if (type.includes('deleted') || type.includes('failed')) return 'text-red-600 bg-red-50';
    if (type.includes('updated') || type.includes('running')) return 'text-blue-600 bg-blue-50';
    return 'text-gray-600 bg-gray-50';
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'running':
        return 'bg-blue-500';
      case 'completed':
        return 'bg-green-500';
      case 'failed':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
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
        return 'bg-blue-50 text-blue-700 border-blue-200';
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
        <div className="flex items-center space-x-4">
          {/* SSE 连接状态 */}
          <div className="flex items-center space-x-2 px-3 py-1.5 bg-white border border-gray-200 rounded-md">
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span className="text-sm text-gray-600">
              {isConnected ? '实时连接' : '已断开'}
            </span>
            <Zap size={14} className={isConnected ? 'text-green-500' : 'text-gray-400'} />
          </div>
          <button
            onClick={fetchData}
            className="flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors"
          >
            <RefreshCw size={18} />
            <span>刷新</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* 统计卡片 */}
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

      {/* 实时事件流 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <Activity size={20} className="mr-2 text-primary-500" />
          实时事件
        </h2>
        {recentEvents.length === 0 ? (
          <div className="text-center py-8">
            <Activity className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-4 text-sm text-gray-600">
              {isConnected ? '等待事件...' : '未连接到事件流'}
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {recentEvents.map((event, index) => (
              <div
                key={index}
                className={`flex items-center justify-between px-3 py-2 rounded-md text-sm ${getEventColor(event.type)}`}
              >
                <span className="font-medium">{event.type}</span>
                <span className="text-xs opacity-75">
                  {formatEventTime(event.timestamp)}
                </span>
              </div>
            ))}
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
}

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
        <div className={bgColor + ' p-3 rounded-lg'}>
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
  const progress = getProgressPercentage(session);

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

      {/* 任务进度 */}
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
    </div>
  );
}
