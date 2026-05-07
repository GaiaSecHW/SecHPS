'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Calendar, User, Settings, FileText, Clock, Play, Pause, CheckCircle, XCircle, AlertCircle, Loader2 } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';

interface TaskInstance {
  id: string;
  userId: string | null;
  name: string;
  agentId: string;
  agentName: string;
  parameters: string;
  filePath: string | null;
  projectPath: string | null;
  skills: string | null;
  scripts: string | null;
  mergedSkills: string | null;
  mergedScripts: string | null;
  notes: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TaskExecutionLog {
  id: string;
  taskId: string;
  timestamp: string;
  level: string;
  message: string;
  details: string | null;
  createdAt: string;
}

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

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const [task, setTask] = useState<TaskInstance | null>(null);
  const [logs, setLogs] = useState<TaskExecutionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [eventSourceRef, setEventSourceRef] = useState<EventSource | null>(null);

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
        setTask(null);
        setLogs([]);
      }
    } catch {
      setTask(null);
      setLogs([]);
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

  const subscribeToLogs = (id: string) => {
    const eventSource = new EventSource(`/api/task-builder/tasks/${id}/logs/stream`);
    setEventSourceRef(eventSource);
    setIsStreaming(true);

    eventSource.onmessage = (event) => {
      const log = JSON.parse(event.data);
      
      setLogs(prev => {
        const exists = prev.find(l => l.id === log.id);
        if (exists) return prev;
        return [...prev, {
          id: log.id || Date.now().toString(),
          taskId: id,
          timestamp: log.timestamp || new Date().toISOString(),
          level: log.level,
          message: log.message,
          details: log.details,
          createdAt: new Date().toISOString(),
        }];
      });

      if (log.type === 'completed' || log.type === 'error') {
        eventSource.close();
        setIsStreaming(false);
        setEventSourceRef(null);
        fetchTaskDetail(id);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      setIsStreaming(false);
      setEventSourceRef(null);
    };
  };

  const handleExecute = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/task-builder/tasks/${taskId}/execute`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '执行失败');
      }

      toast.success('任务已开始执行');
      setLogs([]);
      subscribeToLogs(taskId);
    } catch (error) {
      console.error('执行失败:', error);
      toast.error(error instanceof Error ? error.message : '执行失败');
    }
  };

  useEffect(() => {
    return () => {
      if (eventSourceRef) {
        eventSourceRef.close();
      }
    };
  }, [eventSourceRef]);

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

  const config = statusConfig[task.status] || statusConfig.pending;
  const StatusIcon = config.icon;

  return (
    <div className="space-y-6">
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
              <Settings size={32} className="text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{task.name}</h1>
              <p className="text-sm text-gray-600 mt-1">Agent: {task.agentName}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${config.bg} ${config.text}`}>
              <StatusIcon size={14} className={`mr-1 ${task.status === 'running' ? 'animate-spin' : ''}`} />
              {config.label}
            </span>
            {task.status === 'pending' && (
              <button
                onClick={handleExecute}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                <Play size={16} />
                执行任务
              </button>
            )}
            {task.status === 'running' && (
              <button
                disabled
                className="flex items-center gap-2 px-4 py-2 bg-gray-400 text-white rounded-md cursor-not-allowed"
              >
                <Loader2 size={16} className="animate-spin" />
                执行中...
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 mt-6 bg-gray-50 rounded-lg p-4">
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
          {task.startedAt && (
            <div className="flex items-center gap-2">
              <Play size={18} className="text-gray-400" />
              <div>
                <p className="text-xs text-gray-500">开始时间</p>
                <p className="text-sm font-medium text-gray-900">{formatDate(task.startedAt)}</p>
              </div>
            </div>
          )}
          {task.completedAt && (
            <div className="flex items-center gap-2">
              <CheckCircle size={18} className="text-gray-400" />
              <div>
                <p className="text-xs text-gray-500">完成时间</p>
                <p className="text-sm font-medium text-gray-900">{formatDate(task.completedAt)}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {task.filePath && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={20} className="text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">上传文件</h2>
          </div>
          <p className="text-sm text-gray-700">{task.filePath}</p>
        </div>
      )}

      {task.notes && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={20} className="text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">备注说明</h2>
          </div>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{task.notes}</p>
        </div>
      )}

      {task.errorMessage && (
        <div className="bg-red-50 rounded-lg border border-red-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <XCircle size={20} className="text-red-600" />
            <h2 className="text-lg font-semibold text-red-900">错误信息</h2>
          </div>
          <p className="text-sm text-red-700">{task.errorMessage}</p>
        </div>
      )}

      {task.skills && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Settings size={20} className="text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">注入的 Skills</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {task.skills.split(',').map((skillId) => (
              <span key={skillId} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-md text-sm">
                {skillId}
              </span>
            ))}
          </div>
        </div>
      )}

      {task.scripts && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={20} className="text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">注入的脚本</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {task.scripts.split(',').map((script) => (
              <span key={script} className="px-3 py-1 bg-purple-100 text-purple-700 rounded-md text-sm">
                {script}
              </span>
            ))}
          </div>
        </div>
      )}

      {task.mergedSkills && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Settings size={20} className="text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">合并后的 Skills</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {(() => {
              try {
                const skills = JSON.parse(task.mergedSkills);
                return skills.map((skillId: string) => (
                  <span key={skillId} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-md text-sm">
                    {skillId}
                  </span>
                ));
              } catch {
                return <span className="text-sm text-gray-500">解析失败</span>;
              }
            })()}
          </div>
        </div>
      )}

      {task.mergedScripts && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={20} className="text-purple-600" />
            <h2 className="text-lg font-semibold text-gray-900">合并后的 Scripts</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {(() => {
              try {
                const scripts = JSON.parse(task.mergedScripts);
                return scripts.map((script: string) => (
                  <span key={script} className="px-3 py-1 bg-purple-100 text-purple-700 rounded-md text-sm">
                    {script}
                  </span>
                ));
              } catch {
                return <span className="text-sm text-gray-500">解析失败</span>;
              }
            })()}
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FileText size={20} className="text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">执行日志</h2>
            <span className="text-sm text-gray-500">({logs.length} 条记录)</span>
          </div>
          {isStreaming && (
            <span className="flex items-center gap-2 text-sm text-blue-600 animate-pulse">
              <Loader2 size={14} className="animate-spin" />
              实时更新中...
            </span>
          )}
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