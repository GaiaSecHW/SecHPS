'use client';

import { useState, useEffect } from 'react';
import { useApiFetch } from '@/hooks/useApiFetch';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorAlert } from '@/components/ui/Alert';
import { RefreshCw, ChevronDown, ChevronRight, Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface Task {
  id: string;
  taskId: string;
  state: string;
  instruction: string;
  projectPath: string | null;
  workspacePath: string | null;
  skills: string[] | null;
  mcps: any[] | null;
  model: string | null;
  result: string | null;
  reportContent: string | null;
  error: string | null;
  events: any[] | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  CodeswarmWorker?: {
    nodeId: string;
    address: string;
    status: string;
  };
}

interface TasksResponse {
  tasks: Task[];
}

interface TaskResultViewerProps {
  selectedTaskId: string | null;
  onTaskSelect: (taskId: string | null) => void;
  onRefresh: () => void;
}

export function TaskResultViewer({ selectedTaskId, onTaskSelect, onRefresh }: TaskResultViewerProps) {
  const { data, loading, error, refetch } = useApiFetch<TasksResponse>('/api/codeswarm/tasks');
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  useEffect(() => {
    if (selectedTaskId) {
      setExpandedTask(selectedTaskId);
    }
  }, [selectedTaskId]);

  const tasks = data?.tasks || [];

  const getStateIcon = (state: string) => {
    switch (state) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-600" />;
      case 'queued':
      case 'dispatched':
      case 'building':
      case 'running':
        return <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStateLabel = (state: string) => {
    const labels: Record<string, string> = {
      queued: '排队中',
      dispatched: '已分发',
      building: '构建中',
      running: '执行中',
      completed: '已完成',
      failed: '失败',
      cancelled: '已取消',
    };
    return labels[state] || state;
  };

  const formatTime = (date: string | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleString('zh-CN');
  };

  const formatDuration = (start: string | null, end: string | null) => {
    if (!start || !end) return '-';
    const diff = new Date(end).getTime() - new Date(start).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return <ErrorAlert>{error}</ErrorAlert>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">任务列表</h2>
        <button
          onClick={() => { refetch(); onRefresh(); }}
          className="flex items-center space-x-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          <span>刷新</span>
        </button>
      </div>

      {tasks.length === 0 ? (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-12">
          <div className="text-center">
            <Clock className="mx-auto h-16 w-16 text-gray-400" />
            <h3 className="mt-4 text-lg font-medium text-gray-900">暂无任务</h3>
            <p className="mt-2 text-sm text-gray-600">
              在「任务调试」页面创建任务
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => {
            const isExpanded = expandedTask === task.taskId;
            const isSelected = selectedTaskId === task.taskId;

            return (
              <div
                key={task.id}
                className={`bg-white rounded-lg shadow border ${
                  isSelected ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200'
                } overflow-hidden`}
              >
                {/* Task Header */}
                <div
                  className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50"
                  onClick={() => {
                    setExpandedTask(isExpanded ? null : task.taskId);
                    onTaskSelect(isExpanded ? null : task.taskId);
                  }}
                >
                  <div className="flex items-center space-x-3 flex-1 min-w-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedTask(isExpanded ? null : task.taskId);
                      }}
                      className="p-1"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                      )}
                    </button>
                    {getStateIcon(task.state)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium text-gray-900 truncate">
                          {task.taskId}
                        </span>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                          task.state === 'completed' ? 'bg-green-100 text-green-800' :
                          task.state === 'failed' ? 'bg-red-100 text-red-800' :
                          'bg-blue-100 text-blue-800'
                        }`}>
                          {getStateLabel(task.state)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-0.5">
                        {task.instruction.slice(0, 60)}{task.instruction.length > 60 ? '...' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4 text-xs text-gray-500">
                    {task.CodeswarmWorker && (
                      <span className="text-blue-600">{task.CodeswarmWorker.address}</span>
                    )}
                    <span>{formatTime(task.createdAt)}</span>
                  </div>
                </div>

                {/* Task Details */}
                {isExpanded && (
                  <div className="px-4 py-4 border-t border-gray-200 bg-gray-50 space-y-4">
                    {/* Meta Info */}
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">Task ID:</span>
                        <span className="ml-2 font-mono text-xs">{task.taskId}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Model:</span>
                        <span className="ml-2">{task.model || '-'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Duration:</span>
                        <span className="ml-2">{formatDuration(task.startedAt, task.completedAt)}</span>
                      </div>
                    </div>

                    {task.projectPath && (
                      <div className="text-sm">
                        <span className="text-gray-500">Project:</span>
                        <code className="ml-2 text-xs bg-gray-200 px-2 py-0.5 rounded">
                          {task.projectPath}
                        </code>
                      </div>
                    )}

                    {task.workspacePath && (
                      <div className="text-sm">
                        <span className="text-gray-500">Workspace:</span>
                        <code className="ml-2 text-xs bg-gray-200 px-2 py-0.5 rounded">
                          {task.workspacePath}
                        </code>
                      </div>
                    )}

                    {/* Skills */}
                    {task.skills && task.skills.length > 0 && (
                      <div className="text-sm">
                        <span className="text-gray-500">Skills:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {task.skills.map((skill, i) => (
                            <span key={i} className="px-2 py-0.5 text-xs bg-purple-100 text-purple-800 rounded">
                              {skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Events Stream */}
                    {task.events && task.events.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">
                          事件流 ({task.events.length} 条)
                        </h4>
                        <div className="bg-gray-900 rounded-lg p-3 max-h-60 overflow-y-auto">
                          <div className="space-y-1 font-mono text-xs text-green-400">
                            {task.events.map((event: any, i: number) => (
                              <div key={i} className="flex items-start space-x-2">
                                <span className="text-gray-500">[{new Date(event.timestamp).toLocaleTimeString()}]</span>
                                <span className={
                                  event.type === 'error' ? 'text-red-400' :
                                  event.type === 'tool_call' ? 'text-yellow-400' :
                                  event.type === 'tool_call_update' ? 'text-blue-400' :
                                  'text-green-400'
                                }>
                                  [{event.type}] {event.content || event.tool || event.message || ''}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Result */}
                    {task.result && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">执行结果</h4>
                        <pre className="bg-gray-900 text-green-400 p-3 rounded-lg text-xs overflow-x-auto max-h-48">
                          {task.result.slice(0, 2000)}{task.result.length > 2000 ? '\n...(truncated)' : ''}
                        </pre>
                      </div>
                    )}

                    {/* Report Content */}
                    {task.reportContent && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">安全报告</h4>
                        <pre className="bg-gray-100 p-3 rounded-lg text-xs overflow-x-auto max-h-48">
                          {task.reportContent.slice(0, 2000)}{task.reportContent.length > 2000 ? '\n...(truncated)' : ''}
                        </pre>
                      </div>
                    )}

                    {/* Error */}
                    {task.error && (
                      <div>
                        <h4 className="text-sm font-medium text-red-700 mb-2">错误信息</h4>
                        <pre className="bg-red-50 text-red-700 p-3 rounded-lg text-xs overflow-x-auto">
                          {task.error}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}