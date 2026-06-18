import { useState, useEffect, useRef } from 'react';
import { useApiFetch } from '@/lib/use-api-fetch';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorAlert } from '@/components/ErrorAlert';
import { RefreshCw, ChevronDown, ChevronRight, Clock, CheckCircle, XCircle, Loader2, Filter, Trash2, Copy, Check, Server, ArrowUp, ArrowDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { getEngineBadge, getEngineLabel } from './engine-display.js';

interface Task {
  id: string;
  taskId: string;
  taskName: string | null;
  state: string;
  instruction: string;
  projectPath: string | null;
  workspacePath: string | null;
  gitUrl: string | null;
  gitRef: string | null;
  agent: string | null;
  skills: any;
  scripts: any;
  mcps: any;
  model: string | null;
  apiKey: string | null;
  apiBaseUrl: string | null;
  timeoutSec: number | null;
  preferredWorkerNodeId: string | null;
  targetProduct: string | null;
  maxTokens: number | null;
  contextWindow: number | null;
  env: any;
  platformTaskId: string | null;
  platformCallbackUrl: string | null;
  toolId: string | null;
  toolTaskId: string | null;
  toolPath: string | null;
  toolWorkDir: string | null;
  engine: string | null;
  result: string | null;
  reportContent: string | null;
  error: string | null;
  events: any[] | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  rawSubmitPayload?: any;
  worker?: { nodeId: string; address: string };
}

interface TasksResponse {
  tasks: Task[];
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast.success('已复制');
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => toast.error('复制失败'));
  };
  return (
    <button onClick={handleCopy} className="flex items-center space-x-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 bg-gray-700 hover:bg-gray-600 rounded transition-colors">
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
      <span>{copied ? '已复制' : '复制'}</span>
    </button>
  );
}

function parseJsonField(value: any) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatJsonForDisplay(value: any) {
  const parsed = parseJsonField(value);
  if (parsed === null || parsed === undefined || parsed === '') return null;
  return parsed;
}

function buildInputParams(task: Task) {
  const params = {
    instruction: task.instruction,
    engine: task.engine,
    agent: task.agent,
    model: task.model,
    apiBaseUrl: task.apiBaseUrl,
    apiKey: task.apiKey ? '***' : task.apiKey,
    timeoutSec: task.timeoutSec,
    maxTokens: task.maxTokens,
    contextWindow: task.contextWindow,
    projectPath: task.projectPath,
    workspacePath: task.workspacePath,
    gitUrl: task.gitUrl,
    gitRef: task.gitRef,
    skills: parseJsonField(task.skills),
    scripts: parseJsonField(task.scripts),
    mcps: parseJsonField(task.mcps),
    env: parseJsonField(task.env),
    preferredWorkerNodeId: task.preferredWorkerNodeId,
    targetProduct: task.targetProduct,
    platformTaskId: task.platformTaskId,
    platformCallbackUrl: task.platformCallbackUrl,
    toolId: task.toolId,
    toolTaskId: task.toolTaskId,
    toolPath: task.toolPath,
    toolWorkDir: task.toolWorkDir,
  };

  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== null && value !== undefined && value !== ''),
  );
}

interface TaskResultViewerProps {
  selectedTaskId: string | null;
  onTaskSelect: (taskId: string | null) => void;
  onRefresh: () => void;
}

const STATE_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'queued', label: '排队中' },
  { key: 'dispatched', label: '已分发' },
  { key: 'running', label: '执行中' },
  { key: 'completed', label: '已完成' },
  { key: 'failed', label: '失败' },
] as const;

