'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { safeClipboardWrite } from '@/lib/clipboard';
import { useApiFetch } from '@/hooks/useApiFetch';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  Terminal,
  RefreshCw,
  Filter,
  Clock,
  Cpu,
  AlertTriangle,
  CheckCircle,
  Activity,
  Play,
  Send,
  Award,
  MessageSquare,
  Copy,
  Wrench,
  ChevronRight,
  Database,
  Brain,
  Layers,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { AnsiText } from '@/components/ui/AnsiText';

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
  taskName?: string | null;
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
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  time?: string;
  icon: React.ReactNode;
}

interface TimelineGroup {
  type: 'sequential' | 'parallel';
  phases: ExecutionPhase[];
}

const PRE_PHASES: ExecutionPhase[] = [
  { id: 'queued', name: '任务入队', status: 'pending', icon: <Clock className="w-4 h-4" /> },
  { id: 'dispatched', name: '分发Worker', status: 'pending', icon: <Send className="w-4 h-4" /> },
  { id: 'building', name: '构建环境', status: 'pending', icon: <Activity className="w-4 h-4" /> },
];

const PARALLEL_PHASES: ExecutionPhase[] = [
  { id: 'codedmap', name: '知识图谱', status: 'pending', icon: <Database className="w-4 h-4" /> },
  { id: 'executing', name: '执行命令', status: 'pending', icon: <Play className="w-4 h-4" /> },
];

const POST_PHASES: ExecutionPhase[] = [
  { id: 'completed', name: '执行完成', status: 'pending', icon: <CheckCircle className="w-4 h-4" /> },
];

const statusConfig: Record<string, { bg: string; text: string }> = {
  completed: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  failed: { bg: 'bg-red-500/10', text: 'text-red-400' },
  running: { bg: 'bg-blue-500/10', text: 'text-blue-400' },
  queued: { bg: 'bg-gray-500/10', text: 'text-gray-400' },
  dispatched: { bg: 'bg-purple-500/10', text: 'text-purple-400' },
  building: { bg: 'bg-yellow-500/10', text: 'text-yellow-400' },
};

