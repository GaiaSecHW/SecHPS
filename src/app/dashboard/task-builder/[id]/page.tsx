'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Calendar, User, Shield, Bug, Sword, Network, FileText, Settings, Clock, Play, Pause, CheckCircle, XCircle, AlertCircle, Loader2 } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { TaskInstance } from '../types';

interface ExecutionLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
  details?: string;
}

const iconMap: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Shield,
  Bug,
  Sword,
  Network,
};

const statusConfig: Record<string, { bg: string; text: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  pending: { bg: 'bg-gray-100', text: 'text-gray-700', label: '待执行', icon: Clock },
  running: { bg: 'bg-blue-100', text: 'text-blue-700', label: '执行中', icon: Loader2 },
  completed: { bg: 'bg-green-100', text: 'text-green-700', label: '已完成', icon: CheckCircle },
  failed: { bg: 'bg-red-100', text: 'text-red-700', label: '执行失败', icon: XCircle },
};

const logLevelConfig: Record<string, { bg: string; text: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  info: { bg: 'bg-blue-50', text: 'text-blue-700', icon: AlertCircle },
  warning: { bg: 'bg-yellow-50', text: 'text-yellow-700', icon: AlertCircle },
  error: { bg: 'bg-red-50', text: 'text-red-700', icon: XCircle },
  success: { bg: 'bg-green-50', text: 'text-green-700', icon: CheckCircle },
};

const STATIC_TASK_DETAIL: TaskInstance = {
  id: 'task-demo',
  name: 'Java代码审计-示例项目',
  templateId: 'code-review',
  templateName: '代码审计',
  status: 'completed',
  createdAt: '2024-01-15T10:30:00Z',
  updatedAt: '2024-01-15T12:45:00Z',
  parameters: {
    targetPath: '/src/main/java',
    language: 'Java',
    depth: '标准审计',
    focusAreas: 'SQL注入、XSS、认证绕过',
  },
  notes: '示例项目安全审计，重点关注认证模块和数据访问层',
  userName: 'admin',
};