export function TaskResultViewer({ selectedTaskId, onTaskSelect, onRefresh }: TaskResultViewerProps) {
  const { data, loading, error, refetch } = useApiFetch<TasksResponse>('/api/codeswarm/task/list');
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [eventFilter, setEventFilter] = useState<string>('all');
  const [deletingTask, setDeletingTask] = useState<string | null>(null);
  const [taskEvents, setTaskEvents] = useState<Record<string, any[]>>({});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (selectedTaskId) setExpandedTask(selectedTaskId);
  }, [selectedTaskId]);

  useEffect(() => {
    if (!expandedTask) return;
    if (taskEvents[expandedTask]) return;
    const taskFromList = data?.tasks?.find(t => t.taskId === expandedTask);
    if (taskFromList?.events && Array.isArray(taskFromList.events) && taskFromList.events.length > 0) {
      setTaskEvents(prev => ({ ...prev, [expandedTask]: taskFromList.events as any[] }));
      return;
    }
    fetch(`/api/codeswarm/task/${expandedTask}`)
      .then(res => res.json())
      .then(apiData => { if (apiData.events) setTaskEvents(prev => ({ ...prev, [expandedTask]: apiData.events })); })
      .catch(console.error);
  }, [expandedTask, data, taskEvents]);

  const tasks = data?.tasks || [];
  const hasActiveTasks = tasks.some(t => ['queued', 'dispatched', 'building', 'running'].includes(t.state));

  useEffect(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (hasActiveTasks) {
      intervalRef.current = setInterval(() => refetch(), 30000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [hasActiveTasks, refetch]);

  const filteredTasks = stateFilter === 'all' ? tasks : tasks.filter(t => t.state === stateFilter);

  const handleDeleteTask = async (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    if (!confirm('确定要删除这个任务吗？')) return;
    setDeletingTask(taskId);
    try {
      const resp = await fetch(`/api/codeswarm/task/${taskId}`, { method: 'DELETE' });
      if (resp.ok) { toast.success('任务已删除'); refetch(); onRefresh(); }
      else toast.error('删除失败');
    } catch { toast.error('删除失败'); }
    finally { setDeletingTask(null); }
  };

  const getStateIcon = (state: string) => {
    switch (state) {
      case 'completed': return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'failed': return <XCircle className="w-4 h-4 text-red-600" />;
      case 'queued': case 'dispatched': case 'building': case 'running': return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
      default: return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStateLabel = (state: string) => {
    const labels: Record<string, string> = { queued: '排队中', dispatched: '已分发', building: '构建中', running: '执行中', completed: '已完成', failed: '失败', cancelled: '已取消' };
    return labels[state] || state;
  };

  const formatTime = (date: string | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleString('zh-CN');
  };

  const formatDuration = (start: string | null, end: string | null) => {
    if (!start) return '-';
    const endTime = end ? new Date(end).getTime() : Date.now();
    const diff = endTime - new Date(start).getTime();
    if (diff < 0) return '0s';
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

  if (loading && !data) return <div className="flex items-center justify-center h-48"><LoadingSpinner size="lg" /></div>;
  if (error) return <ErrorAlert>{error}</ErrorAlert>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">任务列表</h2>
        <div className="flex items-center space-x-2">
          {hasActiveTasks && (
            <span className="flex items-center space-x-1 text-xs text-blue-600">
              <Loader2 className="w-3 h-3 animate-spin" /><span>自动刷新中</span>
            </span>
          )}
          <button onClick={() => { refetch(); onRefresh(); }} className="flex items-center space-x-2 px-3 py-2 bg-dark-surface-hover hover:bg-gray-700 rounded-lg transition-colors">
            <RefreshCw className="w-4 h-4" /><span>刷新</span>
          </button>
        </div>
      </div>

      {/* State Filters */}
      <div className="flex items-center space-x-1">
        <Filter className="w-4 h-4 text-gray-400" />
        {STATE_FILTERS.map(f => {
          const count = f.key === 'all' ? tasks.length : tasks.filter(t => t.state === f.key).length;
          return (
            <button key={f.key} onClick={() => setStateFilter(f.key)} className={`px-3 py-1 text-xs rounded-full transition-colors ${stateFilter === f.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-dark-surface-hover'}`}>
              {f.label} ({count})
            </button>
          );
        })}
      </div>

      {filteredTasks.length === 0 ? (
        <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50 p-12">
          <div className="text-center">
            <Clock className="mx-auto h-16 w-16 text-gray-400" />
            <h3 className="mt-4 text-lg font-medium text-gray-100">{stateFilter === 'all' ? '暂无任务' : `暂无${STATE_FILTERS.find(f => f.key === stateFilter)?.label}任务`}</h3>
            <p className="mt-2 text-sm text-gray-400">在「任务调试」页面创建任务</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTasks.map((task) => {
            const isExpanded = expandedTask === task.taskId;
            const isSelected = selectedTaskId === task.taskId;
            const engineBadge = getEngineBadge(task.engine);
            return (
              <div key={task.id} className={`bg-dark-surface rounded-lg shadow border ${isSelected ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-700/50'} overflow-hidden`}>
                <div className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-dark-surface-hover" onClick={() => { setExpandedTask(isExpanded ? null : task.taskId); onTaskSelect(isExpanded ? null : task.taskId); }}>
                  <div className="flex items-center space-x-3 flex-1 min-w-0">
                    <button onClick={(e) => { e.stopPropagation(); setExpandedTask(isExpanded ? null : task.taskId); }} className="p-1">
                      {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    </button>
                    {getStateIcon(task.state)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium text-gray-100 truncate">{task.taskName || task.taskId}</span>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${task.state === 'completed' ? 'bg-green-500/15 text-green-400' : task.state === 'failed' ? 'bg-red-500/15 text-red-400' : 'bg-blue-900/30 text-blue-400'}`}>
                          {getStateLabel(task.state)}
                        </span>
                        {task.engine && (
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${engineBadge.color}`}>
                            {engineBadge.label}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-0.5">{task.instruction ? `${task.instruction.slice(0, 80)}${task.instruction.length > 80 ? '...' : ''}` : '无指令'}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4 text-xs text-gray-500">
                    {task.worker && (
                      <span className="flex items-center space-x-1 text-blue-600 bg-blue-900/20 px-2 py-0.5 rounded">
                        <Server className="w-3 h-3" /><span>{task.worker.nodeId}</span>
                      </span>
                    )}
                    <span>{formatTime(task.createdAt)}</span>
                    <span className="text-gray-400">{formatDuration(task.startedAt, task.completedAt)}</span>
                    <button onClick={(e) => handleDeleteTask(e, task.taskId)} disabled={deletingTask === task.taskId} className="p-1 text-gray-300 hover:text-red-500 transition-colors disabled:opacity-50">
                      {deletingTask === task.taskId ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-4 py-4 border-t border-gray-700/50 bg-dark-bg space-y-4">
                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <div><span className="text-gray-500">Task ID:</span><span className="ml-2 font-mono text-xs">{task.taskId}</span></div>
                      <div><span className="text-gray-500">Engine:</span><span className="ml-2">{getEngineLabel(task.engine)}</span></div>
                      <div><span className="text-gray-500">Agent:</span><span className="ml-2">{task.agent || '-'}</span></div>
                      <div><span className="text-gray-500">Model:</span><span className="ml-2">{task.model || '-'}</span></div>
                    </div>
                    {task.projectPath && <div className="text-sm"><span className="text-gray-500">Project:</span><code className="ml-2 text-xs bg-gray-700 px-2 py-0.5 rounded">{task.projectPath}</code></div>}
                    {task.workspacePath && <div className="text-sm"><span className="text-gray-500">Workspace:</span><code className="ml-2 text-xs bg-gray-700 px-2 py-0.5 rounded">{task.workspacePath}</code></div>}

                    {/* Input Params */}
                    {(() => {
                      const params = buildInputParams(task);
                      const rawParams = formatJsonForDisplay(task.rawSubmitPayload);
                      const hasParams = Object.keys(params).length > 0;
                      const hasRawParams = rawParams !== null;
                      if (!hasParams && !hasRawParams) return null;
                      const rawParamsText = hasRawParams ? JSON.stringify(rawParams, null, 2) : '';
                      return (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          <div>
                            <div className="flex items-center justify-between mb-2"><h4 className="text-sm font-medium text-gray-300">输入参数</h4>{hasParams && <CopyButton text={JSON.stringify(params, null, 2)} />}</div>
                            {hasParams ? (
                              <div className="bg-gray-900 rounded-lg p-3 max-h-[70vh] overflow-auto"><pre className="text-xs text-cyan-400 font-mono whitespace-pre-wrap break-words">{JSON.stringify(params, null, 2)}</pre></div>
                            ) : (
                              <div className="bg-gray-900 rounded-lg p-3"><p className="text-xs text-gray-500">无输入参数记录</p></div>
                            )}
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-2"><h4 className="text-sm font-medium text-gray-300">原始输入参数</h4>{hasRawParams && <CopyButton text={rawParamsText} />}</div>
                            {hasRawParams ? (
                              <div className="bg-gray-900 rounded-lg p-3 max-h-[70vh] overflow-auto"><pre className="text-xs text-yellow-400 font-mono whitespace-pre-wrap break-words">{rawParamsText}</pre></div>
                            ) : (
                              <div className="bg-gray-900 rounded-lg p-3"><p className="text-xs text-gray-500">无原始输入参数记录</p></div>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Events */}
                    {(() => {
                      const rawEvents = taskEvents[task.taskId] || task.events;
                      if (!rawEvents || rawEvents.length === 0) return null;
                      const CHUNK_TYPES = new Set(['agent_message_chunk', 'log_chunk', 'agent_log_chunk']);
                      const events: any[] = [];
                      for (const ev of rawEvents) {
                        if (CHUNK_TYPES.has(ev.type)) {
                          const prev = events[events.length - 1];
                          if (prev?._merged && CHUNK_TYPES.has(prev.type)) prev.content = (prev.content || '') + (ev.content || '');
                          else events.push({ ...ev, _merged: true });
                        } else events.push(ev);
                      }
                      const cleanText = (t: string, max = 150): string => {
                        if (!t) return '';
                        try { t = JSON.parse(`"${t}"`); } catch {}
                        t = t.replace(/\\n/g, ' ').replace(/\\t/g, ' ').replace(/\\"/g, '"').replace(/  +/g, ' ').trim();
                        return t.length > max ? t.slice(0, max) + '...' : t;
                      };
                      const getEventDisplay = (event: any) => {
                        const t = event.type;
                        if (t === 'skill_start') return { badge: 'Skill', detail: event.skill || '', color: 'bg-purple-900/50 text-purple-400', category: 'skill' };
                        if (t === 'skill_complete') return { badge: 'Skill Done', detail: event.skill || '', color: 'bg-purple-900/40 text-purple-300', category: 'skill' };
                        if (t === 'tool_call') return { badge: 'Tool', detail: event.tool || '', color: 'bg-yellow-900/50 text-yellow-400', category: 'tool' };
                        if (t === 'tool_call_update') return { badge: 'Result', detail: cleanText(event.output || '', 100), color: 'bg-blue-900/50 text-blue-300', category: 'tool' };
                        if (t === 'error') return { badge: 'Error', detail: event.message || '', color: 'bg-red-900/50 text-red-400', category: 'error' };
                        if (t === 'phase_start' || t === 'phase_complete') return { badge: 'Phase', detail: event.phase || event.message || '', color: 'bg-cyan-900/50 text-cyan-400', category: 'phase' };
                        if (CHUNK_TYPES.has(t)) return { badge: 'Log', detail: cleanText(event.content || '', 120), color: 'bg-gray-700 text-gray-400', category: 'log' };
                        return { badge: t, detail: event.content || event.message || '', color: 'bg-gray-700 text-gray-300', category: 'other' };
                      };
                      const filteredEvents = eventFilter === 'all' ? events : events.filter(ev => getEventDisplay(ev).category === eventFilter);
                      return (
                        <div>
                          <h4 className="text-sm font-medium text-gray-400 mb-2">执行日志 ({filteredEvents.length}/{events.length} 条)</h4>
                          <div className="bg-gray-900 rounded-lg p-3 max-h-[500px] overflow-y-auto">
                            {filteredEvents.length === 0 ? <p className="text-xs text-gray-500 text-center py-2">该类型暂无事件</p> : (
                              <div className="space-y-0.5 font-mono text-xs">
                                {filteredEvents.map((event, i) => {
                                  const { badge, detail, color } = getEventDisplay(event);
                                  return (
                                    <div key={i} className="flex items-start space-x-1.5">
                                      <span className="text-gray-600 shrink-0">{new Date(event.timestamp || event._createdAt).toLocaleTimeString()}</span>
                                      <span className={`px-1 rounded text-[10px] shrink-0 ${color}`}>{badge}</span>
                                      {detail && <span className="text-gray-400 truncate">{detail}</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {task.result && <div><h4 className="text-sm font-medium text-gray-700 mb-2">执行结果</h4><pre className="bg-gray-900 text-green-400 p-3 rounded-lg text-xs overflow-x-auto max-h-48 whitespace-pre-wrap">{task.result}</pre></div>}
                    {task.error && <div><h4 className="text-sm font-medium text-red-400 mb-2">错误信息</h4><pre className="bg-red-50 text-red-400 p-3 rounded-lg text-xs overflow-x-auto">{task.error}</pre></div>}
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
