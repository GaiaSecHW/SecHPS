'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useApiFetch } from '@/hooks/useApiFetch';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  Terminal,
  RefreshCw,
  ChevronDown,
  Filter,
  Clock,
  Server,
  Cpu,
  FileText,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Activity,
  Play,
  Send,
  Award,
  MessageSquare,
  Copy,
  Wrench,
  ChevronRight,
  Database,
  Brain
} from 'lucide-react';

interface LogEntry {
  id: string;
  taskId: string;
  type: string;
  data: string;
  level: string;
  stream?: string;
  createdAt: string;
}

interface LogsResponse {
  logs: LogEntry[];
  total: number;
}

interface Task {
  taskId: string;
  state: string;
  instruction: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  workerId?: string;
  agent?: string;
}

interface TaskDetail extends Task {
  events: any[];
  result?: string;
  error?: string;
  workspacePath?: string;
  sessionId?: string;
}

interface ExecutionPhase {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  time?: string;
  icon: React.ReactNode;
}

// Timeline phases for task execution
const EXECUTION_PHASES: ExecutionPhase[] = [
  { id: 'queued', name: '任务入队', status: 'pending', icon: <Clock className="w-4 h-4" /> },
  { id: 'dispatched', name: '分发Worker', status: 'pending', icon: <Send className="w-4 h-4" /> },
  { id: 'building', name: '构建环境', status: 'pending', icon: <Activity className="w-4 h-4" /> },
  { id: 'codedmap', name: '知识图谱', status: 'pending', icon: <Database className="w-4 h-4" /> },
  { id: 'executing', name: '执行命令', status: 'pending', icon: <Play className="w-4 h-4" /> },
  { id: 'completed', name: '执行完成', status: 'pending', icon: <CheckCircle className="w-4 h-4" /> },
];