export function WorkerLogsPage() {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState<'all' | 'worker' | 'agent'>('all');
  const [streamFilter, setStreamFilter] = useState<'all' | 'stdout' | 'stderr'>('all');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [resultCollapsed, setResultCollapsed] = useState(true);
  const [instructionCollapsed, setInstructionCollapsed] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsLoading, setLogsLoading] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: tasksData, loading: tasksLoading, refetch: refetchTasks } = useApiFetch<{ tasks: Task[] }>('/api/codeswarm/tasks');

  const LOG_PAGE_SIZE = 200;

  const fetchLogs = useCallback(async (taskId: string, append = false) => {
    const params = new URLSearchParams();
    if (levelFilter !== 'all') params.set('level', levelFilter);
    if (streamFilter !== 'all') params.set('stream', streamFilter);
    const offset = append ? logs.length : 0;
    params.set('offset', String(offset));
    params.set('limit', String(LOG_PAGE_SIZE));

    setLogsLoading(true);
    try {
      const res = await fetch(`/api/codeswarm/tasks/${taskId}/logs?${params.toString()}`);
      if (res.ok) {
        const data: LogsResponse = await res.json();
        if (append) {
          setLogs(prev => [...prev, ...(data.logs || [])]);
        } else {
          setLogs(data.logs || []);
        }
        setLogsTotal(data.total);
      }
    } catch {} finally {
      setLogsLoading(false);
    }
  }, [levelFilter, streamFilter, logs.length]);

  // 初始加载 + 切换任务/筛选时重置
  useEffect(() => {
    if (selectedTaskId) {
      setLogs([]);
      fetchLogs(selectedTaskId);
    } else {
      setLogs([]);
      setLogsTotal(0);
    }
  }, [selectedTaskId, levelFilter, streamFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedTaskId) {
      fetch(`/api/codeswarm/tasks/${selectedTaskId}`)
        .then(res => res.json())
        .then(data => { if (data.task) setTaskDetail(data.task); })
        .catch(console.error);
    } else {
      setTaskDetail(null);
    }
  }, [selectedTaskId]);

  const tasks = tasksData?.tasks || [];

  const statusCounts = tasks.reduce((acc, task) => {
    acc[task.state] = (acc[task.state] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const filteredTasks = tasks.filter(task =>
    (statusFilter === 'all' || task.state === statusFilter) &&
    ((task.taskId?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
    (task.taskName?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
    (task.instruction?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
    (task.state?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false))
  );

  useEffect(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (autoRefresh && selectedTaskId) {
      intervalRef.current = setInterval(() => {
        fetchLogs(selectedTaskId, true);
        fetch(`/api/codeswarm/tasks/${selectedTaskId}`)
          .then(res => res.json())
          .then(data => { if (data.task) setTaskDetail(data.task); })
          .catch(console.error);
      }, 2000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, selectedTaskId, fetchLogs]);

  useEffect(() => {
    if (logs.length > 0) logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
    try { return JSON.parse(data); }
    catch { return { raw: data }; }
  };

  const formatTime = (timestamp: string) => new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });

  const groupConsecutiveLogs = (logs: LogEntry[]): LogEntry[][] => {
    const groups: LogEntry[][] = [];
    let currentGroup: LogEntry[] = [];
    let lastTimestamp = 0;
    for (const log of logs) {
      const timestamp = new Date(log.createdAt).getTime();
      if (currentGroup.length > 0 && (timestamp - lastTimestamp > 500 || currentGroup[0].type !== log.type)) {
        groups.push(currentGroup);
        currentGroup = [];
      }
      currentGroup.push(log);
      lastTimestamp = timestamp;
    }
    if (currentGroup.length > 0) groups.push(currentGroup);
    return groups;
  };

  const getLogContent = (log: LogEntry): string => {
    const parsed = parseLogData(log.data);
    if (typeof parsed === 'object' && parsed !== null) {
      if ('content' in parsed) return (parsed as any).content;
      if ('message' in parsed) return (parsed as any).message;
      if ('data' in parsed && typeof (parsed as any).data === 'object' && 'content' in (parsed as any).data) return (parsed as any).data.content;
    }
    return log.data;
  };

  const getToolCallInfo = (log: LogEntry): { name: string; args: object } | null => {
    if (log.type !== 'tool_call') return null;
    const parsed = parseLogData(log.data);
    if (typeof parsed === 'object' && parsed !== null) {
      const input = (parsed as any).input || (parsed as any).data?.input;
      if (input && typeof input === 'object') return { name: (parsed as any).tool || (parsed as any).data?.tool || 'unknown', args: input };
    }
    return null;
  };

  const copyToClipboard = (text: string) => safeClipboardWrite(text).catch(console.error);

  const getGroupContent = (group: LogEntry[]): string => group.map(log => getLogContent(log)).join('');

  const buildTimeline = (): TimelineGroup[] => {
    const pre = PRE_PHASES.map(p => ({ ...p, status: 'pending' as ExecutionPhase['status'] }));
    const parallel = PARALLEL_PHASES.map(p => ({ ...p, status: 'pending' as ExecutionPhase['status'] }));
    const post = POST_PHASES.map(p => ({ ...p, status: 'pending' as ExecutionPhase['status'] }));

    if (!taskDetail) return [
      { type: 'sequential', phases: pre },
      { type: 'parallel', phases: parallel },
      { type: 'sequential', phases: post },
    ];

    const state = taskDetail.state;
    const hasCodedmapStart = logs.some(log => { try { const d = JSON.parse(log.data); return (log.type === 'phase_start' || d.type === 'phase_start') && d.phase === 'codedmap'; } catch { return false; } });
    const codedmapCompleteEvent = logs.find(log => { try { const d = JSON.parse(log.data); return (log.type === 'phase_complete' || d.type === 'phase_complete') && d.phase === 'codedmap'; } catch { return false; } });
    const codedmapSuccess = codedmapCompleteEvent ? (() => { try { return JSON.parse(codedmapCompleteEvent.data).success !== false; } catch { return true; } })() : false;
    const hasExecutingStart = logs.some(log => { try { const d = JSON.parse(log.data); return (log.type === 'phase_start' || d.type === 'phase_start') && d.phase === 'executing'; } catch { return false; } });
    const executingCompleteEvent = logs.find(log => { try { const d = JSON.parse(log.data); return (log.type === 'phase_complete' || d.type === 'phase_complete') && d.phase === 'executing'; } catch { return false; } });
    const executingSuccess = executingCompleteEvent ? (() => { try { return JSON.parse(executingCompleteEvent.data).success !== false; } catch { return true; } })() : false;

    // Pre phases: queued → dispatched → building
    pre[0].status = 'completed'; pre[0].time = taskDetail.createdAt;
    if (state === 'queued') return [{ type: 'sequential', phases: pre }, { type: 'parallel', phases: parallel }, { type: 'sequential', phases: post }];
    pre[1].status = 'completed'; pre[1].time = taskDetail.startedAt || taskDetail.createdAt;
    if (state === 'dispatched') { pre[2].status = 'running'; return [{ type: 'sequential', phases: pre }, { type: 'parallel', phases: parallel }, { type: 'sequential', phases: post }]; }
    if (state === 'building') { pre[2].status = 'running'; return [{ type: 'sequential', phases: pre }, { type: 'parallel', phases: parallel }, { type: 'sequential', phases: post }]; }
    pre[2].status = 'completed';

    // Parallel phases: codedmap and executing independently
    if (hasCodedmapStart) {
      if (codedmapCompleteEvent) { parallel[0].status = codedmapSuccess ? 'completed' : 'failed'; parallel[0].time = codedmapCompleteEvent.createdAt; }
      else parallel[0].status = 'running';
    } else {
      parallel[0].status = 'skipped';
    }

    if (state === 'completed') { parallel[1].status = executingSuccess ? 'completed' : 'failed'; }
    else if (state === 'failed') { parallel[1].status = 'failed'; }
    else if (hasExecutingStart && executingCompleteEvent) { parallel[1].status = executingSuccess ? 'completed' : 'failed'; parallel[1].time = executingCompleteEvent.createdAt; }
    else if (hasExecutingStart || ['running', 'dispatched'].includes(state) || (state === 'failed' && !taskDetail.completedAt)) { parallel[1].status = 'running'; }
    else { parallel[1].status = 'running'; }

    // Post phases: completed
    post[0].status = state === 'completed' ? 'completed' : state === 'failed' ? 'failed' : 'pending';
    if (taskDetail.completedAt) post[0].time = taskDetail.completedAt;

    return [
      { type: 'sequential', phases: pre },
      { type: 'parallel', phases: parallel },
      { type: 'sequential', phases: post },
    ];
  };

  const processLogs = logs.filter(log => !['task_completed', 'task_failed'].includes(log.type));
  const timeline = buildTimeline();

  return (
    <div className="flex h-[calc(100vh-140px)] bg-dark-bg">
      {/* Left Panel */}
      {sidebarCollapsed ? (
        <div className="w-[40px] border-r border-gray-700/50 flex flex-col bg-dark-surface min-h-0 items-center pt-3">
          <button onClick={() => setSidebarCollapsed(false)} className="p-1.5 text-gray-400 hover:text-gray-300 hover:bg-gray-700/30 rounded" title="展开侧栏"><PanelLeftOpen size={16} /></button>
        </div>
      ) : (
        <div className="w-[320px] border-r border-gray-700/50 flex flex-col bg-dark-surface min-h-0">
          <div className="flex-shrink-0 p-4 border-b border-gray-700/50">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Layers size={16} className="text-gray-400" />
                <span className="text-sm font-medium text-gray-100">任务列表</span>
<select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="h-6 min-w-[120px] px-2 text-xs bg-dark-bg border border-gray-700/50 rounded text-gray-300">
                  <option value="all">全部状态 ({tasks.length})</option>
                  <option value="completed">completed ({statusCounts.completed || 0})</option>
                  <option value="running">running ({statusCounts.running || 0})</option>
                  <option value="failed">failed ({statusCounts.failed || 0})</option>
                  <option value="queued">queued ({statusCounts.queued || 0})</option>
                  <option value="dispatched">dispatched ({statusCounts.dispatched || 0})</option>
                  <option value="building">building ({statusCounts.building || 0})</option>
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setSidebarCollapsed(true)} className="p-1.5 text-gray-400 hover:text-gray-300 hover:bg-gray-700/30 rounded" title="收起侧栏"><PanelLeftClose size={14} /></button>
                <button onClick={() => { refetchTasks(); if (selectedTaskId) fetchLogs(selectedTaskId); }} className="p-1.5 text-gray-400 hover:text-gray-300 hover:bg-gray-700/30 rounded"><RefreshCw size={14} /></button>
              </div>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-500" />
              <input type="text" placeholder="搜索任务..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full h-8 pl-9 pr-3 text-xs bg-dark-bg border border-gray-700/50 rounded text-gray-200 placeholder:text-gray-500 focus:ring-1 focus:ring-primary-500 focus:outline-none" />
            </div>
          </div>
          <div className="flex-1 overflow-auto min-h-0">
            {tasksLoading ? <div className="flex items-center justify-center h-32"><LoadingSpinner size="sm" /></div>
            : filteredTasks.length === 0 ? <div className="p-4 text-center text-sm text-gray-500">{searchQuery ? '未找到匹配任务' : '暂无任务'}</div>
            : <div className="p-2 space-y-1">{filteredTasks.map(task => {
              const config = statusConfig[task.state] || statusConfig.queued;
              const isSelected = selectedTaskId === task.taskId;
              return (
                <button key={task.taskId} onClick={() => setSelectedTaskId(task.taskId)} className={`w-full p-3 rounded-lg border text-left transition-all ${isSelected ? 'border-primary-500 bg-primary-500/10' : 'border-gray-700/50 bg-gray-800/50 hover:bg-gray-700/30'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-medium ${isSelected ? 'text-primary-300' : 'text-gray-300'}`}>{task.taskName || task.taskId.slice(0, 16) + '...'}</span>
                    <span className={`px-1.5 py-0.5 text-xs rounded ${config.bg} ${config.text}`}>{task.state}</span>
                  </div>
                  <p className="text-xs text-gray-500 truncate">{task.instruction ? (task.instruction.length > 50 ? task.instruction.slice(0, 50) + '...' : task.instruction) : '无指令'}</p>
                  <div className="flex items-center gap-1 mt-1 text-xs text-gray-500"><Clock size={10} /><span>{new Date(task.createdAt).toLocaleDateString('zh-CN')}</span></div>
                </button>
              );
            })}</div>}
          </div>
        </div>
      )}

      {/* Right Panel */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {selectedTaskId ? (
          <>
            <div className="flex-shrink-0 px-5 py-3 border-b border-gray-700/50 bg-dark-surface flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Terminal size={18} className="text-gray-400" />
                <span className="font-medium text-gray-100">任务执行详情</span>
                <span className="text-xs text-gray-500 font-mono">{selectedTaskId}</span>
              </div>
              <div className="flex items-center gap-3">
                <Filter size={14} className="text-gray-400" />
                <select value={levelFilter} onChange={e => setLevelFilter(e.target.value as any)} className="h-7 min-w-[90px] px-2 text-xs bg-dark-bg border border-gray-700/50 rounded text-gray-300"><option value="all">全部层级</option><option value="worker">Worker</option><option value="agent">Agent</option></select>
                <select value={streamFilter} onChange={e => setStreamFilter(e.target.value as any)} className="h-7 min-w-[90px] px-2 text-xs bg-dark-bg border border-gray-700/50 rounded text-gray-300"><option value="all">全部流</option><option value="stdout">stdout</option><option value="stderr">stderr</option></select>
                <label className="flex items-center gap-1.5 text-xs text-gray-400"><input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="w-3 h-3 rounded" />自动刷新</label>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-5 space-y-4 min-h-0 flex flex-col">
              {taskDetail && (
                <>
                  <div className="flex-shrink-0 bg-dark-surface border border-gray-700/50 rounded-lg p-3">
                    <h3 className="text-xs font-medium text-gray-500 uppercase mb-2">执行时间线</h3>
                    <div className="flex items-stretch">
                      {timeline.map((group, gi) => {
                        if (group.type === 'sequential') {
                          return group.phases.map((phase, pi) => (
                            <div key={phase.id} className="flex items-center flex-1">
                              <div className="flex flex-col items-center">
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 ${phase.status === 'completed' ? 'bg-emerald-600 border-emerald-400 text-white' : phase.status === 'running' ? 'bg-blue-600 border-blue-400 text-white animate-pulse' : phase.status === 'failed' ? 'bg-red-600 border-red-400 text-white' : phase.status === 'skipped' ? 'bg-gray-600 border-gray-400 text-gray-300' : 'bg-gray-700 border-gray-500 text-gray-400'}`}>{phase.icon}</div>
                                <span className={`text-[11px] mt-1 text-center ${phase.status === 'pending' || phase.status === 'skipped' ? 'text-gray-500' : 'text-gray-300'}`}>{phase.name}</span>
                                {phase.status === 'skipped' && <span className="text-[10px] text-gray-500">(跳过)</span>}
                              </div>
                              {!(gi === timeline.length - 1 && pi === group.phases.length - 1) && <div className={`flex-1 h-0.5 mx-0.5 ${phase.status === 'completed' ? 'bg-emerald-600' : 'bg-gray-600'}`} />}
                            </div>
                          ));
                        }
                        // Parallel group: fork-merge display
                        return (
                          <div key={`parallel-${gi}`} className="flex-1 flex flex-col">
                            <div className="flex-1 flex items-center justify-center h-3">
                              <div className="w-full border-t-2 border-l-2 border-r-2 border-b-0 border-gray-600 rounded-t-sm h-full" />
                            </div>
                            <div className="flex gap-1 py-0.5">
                              {group.phases.map(phase => (
                                <div key={phase.id} className="flex-1 flex flex-col items-center">
                                  <div className={`w-5 h-5 rounded-full flex items-center justify-center border-2 ${phase.status === 'completed' ? 'bg-emerald-600 border-emerald-400 text-white' : phase.status === 'running' ? 'bg-blue-600 border-blue-400 text-white animate-pulse' : phase.status === 'failed' ? 'bg-red-600 border-red-400 text-white' : phase.status === 'skipped' ? 'bg-gray-600 border-gray-400 text-gray-300' : 'bg-gray-700 border-gray-500 text-gray-400'}`}>
                                    <span className="scale-75">{phase.icon}</span>
                                  </div>
                                  <span className={`text-[10px] mt-0.5 text-center ${phase.status === 'pending' || phase.status === 'skipped' ? 'text-gray-500' : 'text-gray-300'}`}>{phase.name}</span>
                                  {phase.status === 'skipped' && <span className="text-[10px] text-gray-500">(跳过)</span>}
                                  {phase.status === 'running' && <span className="text-[10px] text-blue-400 animate-pulse">并行中</span>}
                                </div>
                              ))}
                            </div>
                            <div className="flex-1 flex items-center justify-center h-3">
                              <div className="w-full border-b-2 border-l-2 border-r-2 border-t-0 border-gray-600 rounded-b-sm h-full" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex-shrink-0 bg-dark-surface border border-gray-700/50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex items-center gap-1"><span className="text-gray-500">状态</span><span className={`font-medium ${taskDetail.state === 'completed' ? 'text-emerald-400' : taskDetail.state === 'failed' ? 'text-red-400' : 'text-blue-400'}`}>{taskDetail.state}</span></div>
                      <div className="flex items-center gap-1"><span className="text-gray-500">Agent</span><span className="text-gray-200 truncate">{taskDetail.agent || '未指定'}</span></div>
                      <div className="flex items-center gap-1"><span className="text-gray-500">创建</span><span className="text-gray-200">{new Date(taskDetail.createdAt).toLocaleString('zh-CN')}</span></div>
                      <div className="flex items-center gap-1"><span className="text-gray-500">完成</span><span className="text-gray-200">{taskDetail.completedAt ? new Date(taskDetail.completedAt).toLocaleString('zh-CN') : '-'}</span></div>
                      <button onClick={() => setInstructionCollapsed(!instructionCollapsed)} className="ml-auto flex items-center gap-1 text-gray-400 hover:text-gray-200">{instructionCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}<span>指令</span></button>
                    </div>
                    {!instructionCollapsed && <div className="mt-2 pt-2 border-t border-gray-700/50 text-gray-300 text-xs">{taskDetail.instruction || '无指令'}</div>}
                  </div>
                </>
              )}

              <div className="flex-1 min-h-[200px] bg-dark-surface border border-gray-700/50 rounded-lg flex flex-col">
                <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-700/50">
                  <div className="flex items-center gap-2">
                    <Play size={14} className="text-blue-400" />
                    <span className="text-sm font-medium text-gray-200">执行过程日志</span>
                    <span className="text-xs text-gray-500">({processLogs.length} 条)</span>
                  </div>
                  {logsLoading && <LoadingSpinner size="sm" />}
                </div>
                <div className="flex-1 overflow-y-auto p-4 font-mono text-sm min-h-0">
                  {processLogs.length === 0 ? <div className="text-center py-8 text-gray-500">暂无执行日志</div>
                  : <div className="space-y-2">{groupConsecutiveLogs(processLogs).map((group, gi) => {
                    const content = getGroupContent(group);
                    const first = group[0];
                    const isMultiLine = content.includes('\n');
                    const isExpanded = expandedLogs.has(`g-${gi}`);
                    const isAgent = first.level === 'agent';
                    const isError = first.stream === 'stderr' || first.type === 'error';
                    const isTool = first.type === 'tool_call';
                    const isCodedmap = content.includes('[Codedmap]') || (() => { try { const d = JSON.parse(first.data); return (first.type === 'phase_start' || first.type === 'phase_complete') && d.phase === 'codedmap'; } catch { return false; } })();
                    const toolInfo = getToolCallInfo(first);
                    return (
                      <div key={`g-${gi}`} className={`w-full border-l-2 ${isError ? 'border-l-red-500 bg-red-900/10' : isCodedmap ? 'border-l-indigo-500 bg-indigo-900/10' : isTool ? 'border-l-amber-500 bg-amber-900/10' : isAgent ? 'border-l-blue-500 bg-blue-900/10' : 'border-l-gray-500 bg-gray-800/30'} px-3 py-1.5`}>
                          <div className="flex items-center gap-2 text-xs opacity-60 mb-0.5">
                            <span className="flex items-center gap-1">{isCodedmap ? <Brain size={12} /> : isTool ? <Wrench size={12} /> : isAgent ? <MessageSquare size={12} /> : <Cpu size={12} />}<span className={`font-medium ${isError ? 'text-red-400' : isCodedmap ? 'text-indigo-400' : isTool ? 'text-amber-400' : isAgent ? 'text-blue-400' : 'text-gray-400'}`}>{isCodedmap ? 'Codedmap' : isTool ? 'Tool' : isAgent ? 'Agent' : 'Worker'}</span></span>
                            <span className="font-mono text-gray-500">{formatTime(first.createdAt)}</span>
                            <button onClick={() => copyToClipboard(content)} className="ml-auto text-gray-400 hover:text-gray-200"><Copy size={12} /></button>
                          </div>
                          {isTool && toolInfo && <div className="mb-1 bg-gray-900/50 rounded p-2 border border-amber-600/30"><div className="flex items-center gap-1.5 text-amber-300 font-medium mb-1"><Wrench size={12} /><span className="font-mono text-xs">{toolInfo.name}</span></div><pre className="text-xs text-gray-300 overflow-x-auto max-h-32">{JSON.stringify(toolInfo.args, null, 2)}</pre></div>}
                          {isMultiLine || content.length > 200 ? <div><AnsiText text={content} className={`text-sm whitespace-pre-wrap break-all font-mono ${!isExpanded ? 'max-h-32 overflow-hidden' : ''}`} /><button onClick={() => toggleExpand(`g-${gi}`)} className="mt-0.5 flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">{isExpanded ? <ChevronRight size={12} className="rotate-90" /> : <ChevronRight size={12} />}{isExpanded ? '收起' : '展开'}</button></div> : <AnsiText text={content} as="div" className="text-sm" />}
                        </div>
                    );
                  })}<div ref={logsEndRef} /></div>}
                </div>
              </div>

              <div className="flex-shrink-0 bg-dark-surface border border-gray-700/50 rounded-lg">
                <button onClick={() => setResultCollapsed(!resultCollapsed)} className="w-full flex items-center gap-2 px-4 py-2 border-b border-gray-700/50 hover:bg-gray-700/20 transition-colors">
                  <Award size={14} className="text-amber-400" />
                  <span className="text-sm font-medium text-gray-200">执行结果</span>
                  {resultCollapsed ? <ChevronRight size={14} className="ml-auto text-gray-400" /> : <ChevronDown size={14} className="ml-auto text-gray-400" />}
                </button>
                {!resultCollapsed && (
                  <div className="p-4 max-h-[200px] overflow-y-auto">
                    {taskDetail?.result && <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-lg p-3"><div className="text-emerald-400 text-xs uppercase mb-1">执行结果</div><AnsiText text={taskDetail.result} className="text-gray-200 whitespace-pre-wrap break-all text-xs" /></div>}
                    {taskDetail?.error && <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 mt-2"><div className="text-red-400 text-xs uppercase mb-1">错误信息</div><AnsiText text={taskDetail.error} className="text-red-300 whitespace-pre-wrap break-all text-xs" /></div>}
                    {!taskDetail?.result && !taskDetail?.error && <div className="text-center py-4 text-gray-500 text-sm">暂无执行结果</div>}
                  </div>
                )}
              </div>

              {!taskDetail && <div className="text-center py-8 text-gray-500 text-sm">暂无任务详情</div>}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Terminal className="w-12 h-12 text-gray-500 mx-auto mb-4" />
              <p className="text-gray-400">请从左侧选择一个任务查看执行详情</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default WorkerLogsPage;