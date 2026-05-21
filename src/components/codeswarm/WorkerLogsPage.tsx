'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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

const EXECUTION_PHASES: ExecutionPhase[] = [
  { id: 'queued', name: '任务入队', status: 'pending', icon: <Clock className="w-4 h-4" /> },
  { id: 'dispatched', name: '分发Worker', status: 'pending', icon: <Send className="w-4 h-4" /> },
  { id: 'building', name: '构建环境', status: 'pending', icon: <Activity className="w-4 h-4" /> },
  { id: 'codedmap', name: '知识图谱', status: 'pending', icon: <Database className="w-4 h-4" /> },
  { id: 'executing', name: '执行命令', status: 'pending', icon: <Play className="w-4 h-4" /> },
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
  const logsEndRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: tasksData, loading: tasksLoading, refetch: refetchTasks } = useApiFetch<{ tasks: Task[] }>('/api/codeswarm/tasks');

  const buildLogsUrl = useCallback(() => {
    if (!selectedTaskId) return null;
    const params = new URLSearchParams();
    if (levelFilter !== 'all') params.set('level', levelFilter);
    if (streamFilter !== 'all') params.set('stream', streamFilter);
    return `/api/codeswarm/tasks/${selectedTaskId}/logs?${params.toString()}`;
  }, [selectedTaskId, levelFilter, streamFilter]);

  const logsUrl = buildLogsUrl();
  const { data: logsData, loading: logsLoading, refetch: refetchLogs } = useApiFetch<LogsResponse>(logsUrl);

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
  const logs = logsData?.logs || [];

  const statusCounts = tasks.reduce((acc, task) => {
    acc[task.state] = (acc[task.state] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  useEffect(() => {
    if (!selectedTaskId && tasks.length > 0) setSelectedTaskId(tasks[0].taskId);
  }, [tasks, selectedTaskId]);

  const filteredTasks = tasks.filter(task =>
    (statusFilter === 'all' || task.state === statusFilter) &&
    ((task.taskId?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
    (task.instruction?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
    (task.state?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false))
  );

  useEffect(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (autoRefresh && selectedTaskId) {
      intervalRef.current = setInterval(() => {
        refetchLogs();
        fetch(`/api/codeswarm/tasks/${selectedTaskId}`)
          .then(res => res.json())
          .then(data => { if (data.task) setTaskDetail(data.task); })
          .catch(console.error);
      }, 2000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, selectedTaskId, refetchLogs]);

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

  const copyToClipboard = (text: string) => navigator.clipboard.writeText(text).then(() => {}).catch(console.error);

  const getGroupContent = (group: LogEntry[]): string => group.map(log => getLogContent(log)).join('');

  const buildTimeline = (): ExecutionPhase[] => {
    if (!taskDetail) return EXECUTION_PHASES.map(p => ({ ...p, status: 'pending' as ExecutionPhase['status'] }));
    const phases: ExecutionPhase[] = EXECUTION_PHASES.map(p => ({ ...p, status: 'pending' as ExecutionPhase['status'] }));
    const state = taskDetail.state;
    const hasCodedmapStart = logs.some(log => { try { const d = JSON.parse(log.data); return (log.type === 'phase_start' || d.type === 'phase_start') && d.phase === 'codedmap'; } catch { return false; } });
    const codedmapCompleteEvent = logs.find(log => { try { const d = JSON.parse(log.data); return (log.type === 'phase_complete' || d.type === 'phase_complete') && d.phase === 'codedmap'; } catch { return false; } });
    const codedmapSuccess = codedmapCompleteEvent ? (() => { try { return JSON.parse(codedmapCompleteEvent.data).success !== false; } catch { return true; } })() : false;

    phases[0].status = 'completed';
    phases[0].time = taskDetail.createdAt;
    if (state === 'queued') return phases;
    phases[1].status = 'completed';
    phases[1].time = taskDetail.startedAt || taskDetail.createdAt;
    if (state === 'dispatched') { phases[2].status = 'running'; return phases; }
    if (state === 'building') { phases[2].status = 'running'; return phases; }
    phases[2].status = 'completed';
    if (hasCodedmapStart) {
      if (codedmapCompleteEvent) { phases[3].status = codedmapSuccess ? 'completed' : 'failed'; phases[3].time = codedmapCompleteEvent.createdAt; }
      else phases[3].status = 'running';
    } else phases[3].status = 'completed';
    if (['running', 'dispatched'].includes(state) || (state === 'failed' && !taskDetail.completedAt)) { phases[4].status = state === 'failed' ? 'failed' : 'running'; return phases; }
    phases[4].status = state === 'completed' ? 'completed' : 'failed';
    phases[5].status = state === 'completed' ? 'completed' : 'failed';
    if (taskDetail.completedAt) phases[5].time = taskDetail.completedAt;
    return phases;
  };

  const processLogs = logs.filter(log => !['task_completed', 'task_failed'].includes(log.type));
  const timeline = buildTimeline();

  return (
    <div className="flex h-[calc(100vh-180px)] bg-[#0F172A]">
      {/* Left Panel */}
      <div className="w-[280px] border-r border-gray-700/50 flex flex-col bg-dark-surface min-h-0">
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
            <button onClick={() => { refetchTasks(); refetchLogs(); }} className="p-1.5 text-gray-400 hover:text-gray-300 hover:bg-gray-700/30 rounded"><RefreshCw size={14} /></button>
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
                  <span className={`text-xs font-medium truncate ${isSelected ? 'text-primary-300' : 'text-gray-300'}`}>{task.taskId ? task.taskId.slice(0, 16) + '...' : 'N/A'}</span>
                  <span className={`px-1.5 py-0.5 text-xs rounded ${config.bg} ${config.text}`}>{task.state}</span>
                </div>
                <p className="text-xs text-gray-500 truncate">{task.instruction ? (task.instruction.length > 30 ? task.instruction.slice(0, 30) + '...' : task.instruction) : '无指令'}</p>
                <div className="flex items-center gap-1 mt-1 text-xs text-gray-500"><Clock size={10} /><span>{new Date(task.createdAt).toLocaleDateString('zh-CN')}</span></div>
              </button>
            );
          })}</div>}
        </div>
      </div>

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
                  <div className="flex-shrink-0 bg-dark-surface border border-gray-700/50 rounded-lg p-4">
                    <h3 className="text-xs font-medium text-gray-500 uppercase mb-3">执行时间线</h3>
                    <div className="flex items-center">{timeline.map((phase, i) => (
                      <div key={phase.id} className="flex items-center flex-1">
                        <div className="flex flex-col items-center">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${phase.status === 'completed' ? 'bg-emerald-600 border-emerald-400 text-white' : phase.status === 'running' ? 'bg-blue-600 border-blue-400 text-white animate-pulse' : phase.status === 'failed' ? 'bg-red-600 border-red-400 text-white' : 'bg-gray-700 border-gray-500 text-gray-400'}`}>{phase.icon}</div>
                          <span className={`text-xs mt-1.5 ${phase.status === 'pending' ? 'text-gray-500' : 'text-gray-300'}`}>{phase.name}</span>
                        </div>
                        {i < timeline.length - 1 && <div className={`flex-1 h-0.5 mx-1 ${phase.status === 'completed' ? 'bg-emerald-600' : 'bg-gray-600'}`} />}
                      </div>
                    ))}</div>
                  </div>

                  <div className="flex-shrink-0 bg-dark-surface border border-gray-700/50 rounded-lg p-4">
                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <div><span className="text-gray-500 text-xs">状态</span><div className="mt-1"><span className={`font-medium ${taskDetail.state === 'completed' ? 'text-emerald-400' : taskDetail.state === 'failed' ? 'text-red-400' : 'text-blue-400'}`}>{taskDetail.state}</span></div></div>
                      <div><span className="text-gray-500 text-xs">Agent</span><div className="mt-1 text-gray-200 truncate">{taskDetail.agent || '未指定'}</div></div>
                      <div><span className="text-gray-500 text-xs">创建时间</span><div className="mt-1 text-gray-200">{new Date(taskDetail.createdAt).toLocaleString('zh-CN')}</div></div>
                      <div><span className="text-gray-500 text-xs">完成时间</span><div className="mt-1 text-gray-200">{taskDetail.completedAt ? new Date(taskDetail.completedAt).toLocaleString('zh-CN') : '-'}</div></div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-700/50"><span className="text-gray-500 text-xs">执行指令</span><div className="mt-1 text-gray-300 text-xs">{taskDetail.instruction || '无指令'}</div></div>
                  </div>
                </>
              )}

              <div className="flex-1 min-h-0 bg-dark-surface border border-gray-700/50 rounded-lg flex flex-col">
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
                      <div key={`g-${gi}`} className={`flex ${isAgent ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-lg px-3 py-2 ${isError ? 'bg-red-900/20 border border-red-500/30 text-red-200' : isCodedmap ? 'bg-indigo-900/20 border border-indigo-500/30 text-indigo-100' : isTool ? 'bg-amber-900/20 border border-amber-500/30 text-amber-100' : isAgent ? 'bg-blue-600/20 border border-blue-500/30 text-blue-100' : 'bg-gray-700/50 border border-gray-600/30 text-gray-200'}`}>
                          <div className="flex items-center justify-between gap-2 mb-1 text-xs opacity-60">
                            <div className="flex items-center gap-1.5">{isCodedmap ? <Brain size={12} /> : isTool ? <Wrench size={12} /> : isAgent ? <MessageSquare size={12} /> : <Cpu size={12} />}<span>{isCodedmap ? 'Codedmap' : isTool ? 'Tool' : isAgent ? 'Agent' : 'Worker'}</span><span className="font-mono">{formatTime(first.createdAt)}</span></div>
                            <button onClick={() => copyToClipboard(content)} className="text-gray-400 hover:text-gray-200"><Copy size={12} /></button>
                          </div>
                          {isTool && toolInfo && <div className="mb-2 bg-gray-900/50 rounded p-2 border border-amber-600/30"><div className="flex items-center gap-1.5 text-amber-300 font-medium mb-1"><Wrench size={12} /><span className="font-mono text-xs">{toolInfo.name}</span></div><pre className="text-xs text-gray-300 overflow-x-auto max-h-32">{JSON.stringify(toolInfo.args, null, 2)}</pre></div>}
                          {isMultiLine || content.length > 200 ? <div><pre className={`text-xs whitespace-pre-wrap break-all font-mono ${!isExpanded ? 'max-h-20 overflow-hidden' : ''}`}>{content}</pre><button onClick={() => toggleExpand(`g-${gi}`)} className="mt-1 flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">{isExpanded ? <ChevronRight size={12} className="rotate-90" /> : <ChevronRight size={12} />}{isExpanded ? '收起' : '展开'}</button></div> : <div className="text-xs">{content}</div>}
                        </div>
                      </div>
                    );
                  })}<div ref={logsEndRef} /></div>}
                </div>
              </div>

              <div className="flex-shrink-0 bg-dark-surface border border-gray-700/50 rounded-lg">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700/50"><Award size={14} className="text-amber-400" /><span className="text-sm font-medium text-gray-200">执行结果</span></div>
                <div className="p-4 max-h-[200px] overflow-y-auto">
                  {taskDetail?.result && <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-lg p-3"><div className="text-emerald-400 text-xs uppercase mb-1">执行结果</div><pre className="text-gray-200 whitespace-pre-wrap break-all text-xs">{taskDetail.result}</pre></div>}
                  {taskDetail?.error && <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 mt-2"><div className="text-red-400 text-xs uppercase mb-1">错误信息</div><pre className="text-red-300 whitespace-pre-wrap break-all text-xs">{taskDetail.error}</pre></div>}
                  {!taskDetail?.result && !taskDetail?.error && <div className="text-center py-4 text-gray-500 text-sm">暂无执行结果</div>}
                </div>
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