export function WorkerLogsPage({ nodeId }: WorkerLogsPageProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState<'all' | 'worker' | 'agent'>('all');
  const [streamFilter, setStreamFilter] = useState<'all' | 'stdout' | 'stderr'>('all');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: tasksData, loading: tasksLoading, refetch: refetchTasks } = useApiFetch<{
    tasks: Task[];
  }>('/api/codeswarm/tasks');

  const buildLogsUrl = useCallback(() => {
    if (!selectedTaskId) return null;
    const params = new URLSearchParams();
    if (levelFilter !== 'all') params.set('level', levelFilter);
    if (streamFilter !== 'all') params.set('stream', streamFilter);
    return `/api/codeswarm/tasks/${selectedTaskId}/logs?${params.toString()}`;
  }, [selectedTaskId, levelFilter, streamFilter]);

  const logsUrl = buildLogsUrl();
  const { data: logsData, loading: logsLoading, refetch: refetchLogs } = useApiFetch<LogsResponse>(logsUrl);

  // Fetch task detail when selected
  useEffect(() => {
    if (selectedTaskId) {
      fetch(`/api/codeswarm/tasks/${selectedTaskId}`)
        .then(res => res.json())
        .then(data => {
          if (data.task) {
            setTaskDetail(data.task);
          }
        })
        .catch(console.error);
    } else {
      setTaskDetail(null);
    }
  }, [selectedTaskId]);

  const tasks = tasksData?.tasks || [];
  const logs = logsData?.logs || [];

  // Auto-refresh
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (autoRefresh && selectedTaskId) {
      intervalRef.current = setInterval(() => {
        refetchLogs();
        // Also refetch task detail
        fetch(`/api/codeswarm/tasks/${selectedTaskId}`)
          .then(res => res.json())
          .then(data => {
            if (data.task) setTaskDetail(data.task);
          })
          .catch(console.error);
      }, 2000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, selectedTaskId, refetchLogs]);

  useEffect(() => {
    if (logs.length > 0) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs.length]);

  const toggleExpand = (logId: string) => {
    setExpandedLogs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(logId)) newSet.delete(logId);
      else newSet.add(logId);
      return newSet;
    });
  };

  const parseLogData = (data: string): object => {
    try {
      return JSON.parse(data);
    } catch {
      return { raw: data };
    }
  };

  const getLogIcon = (type: string, stream?: string) => {
    if (stream === 'stderr' || type === 'error') return <AlertTriangle className="w-4 h-4 text-red-500" />;
    if (type === 'task_completed' || type === 'tool_call') return <Cpu className="w-4 h-4 text-purple-500" />;
    if (type === 'task_started') return <Activity className="w-4 h-4 text-blue-500" />;
    if (type === 'phase_start' || type === 'phase_complete') return <Database className="w-4 h-4 text-indigo-400" />;
    return <FileText className="w-4 h-4 text-gray-500" />;
  };

  const getLevelBadgeColor = (level: string) => {
    return level === 'worker'
      ? 'bg-blue-600 text-blue-100'
      : 'bg-purple-600 text-purple-100';
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    });
  };

  // Group consecutive logs of the same type into chunks for better display
  const groupConsecutiveLogs = (logs: LogEntry[]): LogEntry[][] => {
    const groups: LogEntry[][] = [];
    let currentGroup: LogEntry[] = [];
    let lastTimestamp = 0;

    for (const log of logs) {
      const timestamp = new Date(log.createdAt).getTime();
      const timeDiff = timestamp - lastTimestamp;

      // If more than 500ms gap or different type, start new group
      if (currentGroup.length > 0 && (timeDiff > 500 || currentGroup[0].type !== log.type)) {
        groups.push(currentGroup);
        currentGroup = [];
      }

      currentGroup.push(log);
      lastTimestamp = timestamp;
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    return groups;
  };

  const getLogContent = (log: LogEntry): string => {
    const parsed = parseLogData(log.data);
    if (typeof parsed === 'object' && parsed !== null) {
      if ('content' in parsed) return parsed.content as string;
      if ('message' in parsed) return parsed.message as string;
      if ('data' in parsed && typeof parsed.data === 'object' && parsed.data !== null) {
        if ('content' in parsed.data) return parsed.data.content as string;
      }
    }
    return log.data;
  };

  // Get tool call info if this is a tool_call log
  const getToolCallInfo = (log: LogEntry): { name: string; args: object } | null => {
    if (log.type !== 'tool_call') return null;
    const parsed = parseLogData(log.data);
    if (typeof parsed === 'object' && parsed !== null) {
      const input = (parsed as any).input || (parsed as any).data?.input;
      if (input && typeof input === 'object') {
        return { name: (parsed as any).tool || (parsed as any).data?.tool || 'unknown', args: input };
      }
    }
    return null;
  };

  // Copy text to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      // Could add a toast notification here
    }).catch(console.error);
  };

  // Get combined content from a group of logs
  const getGroupContent = (group: LogEntry[]): string => {
    return group.map(log => getLogContent(log)).join('');
  };

  // Build execution timeline based on task state and log events
  const buildTimeline = (): ExecutionPhase[] => {
    if (!taskDetail) return EXECUTION_PHASES.map(p => ({ ...p, status: 'pending' as ExecutionPhase['status'] }));

    const phases: ExecutionPhase[] = EXECUTION_PHASES.map(p => ({ ...p, status: 'pending' as ExecutionPhase['status'] }));
    const state = taskDetail.state;

    // Detect codedmap events from logs
    const hasCodedmapStart = logs.some(log => {
      try {
        const d = JSON.parse(log.data);
        return (log.type === 'phase_start' || d.type === 'phase_start') && d.phase === 'codedmap';
      } catch { return false; }
    });
    const codedmapCompleteEvent = logs.find(log => {
      try {
        const d = JSON.parse(log.data);
        return (log.type === 'phase_complete' || d.type === 'phase_complete') && d.phase === 'codedmap';
      } catch { return false; }
    });
    const codedmapSuccess = codedmapCompleteEvent ? (() => {
      try { return JSON.parse(codedmapCompleteEvent.data).success !== false; } catch { return true; }
    })() : false;

    // phases[0] = queued
    phases[0].status = 'completed';
    phases[0].time = taskDetail.createdAt;

    if (state === 'queued') return phases;

    // phases[1] = dispatched
    phases[1].status = 'completed';
    phases[1].time = taskDetail.startedAt || taskDetail.createdAt;

    if (state === 'dispatched') {
      phases[2].status = 'running';
      return phases;
    }

    if (state === 'building') {
      phases[2].status = 'running';
      return phases;
    }

    // phases[2] = building completed
    phases[2].status = 'completed';

    // phases[3] = codedmap
    if (hasCodedmapStart) {
      if (codedmapCompleteEvent) {
        phases[3].status = codedmapSuccess ? 'completed' : 'failed';
        phases[3].time = codedmapCompleteEvent.createdAt;
      } else {
        phases[3].status = 'running';
      }
    } else {
      // No codedmap events: skip this phase (mark completed to show it wasn't needed)
      phases[3].status = 'completed';
    }

    // phases[4] = executing
    if (['running', 'dispatched'].includes(state) || (state === 'failed' && !taskDetail.completedAt)) {
      phases[4].status = state === 'failed' ? 'failed' : 'running';
      return phases;
    }

    // completed or failed
    phases[4].status = state === 'completed' ? 'completed' : 'failed';
    // phases[5] = completed
    phases[5].status = state === 'completed' ? 'completed' : 'failed';
    if (taskDetail.completedAt) {
      phases[5].time = taskDetail.completedAt;
    }

    return phases;
  };

  // Separate logs into process logs and result logs
  const processLogs = logs.filter(log => !['task_completed', 'task_failed'].includes(log.type));
  const resultLogs = logs.filter(log => ['task_completed', 'task_failed'].includes(log.type));

  const timeline = buildTimeline();

  return (
    <div className="space-y-6 p-6 bg-slate-900 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Terminal className="w-6 h-6 text-slate-400" />
          <h1 className="text-2xl font-bold text-slate-100">任务执行详情</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { refetchTasks(); refetchLogs(); }}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-slate-700 text-slate-200 rounded hover:bg-slate-600 border border-slate-600 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            刷新
          </button>
        </div>
      </div>

      {/* Task Selector */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
        <h2 className="text-sm font-medium text-slate-300 mb-3">选择任务</h2>
        {tasksLoading ? (
          <LoadingSpinner />
        ) : (
          <div className="grid gap-2 max-h-48 overflow-y-auto">
            {tasks.map(task => (
              <button
                key={task.taskId}
                onClick={() => setSelectedTaskId(task.taskId)}
                className={`flex items-center justify-between p-3 rounded border text-left transition-all ${
                  selectedTaskId === task.taskId
                    ? 'border-blue-500 bg-blue-900/30'
                    : 'border-slate-600 bg-slate-700/50 hover:bg-slate-700'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Server className="w-4 h-4 text-slate-400" />
                  <span className="font-medium text-slate-100">{task.taskId}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 text-xs font-medium rounded ${
                    task.state === 'completed' ? 'bg-emerald-900/50 text-emerald-400 border border-emerald-700' :
                    task.state === 'failed' ? 'bg-red-900/50 text-red-400 border border-red-700' :
                    task.state === 'running' ? 'bg-blue-900/50 text-blue-400 border border-blue-700' :
                    'bg-slate-600 text-slate-300 border border-slate-500'
                  }`}>
                    {task.state}
                  </span>
                  <Clock className="w-3 h-3 text-slate-500" />
                  <span className="text-xs text-slate-400">
                    {new Date(task.createdAt).toLocaleString('zh-CN')}
                  </span>
                </div>
              </button>
            ))}
            {tasks.length === 0 && (
              <p className="text-slate-500 text-center py-4">暂无任务</p>
            )}
          </div>
        )}
      </div>

      {/* Task Detail & Timeline */}
      {taskDetail && (
        <>
          {/* Execution Timeline */}
          <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
            <h2 className="text-sm font-medium text-slate-300 mb-4">执行时间线</h2>
            <div className="flex items-center justify-between">
              {timeline.map((phase, index) => (
                <div key={phase.id} className="flex items-center flex-1">
                  <div className="flex flex-col items-center">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${
                      phase.status === 'completed'
                        ? 'bg-emerald-600 border-emerald-400 text-white'
                        : phase.status === 'running'
                          ? 'bg-blue-600 border-blue-400 text-white animate-pulse'
                          : phase.status === 'failed'
                            ? 'bg-red-600 border-red-400 text-white'
                            : 'bg-slate-700 border-slate-500 text-slate-400'
                    }`}>
                      {phase.icon}
                    </div>
                    <span className={`text-xs mt-2 ${phase.status === 'pending' ? 'text-slate-500' : 'text-slate-300'}`}>
                      {phase.name}
                    </span>
                    {phase.time && (
                      <span className="text-xs text-slate-500 mt-1">
                        {new Date(phase.time).toLocaleTimeString('zh-CN')}
                      </span>
                    )}
                  </div>
                  {index < timeline.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-2 ${
                      phase.status === 'completed' ? 'bg-emerald-600' : 'bg-slate-600'
                    }`} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Task Info */}
          <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
            <h2 className="text-sm font-medium text-slate-300 mb-3">任务信息</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-slate-500">任务ID:</span>
                <span className="ml-2 text-slate-200 font-mono">{taskDetail.taskId}</span>
              </div>
              <div>
                <span className="text-slate-500">状态:</span>
                <span className={`ml-2 font-medium ${
                  taskDetail.state === 'completed' ? 'text-emerald-400' :
                  taskDetail.state === 'failed' ? 'text-red-400' :
                  'text-blue-400'
                }`}>{taskDetail.state}</span>
              </div>
              <div>
                <span className="text-slate-500">Agent:</span>
                <span className="ml-2 text-slate-200">{taskDetail.agent || '-'}</span>
              </div>
              <div>
                <span className="text-slate-500">会话ID:</span>
                <span className="ml-2 text-slate-200 font-mono text-xs">{taskDetail.sessionId || '-'}</span>
              </div>
              <div>
                <span className="text-slate-500">指令:</span>
                <span className="ml-2 text-slate-200 truncate">{taskDetail.instruction}</span>
              </div>
              <div className="col-span-2">
                <span className="text-slate-500">工作区:</span>
                <span className="ml-2 text-slate-300 font-mono text-xs">{taskDetail.workspacePath || '-'}</span>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-4 bg-slate-800/50 rounded-lg p-3 border border-slate-700">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" />
              <span className="text-sm text-slate-300">层级:</span>
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value as 'all' | 'worker' | 'agent')}
                className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">全部</option>
                <option value="worker">Worker 层</option>
                <option value="agent">Agent 层</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-300">输出流:</span>
              <select
                value={streamFilter}
                onChange={(e) => setStreamFilter(e.target.value as 'all' | 'stdout' | 'stderr')}
                className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">全部</option>
                <option value="stdout">stdout</option>
                <option value="stderr">stderr</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="rounded bg-slate-700 border-slate-500"
                />
                自动刷新
              </label>
            </div>
            {/* Active filters display */}
            {(levelFilter !== 'all' || streamFilter !== 'all') && (
              <div className="flex items-center gap-1 ml-2">
                <span className="text-xs text-slate-500">过滤:</span>
                {levelFilter !== 'all' && (
                  <span className="px-2 py-0.5 text-xs bg-blue-900/50 text-blue-300 rounded-full border border-blue-700">
                    {levelFilter === 'worker' ? 'Worker' : 'Agent'}
                    <button
                      onClick={() => setLevelFilter('all')}
                      className="ml-1 hover:text-white"
                    >
                      ×
                    </button>
                  </span>
                )}
                {streamFilter !== 'all' && (
                  <span className="px-2 py-0.5 text-xs bg-emerald-900/50 text-emerald-300 rounded-full border border-emerald-700">
                    {streamFilter}
                    <button
                      onClick={() => setStreamFilter('all')}
                      className="ml-1 hover:text-white"
                    >
                      ×
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Process Logs */}
          <div className="bg-slate-800/80 rounded-lg border border-slate-700">
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <h2 className="font-medium text-slate-200 flex items-center gap-2">
                <Play className="w-4 h-4 text-blue-400" />
                执行过程日志 ({processLogs.length} 条)
              </h2>
              {logsLoading && <LoadingSpinner size="sm" />}
            </div>

            <div className="p-4 max-h-[500px] overflow-y-auto font-mono text-sm">
              {processLogs.length === 0 ? (
                <p className="text-slate-500 text-center py-8">暂无执行过程日志</p>
              ) : (
                <div className="space-y-2">
                  {groupConsecutiveLogs(processLogs).map((group, groupIndex) => {
                    const content = getGroupContent(group);
                    const firstLog = group[0];
                    const isMultiLine = content.includes('\n');
                    const isExpanded = expandedLogs.has(`group-${groupIndex}`);
                    const isAgent = firstLog.level === 'agent';
                    const isError = firstLog.stream === 'stderr' || firstLog.type === 'error';
                    const isToolCall = firstLog.type === 'tool_call';
                    const isCodedmap = (() => {
                      if (content.includes('[Codedmap]')) return true;
                      try {
                        const d = JSON.parse(firstLog.data);
                        return (firstLog.type === 'phase_start' || firstLog.type === 'phase_complete') && d.phase === 'codedmap';
                      } catch { return false; }
                    })();
                    const toolInfo = getToolCallInfo(firstLog);

                    return (
                      <div
                        key={`group-${groupIndex}`}
                        className={`flex ${isAgent ? 'justify-end' : 'justify-start'}`}
                      >
                        <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                          isError
                            ? 'bg-red-900/30 border border-red-700/50 text-red-200'
                            : isCodedmap
                              ? 'bg-indigo-900/30 border border-indigo-600/40 text-indigo-100'
                              : isToolCall
                                ? 'bg-amber-900/20 border border-amber-600/40 text-amber-100'
                                : isAgent
                                  ? 'bg-blue-600/20 border border-blue-500/30 text-blue-100'
                                  : 'bg-slate-700/80 border border-slate-600/50 text-slate-200'
                        }`}>
                          {/* Header with icon and timestamp */}
                          <div className="flex items-center justify-between gap-3 mb-1 text-xs opacity-70">
                            <div className="flex items-center gap-2">
                              {isCodedmap ? (
                                <Brain className="w-3 h-3" />
                              ) : isToolCall ? (
                                <Wrench className="w-3 h-3" />
                              ) : isAgent ? (
                                <MessageSquare className="w-3 h-3" />
                              ) : (
                                <Cpu className="w-3 h-3" />
                              )}
                              <span>{isCodedmap ? 'Codedmap' : isToolCall ? 'Tool Call' : isAgent ? 'Agent' : 'Worker'}</span>
                              <span>·</span>
                              <span className="font-mono">{formatTime(firstLog.createdAt)}</span>
                              {group.length > 1 && (
                                <>
                                  <span>·</span>
                                  <span className="text-slate-400">+{group.length - 1}条</span>
                                </>
                              )}
                            </div>
                            <button
                              onClick={() => copyToClipboard(content)}
                              className="flex items-center gap-1 text-slate-400 hover:text-slate-200 transition-colors"
                              title="复制内容"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>

                          {/* Tool Call Visualization */}
                          {isToolCall && toolInfo && (
                            <div className="mb-2 bg-slate-900/50 rounded-lg p-3 border border-amber-700/30">
                              <div className="flex items-center gap-2 text-amber-300 font-medium mb-2">
                                <Wrench className="w-4 h-4" />
                                <span className="font-mono">{toolInfo.name}</span>
                              </div>
                              <pre className="text-xs text-slate-300 bg-slate-900 rounded p-2 overflow-x-auto max-h-40 overflow-y-auto">
                                {JSON.stringify(toolInfo.args, null, 2)}
                              </pre>
                            </div>
                          )}

                          {/* Content */}
                          {isMultiLine || content.length > 300 ? (
                            <div className="relative">
                              <pre className={`text-sm whitespace-pre-wrap break-all font-mono ${!isExpanded ? 'max-h-24 overflow-hidden' : ''}`}>
                                {content}
                              </pre>
                              <button
                                onClick={() => {
                                  const key = `group-${groupIndex}`;
                                  setExpandedLogs(prev => {
                                    const newSet = new Set(prev);
                                    if (newSet.has(key)) newSet.delete(key);
                                    else newSet.add(key);
                                    return newSet;
                                  });
                                }}
                                className="mt-1 flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-medium"
                              >
                                {isExpanded ? (
                                  <>
                                    <ChevronDown className="w-3 h-3" /> 收起
                                  </>
                                ) : (
                                  <>
                                    <ChevronRight className="w-3 h-3" /> 展开全部
                                  </>
                                )}
                              </button>
                            </div>
                          ) : (
                            <div className="text-sm">
                              {content}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
          </div>

          {/* Result Logs */}
          <div className="bg-slate-800/80 rounded-lg border border-slate-700">
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <h2 className="font-medium text-slate-200 flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-400" />
                执行结果 ({resultLogs.length} 条)
              </h2>
            </div>

            <div className="p-4 max-h-[300px] overflow-y-auto font-mono text-sm">
              {taskDetail.result ? (
                <div className="bg-emerald-900/20 border border-emerald-700/50 rounded-lg p-4">
                  <div className="text-emerald-400 text-xs uppercase mb-2">执行结果</div>
                  <pre className="text-slate-200 whitespace-pre-wrap break-all text-sm">
                    {taskDetail.result}
                  </pre>
                </div>
              ) : null}
              {taskDetail.error ? (
                <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-4 mt-3">
                  <div className="text-red-400 text-xs uppercase mb-2">错误信息</div>
                  <pre className="text-red-300 whitespace-pre-wrap break-all text-sm">
                    {taskDetail.error}
                  </pre>
                </div>
              ) : null}
              {resultLogs.length > 0 && (
                <div className="space-y-2 mt-3">
                  {resultLogs.map(log => {
                    const content = getLogContent(log);
                    return (
                      <div key={log.id} className="bg-slate-700/50 border border-slate-600/50 rounded p-2">
                        <span className="text-slate-500 text-xs">{formatTime(log.createdAt)}</span>
                        <span className={`ml-2 px-2 py-0.5 text-xs rounded ${
                          log.type === 'task_completed' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400'
                        }`}>
                          {log.type === 'task_completed' ? '完成' : '失败'}
                        </span>
                        <span className="ml-2 text-slate-300">{content}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {!taskDetail.result && !taskDetail.error && resultLogs.length === 0 && (
                <p className="text-slate-500 text-center py-8">暂无执行结果</p>
              )}
            </div>
          </div>
        </>
      )}

      {/* No Task Selected */}
      {!selectedTaskId && (
        <div className="bg-slate-800/80 rounded-lg border border-slate-700 p-8 text-center">
          <Terminal className="w-12 h-12 text-slate-500 mx-auto mb-4" />
          <p className="text-slate-400">请选择一个任务查看执行详情</p>
        </div>
      )}
    </div>
  );
}

interface WorkerLogsPageProps {
  nodeId?: string;
}

export default WorkerLogsPage;