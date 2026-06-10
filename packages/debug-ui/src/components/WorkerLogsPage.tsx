import { useState, useEffect, useRef, useCallback } from 'react';
import { useApiFetch } from '@/lib/use-api-fetch';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import {
  Terminal, RefreshCw, Clock, CheckCircle, Activity, Play, Send,
  Copy, Wrench, ChevronRight, ChevronDown, ChevronUp,
  PanelLeftClose, PanelLeftOpen, MessageSquare, Cpu, Layers, Search,
} from 'lucide-react';

interface Task {
  taskId: string;
  taskName?: string | null;
  state: string;
  instruction: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  agent?: string;
}

interface TaskDetail extends Task {
  events: any[];
  result?: string;
  error?: string;
  workspacePath?: string;
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

export default function WorkerLogsPage() {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [resultCollapsed, setResultCollapsed] = useState(true);
  const [instructionCollapsed, setInstructionCollapsed] = useState(true);
  const [events, setEvents] = useState<any[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: tasksData, loading: tasksLoading, refetch: refetchTasks } = useApiFetch<{ tasks: Task[] }>('/api/task/list');

  // Fetch task detail + events when selecting a task
  useEffect(() => {
    if (selectedTaskId) {
      fetch(`/api/task/${selectedTaskId}`)
        .then(res => res.json())
        .then(data => {
          if (data.taskId) {
            setTaskDetail(data as TaskDetail);
            setEvents(data.events || []);
          } else if (data.events) {
            setTaskDetail(data as TaskDetail);
            setEvents(data.events || []);
          }
        })
        .catch(console.error);
    } else {
      setTaskDetail(null);
      setEvents([]);
    }
  }, [selectedTaskId]);

  const tasks = tasksData?.tasks || [];
  const statusCounts = tasks.reduce((acc, task) => { acc[task.state] = (acc[task.state] || 0) + 1; return acc; }, {} as Record<string, number>);

  const filteredTasks = tasks.filter(task =>
    (statusFilter === 'all' || task.state === statusFilter) &&
    ((task.taskId?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
    (task.taskName?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
    (task.instruction?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false))
  );

  useEffect(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (autoRefresh && selectedTaskId) {
      intervalRef.current = setInterval(() => {
        fetch(`/api/task/${selectedTaskId}`)
          .then(res => res.json())
          .then(data => { if (data.taskId || data.events) { setTaskDetail(data as TaskDetail); setEvents(data.events || []); } })
          .catch(console.error);
      }, 2000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, selectedTaskId]);

  const toggleExpand = (id: string) => {
    setExpandedLogs(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  };

  const cleanText = (t: string, max = 150): string => {
    if (!t) return '';
    try { t = JSON.parse(`"${t}"`); } catch {}
    t = t.replace(/\\n/g, ' ').replace(/\\t/g, ' ').replace(/\\"/g, '"').replace(/  +/g, ' ').trim();
    return t.length > max ? t.slice(0, max) + '...' : t;
  };

  const formatTime = (timestamp: string) => new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const getEventContent = (event: any): string => {
    const data = event.data;
    if (typeof data === 'string') { try { const p = JSON.parse(data); if (p.content) return p.content; if (p.message) return p.message; return data; } catch { return data; } }
    if (typeof data === 'object' && data !== null) {
      if (data.content) return data.content;
      if (data.message) return data.message;
      if (data.output) return cleanText(data.output, 150);
    }
    return event.content || '';
  };

  const getEventBadge = (event: any): { badge: string; color: string } => {
    const t = event.type;
    if (t === 'tool_call') return { badge: 'Tool', color: 'bg-yellow-900/50 text-yellow-400' };
    if (t === 'error') return { badge: 'Error', color: 'bg-red-900/50 text-red-400' };
    if (t === 'skill_start') return { badge: 'Skill', color: 'bg-purple-900/50 text-purple-400' };
    if (t === 'skill_complete') return { badge: 'Skill✓', color: 'bg-purple-900/40 text-purple-300' };
    if (t === 'phase_start' || t === 'phase_complete') return { badge: 'Phase', color: 'bg-cyan-900/50 text-cyan-400' };
    return { badge: t, color: 'bg-gray-700 text-gray-300' };
  };

  const buildTimeline = (): TimelineGroup[] => {
    const pre = PRE_PHASES.map(p => ({ ...p, status: 'pending' as ExecutionPhase['status'] }));
    const parallel = PARALLEL_PHASES.map(p => ({ ...p, status: 'pending' as ExecutionPhase['status'] }));
    const post = POST_PHASES.map(p => ({ ...p, status: 'pending' as ExecutionPhase['status'] }));
    if (!taskDetail) return [{ type: 'sequential', phases: pre }, { type: 'parallel', phases: parallel }, { type: 'sequential', phases: post }];
    const state = taskDetail.state;
    pre[0].status = 'completed'; pre[0].time = taskDetail.createdAt;
    if (state === 'queued') return [{ type: 'sequential', phases: pre }, { type: 'parallel', phases: parallel }, { type: 'sequential', phases: post }];
    pre[1].status = 'completed'; pre[1].time = taskDetail.startedAt || taskDetail.createdAt;
    if (state === 'dispatched' || state === 'building') { pre[2].status = 'running'; return [{ type: 'sequential', phases: pre }, { type: 'parallel', phases: parallel }, { type: 'sequential', phases: post }]; }
    pre[2].status = 'completed';
    if (state === 'completed') { parallel[0].status = 'completed'; }
    else if (state === 'failed') { parallel[0].status = 'failed'; }
    else { parallel[0].status = 'running'; }
    post[0].status = state === 'completed' ? 'completed' : state === 'failed' ? 'failed' : 'pending';
    if (taskDetail.completedAt) post[0].time = taskDetail.completedAt;
    return [{ type: 'sequential', phases: pre }, { type: 'parallel', phases: parallel }, { type: 'sequential', phases: post }];
  };

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
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setSidebarCollapsed(true)} className="p-1.5 text-gray-400 hover:text-gray-300 hover:bg-gray-700/30 rounded"><PanelLeftClose size={14} /></button>
                <button onClick={() => refetchTasks()} className="p-1.5 text-gray-400 hover:text-gray-300 hover:bg-gray-700/30 rounded"><RefreshCw size={14} /></button>
              </div>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-500" />
              <input type="text" placeholder="搜索任务..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full h-8 pl-9 pr-3 text-xs bg-dark-bg border border-gray-700/50 rounded text-gray-200 placeholder:text-gray-500 focus:ring-1 focus:ring-blue-500 focus:outline-none" />
            </div>
          </div>
          <div className="flex-1 overflow-auto min-h-0">
            {tasksLoading ? <div className="flex items-center justify-center h-32"><LoadingSpinner size="sm" /></div>
            : filteredTasks.length === 0 ? <div className="p-4 text-center text-sm text-gray-500">{searchQuery ? '未找到匹配任务' : '暂无任务'}</div>
            : <div className="p-2 space-y-1">{filteredTasks.map(task => {
              const config = statusConfig[task.state] || statusConfig.queued;
              const isSelected = selectedTaskId === task.taskId;
              return (
                <button key={task.taskId} onClick={() => setSelectedTaskId(task.taskId)} className={`w-full p-3 rounded-lg border text-left transition-all ${isSelected ? 'border-blue-500 bg-blue-500/10' : 'border-gray-700/50 bg-gray-800/50 hover:bg-gray-700/30'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-medium ${isSelected ? 'text-blue-300' : 'text-gray-300'}`}>{task.taskName || task.taskId.slice(0, 16) + '...'}</span>
                    <span className={`px-1.5 py-0.5 text-xs rounded ${config.bg} ${config.text}`}>{task.state}</span>
                  </div>
                  <p className="text-xs text-gray-500 truncate">{task.instruction ? (task.instruction.length > 50 ? task.instruction.slice(0, 50) + '...' : task.instruction) : '无指令'}</p>
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
              <label className="flex items-center gap-1.5 text-xs text-gray-400"><input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="w-3 h-3 rounded" />自动刷新</label>
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
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 ${phase.status === 'completed' ? 'bg-emerald-600 border-emerald-400 text-white' : phase.status === 'running' ? 'bg-blue-600 border-blue-400 text-white animate-pulse' : phase.status === 'failed' ? 'bg-red-600 border-red-400 text-white' : 'bg-gray-700 border-gray-500 text-gray-400'}`}>{phase.icon}</div>
                                <span className={`text-[11px] mt-1 text-center ${phase.status === 'pending' ? 'text-gray-500' : 'text-gray-300'}`}>{phase.name}</span>
                              </div>
                              {!(gi === timeline.length - 1 && pi === group.phases.length - 1) && <div className={`flex-1 h-0.5 mx-0.5 ${phase.status === 'completed' ? 'bg-emerald-600' : 'bg-gray-600'}`} />}
                            </div>
                          ));
                        }
                        return (
                          <div key={`parallel-${gi}`} className="flex-1 flex flex-col">
                            <div className="flex-1 flex items-center justify-center h-3"><div className="w-full border-t-2 border-l-2 border-r-2 border-b-0 border-gray-600 rounded-t-sm h-full" /></div>
                            <div className="flex gap-1 py-0.5">
                              {group.phases.map(phase => (
                                <div key={phase.id} className="flex-1 flex flex-col items-center">
                                  <div className={`w-5 h-5 rounded-full flex items-center justify-center border-2 ${phase.status === 'completed' ? 'bg-emerald-600 border-emerald-400 text-white' : phase.status === 'running' ? 'bg-blue-600 border-blue-400 text-white animate-pulse' : phase.status === 'failed' ? 'bg-red-600 border-red-400 text-white' : 'bg-gray-700 border-gray-500 text-gray-400'}`}>
                                    <span className="scale-75">{phase.icon}</span>
                                  </div>
                                  <span className={`text-[10px] mt-0.5 text-center ${phase.status === 'pending' ? 'text-gray-500' : 'text-gray-300'}`}>{phase.name}</span>
                                </div>
                              ))}
                            </div>
                            <div className="flex-1 flex items-center justify-center h-3"><div className="w-full border-b-2 border-l-2 border-r-2 border-t-0 border-gray-600 rounded-b-sm h-full" /></div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex-shrink-0 bg-dark-surface border border-gray-700/50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex items-center gap-1"><span className="text-gray-500">状态</span><span className={`font-medium ${taskDetail.state === 'completed' ? 'text-emerald-400' : taskDetail.state === 'failed' ? 'text-red-400' : 'text-blue-400'}`}>{taskDetail.state}</span></div>
                      <div className="flex items-center gap-1"><span className="text-gray-500">Agent</span><span className="text-gray-200">{taskDetail.agent || '未指定'}</span></div>
                      <button onClick={() => setInstructionCollapsed(!instructionCollapsed)} className="ml-auto flex items-center gap-1 text-gray-400 hover:text-gray-200">{instructionCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}<span>指令</span></button>
                    </div>
                    {!instructionCollapsed && <div className="mt-2 pt-2 border-t border-gray-700/50 text-gray-300 text-xs">{taskDetail.instruction || '无指令'}</div>}
                  </div>
                </>
              )}

              <div className="flex-1 min-h-[200px] bg-dark-surface border border-gray-700/50 rounded-lg flex flex-col">
                <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-gray-700/50">
                  <Play size={14} className="text-blue-400" />
                  <span className="text-sm font-medium text-gray-200">执行过程日志</span>
                  <span className="text-xs text-gray-500">({events.length} 条)</span>
                </div>
                <div className="flex-1 overflow-y-auto p-4 font-mono text-sm min-h-0">
                  {events.length === 0 ? <div className="text-center py-8 text-gray-500">暂无执行日志</div> : (
                    <div className="space-y-1">
                      {events.map((event, i) => {
                        const { badge, color } = getEventBadge(event);
                        const content = getEventContent(event);
                        const isExpanded = expandedLogs.has(`e-${i}`);
                        const isLong = content.length > 200;
                        return (
                          <div key={i} className={`w-full border-l-2 px-3 py-1.5 ${event.type === 'error' ? 'border-l-red-500 bg-red-900/10' : event.type === 'tool_call' ? 'border-l-amber-500 bg-amber-900/10' : 'border-l-gray-500 bg-gray-800/30'}`}>
                            <div className="flex items-center gap-2 text-xs opacity-60 mb-0.5">
                              <span className="font-mono text-gray-500">{event.timestamp ? formatTime(event.timestamp) : ''}</span>
                              <span className={`px-1 rounded text-[10px] ${color}`}>{badge}</span>
                              <button onClick={() => navigator.clipboard.writeText(content).catch(() => {})} className="ml-auto text-gray-400 hover:text-gray-200"><Copy size={12} /></button>
                            </div>
                            {isLong ? (
                              <div>
                                <pre className={`text-sm whitespace-pre-wrap break-all font-mono ${!isExpanded ? 'max-h-24 overflow-hidden' : ''}`}>{content}</pre>
                                <button onClick={() => toggleExpand(`e-${i}`)} className="mt-0.5 flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
                                  {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}{isExpanded ? '收起' : '展开'}
                                </button>
                              </div>
                            ) : <div className="text-sm text-gray-300">{content}</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-shrink-0 bg-dark-surface border border-gray-700/50 rounded-lg">
                <button onClick={() => setResultCollapsed(!resultCollapsed)} className="w-full flex items-center gap-2 px-4 py-2 border-b border-gray-700/50 hover:bg-gray-700/20 transition-colors">
                  <span className="text-sm font-medium text-gray-200">执行结果</span>
                  {resultCollapsed ? <ChevronRight size={14} className="ml-auto text-gray-400" /> : <ChevronDown size={14} className="ml-auto text-gray-400" />}
                </button>
                {!resultCollapsed && (
                  <div className="p-4 max-h-[200px] overflow-y-auto">
                    {taskDetail?.result && <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-lg p-3"><div className="text-emerald-400 text-xs uppercase mb-1">执行结果</div><pre className="text-gray-200 whitespace-pre-wrap break-all text-xs">{taskDetail.result}</pre></div>}
                    {taskDetail?.error && <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 mt-2"><div className="text-red-400 text-xs uppercase mb-1">错误信息</div><pre className="text-red-300 whitespace-pre-wrap break-all text-xs">{taskDetail.error}</pre></div>}
                    {!taskDetail?.result && !taskDetail?.error && <div className="text-center py-4 text-gray-500 text-sm">暂无执行结果</div>}
                  </div>
                )}
              </div>
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