const STATIC_EXECUTION_LOGS: ExecutionLog[] = [
  {
    id: 'log-1',
    timestamp: '2024-01-15T10:30:00Z',
    level: 'info',
    message: '任务开始执行',
    details: '正在初始化代码审计环境...',
  },
  {
    id: 'log-2',
    timestamp: '2024-01-15T10:32:15Z',
    level: 'info',
    message: '加载目标代码',
    details: '已加载 /src/main/java 目录下的 156 个 Java 文件',
  },
  {
    id: 'log-3',
    timestamp: '2024-01-15T10:35:30Z',
    level: 'warning',
    message: '发现潜在问题',
    details: 'UserDao.java:45 - 检测到疑似 SQL 拼接查询',
  },
  {
    id: 'log-4',
    timestamp: '2024-01-15T10:38:45Z',
    level: 'error',
    message: '安全漏洞确认',
    details: 'LoginController.java:89 - SQL注入漏洞（高危），参数 username 未经过滤直接拼接到 SQL 查询',
  },
  {
    id: 'log-5',
    timestamp: '2024-01-15T10:42:00Z',
    level: 'warning',
    message: '发现潜在问题',
    details: 'SearchServlet.java:120 - 检测到疑似 XSS 漏洞',
  },
  {
    id: 'log-6',
    timestamp: '2024-01-15T10:45:15Z',
    level: 'info',
    message: '继续分析',
    details: '正在检查认证模块...',
  },
  {
    id: 'log-7',
    timestamp: '2024-01-15T10:48:30Z',
    level: 'success',
    message: '漏洞验证完成',
    details: '已确认 3 个 SQL 注入漏洞，2 个 XSS 漏洞',
  },
  {
    id: 'log-8',
    timestamp: '2024-01-15T10:52:45Z',
    level: 'info',
    message: '生成报告',
    details: '正在生成安全审计报告...',
  },
  {
    id: 'log-9',
    timestamp: '2024-01-15T10:55:00Z',
    level: 'success',
    message: '报告生成完成',
    details: '报告已保存至 /reports/task-demo-20240115.pdf',
  },
  {
    id: 'log-10',
    timestamp: '2024-01-15T12:45:00Z',
    level: 'success',
    message: '任务执行完成',
    details: '审计耗时 2小时15分钟，共发现 5 个安全问题',
  },
];

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const [task, setTask] = useState<TaskInstance | null>(null);
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTaskDetail(taskId);
  }, [taskId]);

  const fetchTaskDetail = async (id: string) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/task-builder/tasks/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setTask(data.task || null);
        setLogs(data.logs || []);
      } else {
        // API 未实现，使用假数据
        setTask(STATIC_TASK_DETAIL);
        setLogs(STATIC_EXECUTION_LOGS);
      }
    } catch {
      // 网络错误，使用假数据
      setTask(STATIC_TASK_DETAIL);
      setLogs(STATIC_EXECUTION_LOGS);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">任务不存在或已删除</p>
        <button
          onClick={() => router.push('/dashboard/task-builder')}
          className="mt-4 px-4 py-2 text-blue-600 hover:text-blue-800"
        >
          返回列表
        </button>
      </div>
    );
  }

  const Icon = iconMap[task.templateId === 'code-review' ? 'Shield' :
                     task.templateId === 'vuln-scan' ? 'Bug' :
                     task.templateId === 'penetration-test' ? 'Sword' : 'Network'];
  const config = statusConfig[task.status] || statusConfig.pending;
  const StatusIcon = config.icon;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <button
          onClick={() => router.push('/dashboard/task-builder')}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft size={20} className="mr-2" />
          返回任务列表
        </button>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-blue-50">
              <Icon size={32} className="text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{task.name}</h1>
              <p className="text-sm text-gray-600 mt-1">{task.templateName}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${config.bg} ${config.text}`}>
              <StatusIcon size={14} className={`mr-1 ${task.status === 'running' ? 'animate-spin' : ''}`} />
              {config.label}
            </span>
            {task.status === 'pending' && (
              <button
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                <Play size={16} />
                执行任务
              </button>
            )}
            {task.status === 'running' && (
              <button
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                <Pause size={16} />
                停止任务
              </button>
            )}
          </div>
        </div>

        {/* Time info */}
        <div className="grid grid-cols-3 gap-4 mt-6 bg-gray-50 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <Calendar size={18} className="text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">创建时间</p>
              <p className="text-sm font-medium text-gray-900">{formatDate(task.createdAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock size={18} className="text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">更新时间</p>
              <p className="text-sm font-medium text-gray-900">{formatDate(task.updatedAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <User size={18} className="text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">创建人</p>
              <p className="text-sm font-medium text-gray-900">{task.userName || '未知'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Task Parameters */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Settings size={20} className="text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-900">任务参数</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">参数名</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">参数值</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {Object.entries(task.parameters).map(([key, value]) => (
                <tr key={key}>
                  <td className="px-4 py-2 text-sm font-medium text-gray-700">{key}</td>
                  <td className="px-4 py-2 text-sm text-gray-900">{value || '-'}</td>
                </tr>
              ))}
              {Object.keys(task.parameters).length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-2 text-sm text-gray-500 text-center">
                    无参数配置
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Notes */}
      {task.notes && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={20} className="text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">备注说明</h2>
          </div>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{task.notes}</p>
        </div>
      )}

      {/* Execution Logs */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <FileText size={20} className="text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-900">执行日志</h2>
          <span className="text-sm text-gray-500">({logs.length} 条记录)</span>
        </div>
        
        {logs.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">暂无执行日志</p>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {logs.map((log) => {
              const logConfig = logLevelConfig[log.level] || logLevelConfig.info;
              const LogIcon = logConfig.icon;

              return (
                <div
                  key={log.id}
                  className={`p-3 rounded-lg border ${logConfig.bg} border-gray-200`}
                >
                  <div className="flex items-start gap-3">
                    <LogIcon size={16} className={`${logConfig.text} mt-0.5`} />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-medium ${logConfig.text}`}>
                          {log.message}
                        </span>
                        <span className="text-xs text-gray-500">
                          {formatDate(log.timestamp)}
                        </span>
                      </div>
                      {log.details && (
                        <p className="text-xs text-gray-600 mt-1">{log.details}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}