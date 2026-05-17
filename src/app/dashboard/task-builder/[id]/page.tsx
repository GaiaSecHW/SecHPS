'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Calendar, User, Settings, FileText, Clock, Play, CheckCircle, XCircle, AlertCircle, Loader2, ChevronDown, ChevronRight, Wrench, Activity, Cpu, Timer } from 'lucide-react';
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
  executionResult: string | null;
  reportPath: string | null;
  codeswarmTaskId: string | null;
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

interface CodeswarmStatus {
  state: string;
  sessionId: string | null;
  engine: string | null;
  agent: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
  recentEvents: { type: string; data: string; createdAt: string }[];
}

const statusConfig: Record<string, { bg: string; text: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  pending: { bg: 'bg-dark-surface-hover', text: 'text-gray-300', label: '待执行', icon: Clock },
  running: { bg: 'bg-blue-100', text: 'text-blue-400', label: '执行中', icon: Loader2 },
  completed: { bg: 'bg-green-100', text: 'text-green-400', label: '已完成', icon: CheckCircle },
  failed: { bg: 'bg-red-100', text: 'text-red-400', label: '执行失败', icon: XCircle },
};

const logLevelConfig: Record<string, { bg: string; text: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  info: { bg: 'bg-blue-900/20', text: 'text-blue-400', icon: AlertCircle },
  warning: { bg: 'bg-yellow-900/20', text: 'text-yellow-400', icon: AlertCircle },
  error: { bg: 'bg-red-900/20', text: 'text-red-400', icon: XCircle },
  success: { bg: 'bg-green-900/20', text: 'text-green-400', icon: CheckCircle },
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
  const [executing, setExecuting] = useState(false);
  const [codeswarmStatus, setCodeswarmStatus] = useState<CodeswarmStatus | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTaskDetail = useCallback(async (id: string, showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/task-builder/tasks/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setTask(data.task || null);
        setLogs(data.logs || []);
        setCodeswarmStatus(data.codeswarmStatus || null);
      } else {
        setTask(null);
        setLogs([]);
        setCodeswarmStatus(null);
      }
    } catch {
      setTask(null);
      setLogs([]);
      setCodeswarmStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTaskDetail(taskId);
  }, [taskId, fetchTaskDetail]);

  // 执行时长计时器
  useEffect(() => {
    if (task?.status === 'running' && task.startedAt) {
      const start = new Date(task.startedAt).getTime();
      setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [task?.status, task?.startedAt]);

  // 轮询 CodeswarmTask 状态
  useEffect(() => {
    if (task?.status === 'running') {
      pollingRef.current = setInterval(() => {
        fetchTaskDetail(taskId, false);
      }, 5000);
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [task?.status, taskId, fetchTaskDetail]);

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
        fetchTaskDetail(id, false);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      setIsStreaming(false);
      setEventSourceRef(null);
    };
  };

  const handleExecute = async () => {
    if (executing) return;
    setExecuting(true);
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
    } finally {
      setExecuting(false);
    }
  };

  useEffect(() => {
    return () => {
      if (eventSourceRef) eventSourceRef.close();
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
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
          className="mt-4 px-4 py-2 text-blue-400 hover:text-blue-800"
        >
          返回列表
        </button>
      </div>
    );
  }

  const config = statusConfig[task.status] || statusConfig.pending;
  const StatusIcon = config.icon;

  // 从事件推断当前 Agent 执行阶段
  const getAgentPhase = (): { phase: string; color: string; detail: string } => {
    if (!codeswarmStatus) {
      if (task.status === 'running') return { phase: '等待调度', color: 'text-yellow-400', detail: '任务已提交，等待 Worker 接收' };
      return { phase: '未执行', color: 'text-gray-400', detail: '' };
    }
    const events = codeswarmStatus.recentEvents || [];
    let lastPhaseStart = '';
    let lastPhaseComplete = '';
    let hasSessionCreated = false;
    let hasAgentActivity = false;

    for (const e of events) {
      try {
        const d = JSON.parse(e.data);
        if (e.type === 'phase_start' && d.phase) lastPhaseStart = d.phase;
        if (e.type === 'phase_complete' && d.phase) lastPhaseComplete = d.phase;
        if (e.type === 'session_created') hasSessionCreated = true;
        if (['agent_message_chunk', 'tool_call', 'tool_result', 'agent_response'].includes(e.type)) hasAgentActivity = true;
      } catch {}
    }

    if (codeswarmStatus.state === 'completed') return { phase: '已完成', color: 'text-green-400', detail: 'Agent 执行完毕' };
    if (codeswarmStatus.state === 'failed') return { phase: '失败', color: 'text-red-400', detail: '执行过程中出错' };

    if (lastPhaseComplete === 'executing') return { phase: '已完成', color: 'text-green-400', detail: 'Agent 执行完毕' };
    if (lastPhaseStart === 'executing' || hasAgentActivity) return { phase: 'Agent 执行中', color: 'text-blue-400', detail: `引擎: ${codeswarmStatus.engine || 'opencode'}` };
    if (lastPhaseComplete === 'building' && !lastPhaseStart) return { phase: '环境构建完成', color: 'text-blue-300', detail: '准备启动 Agent' };
    if (lastPhaseStart === 'building') return { phase: '环境构建中', color: 'text-yellow-400', detail: '正在准备 Agent 运行环境' };
    if (lastPhaseStart === 'codedmap') return { phase: 'Codedmap 预处理', color: 'text-purple-400', detail: '知识图谱预处理（后台并行）' };

    if (hasSessionCreated) return { phase: 'Agent 启动中', color: 'text-blue-400', detail: `Session: ${codeswarmStatus.sessionId?.slice(0, 20)}...` };
    if (codeswarmStatus.state === 'dispatched') return { phase: '已分发', color: 'text-yellow-400', detail: 'Worker 已接收，准备执行' };
    if (codeswarmStatus.state === 'queued') return { phase: '排队中', color: 'text-gray-400', detail: '等待 Worker 调度' };

    return { phase: '运行中', color: 'text-blue-400', detail: codeswarmStatus.state };
  };

  const formatElapsed = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const agentPhase = getAgentPhase();

  return (
    <div className="space-y-6">
      <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6">
        <button
          onClick={() => router.push('/dashboard/task-builder')}
          className="flex items-center text-gray-400 hover:text-gray-100 mb-4"
        >
          <ArrowLeft size={20} className="mr-2" />
          返回任务列表
        </button>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-blue-600/10">
              <Settings size={32} className="text-blue-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-100">{task.name}</h1>
              <p className="text-sm text-gray-400 mt-1">Agent: {task.agentName}</p>
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
                 disabled={executing}
                 className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
               >
                 {executing ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                 {executing ? '启动中...' : '执行任务'}
               </button>
             )}
            {task.status === 'running' && (
              <span className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md">
                <Loader2 size={16} className="animate-spin" />
                执行中...
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 mt-6 bg-[#0F172A] rounded-lg p-4">
          <div className="flex items-center gap-2">
            <Calendar size={18} className="text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">创建时间</p>
              <p className="text-sm font-medium text-gray-100">{formatDate(task.createdAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock size={18} className="text-gray-400" />
            <div>
              <p className="text-xs text-gray-500">更新时间</p>
              <p className="text-sm font-medium text-gray-100">{formatDate(task.updatedAt)}</p>
            </div>
          </div>
          {task.startedAt && (
            <div className="flex items-center gap-2">
              <Play size={18} className="text-gray-400" />
              <div>
                <p className="text-xs text-gray-500">开始时间</p>
                <p className="text-sm font-medium text-gray-100">{formatDate(task.startedAt)}</p>
              </div>
            </div>
          )}
          {task.completedAt && (
            <div className="flex items-center gap-2">
              <CheckCircle size={18} className="text-gray-400" />
              <div>
                <p className="text-xs text-gray-500">完成时间</p>
                <p className="text-sm font-medium text-gray-100">{formatDate(task.completedAt)}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Agent 执行状态卡片 */}
      {(task.status === 'running' || codeswarmStatus) && (
        <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Cpu size={18} className="text-blue-400" />
              <h3 className="text-sm font-semibold text-gray-200">Agent 执行状态</h3>
            </div>
            {task.status === 'running' && (
              <div className="flex items-center gap-2">
                <Timer size={14} className="text-blue-400" />
                <span className="text-sm font-mono text-blue-400">{formatElapsed(elapsedSeconds)}</span>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-[#0F172A] rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">当前阶段</p>
              <div className="flex items-center gap-2">
                {task.status === 'running' && <span className={`inline-block w-2 h-2 rounded-full ${agentPhase.color === 'text-blue-400' ? 'bg-blue-400 animate-pulse' : agentPhase.color === 'text-green-400' ? 'bg-green-400' : agentPhase.color === 'text-red-400' ? 'bg-red-400' : 'bg-yellow-400'}`} />}
                <span className={`text-sm font-medium ${agentPhase.color}`}>{agentPhase.phase}</span>
              </div>
            </div>
            {codeswarmStatus?.engine && (
              <div className="bg-[#0F172A] rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">引擎</p>
                <p className="text-sm font-medium text-gray-200">{codeswarmStatus.engine}</p>
              </div>
            )}
            {codeswarmStatus?.agent && (
              <div className="bg-[#0F172A] rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Agent</p>
                <p className="text-sm font-medium text-gray-200">{codeswarmStatus.agent}</p>
              </div>
            )}
            {codeswarmStatus?.sessionId && (
              <div className="bg-[#0F172A] rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">Session</p>
                <p className="text-sm font-mono text-gray-300 truncate" title={codeswarmStatus.sessionId}>{codeswarmStatus.sessionId}</p>
              </div>
            )}
          </div>
          {agentPhase.detail && (
            <p className="text-xs text-gray-500 mt-2">{agentPhase.detail}</p>
          )}
        </div>
      )}

      {task.filePath && (
        <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={20} className="text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-100">上传文件</h2>
          </div>
          <p className="text-sm text-gray-300">{task.filePath}</p>
        </div>
      )}

      {task.notes && (
        <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={20} className="text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-100">备注说明</h2>
          </div>
          <p className="text-sm text-gray-300 whitespace-pre-wrap">{task.notes}</p>
        </div>
      )}

      {task.errorMessage && (
        <div className="bg-red-600/10 rounded-lg border border-red-500/20 p-6">
          <div className="flex items-center gap-2 mb-4">
            <XCircle size={20} className="text-red-400" />
            <h2 className="text-lg font-semibold text-red-400">错误信息</h2>
          </div>
          <pre className="text-sm text-red-400 whitespace-pre-wrap overflow-x-auto">{task.errorMessage}</pre>
        </div>
      )}

      {task.executionResult && (
        <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle size={20} className="text-green-400" />
            <h2 className="text-lg font-semibold text-gray-100">执行结果</h2>
          </div>
          <pre className="bg-gray-900 text-green-400 p-4 rounded-lg text-sm overflow-x-auto max-h-96 whitespace-pre-wrap">
            {task.executionResult.length > 5000 
              ? task.executionResult.slice(0, 5000) + '\n...(内容过长，已截断)'
              : task.executionResult}
          </pre>
        </div>
      )}

      {task.reportPath && (
        <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={20} className="text-yellow-400" />
            <h2 className="text-lg font-semibold text-gray-100">安全报告</h2>
          </div>
          <pre className="bg-gray-900 text-yellow-400 p-4 rounded-lg text-sm overflow-x-auto max-h-96">
            {task.reportPath.length > 3000 
              ? task.reportPath.slice(0, 3000) + '\n...(内容过长，已截断)'
              : task.reportPath}
          </pre>
        </div>
      )}

      {task.skills && (
        <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Settings size={20} className="text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-100">注入的 Skills</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {task.skills.split(',').map((skillId) => (
              <span key={skillId} className="px-3 py-1 bg-blue-500/15 text-blue-400 rounded-md text-sm">
                {skillId}
              </span>
            ))}
          </div>
        </div>
      )}

      {task.scripts && (
        <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={20} className="text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-100">注入的脚本</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {task.scripts.split(',').map((script) => (
              <span key={script} className="px-3 py-1 bg-purple-500/15 text-purple-400 rounded-md text-sm">
                {script}
              </span>
            ))}
          </div>
        </div>
      )}

      {task.mergedSkills && (
        <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Settings size={20} className="text-blue-400" />
            <h2 className="text-lg font-semibold text-gray-100">合并后的 Skills</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {(() => {
              try {
                const skills = JSON.parse(task.mergedSkills);
                return skills.map((skillId: string) => (
                  <span key={skillId} className="px-3 py-1 bg-blue-500/15 text-blue-400 rounded-md text-sm">
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
        <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={20} className="text-purple-600" />
            <h2 className="text-lg font-semibold text-gray-100">合并后的 Scripts</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {(() => {
              try {
                const scripts = JSON.parse(task.mergedScripts);
                return scripts.map((script: string) => (
                  <span key={script} className="px-3 py-1 bg-purple-500/15 text-purple-400 rounded-md text-sm">
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

      <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FileText size={20} className="text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-100">执行日志</h2>
            <span className="text-sm text-gray-500">({logs.length} 条记录)</span>
          </div>
          {isStreaming && (
            <span className="flex items-center gap-2 text-sm text-blue-400 animate-pulse">
              <Loader2 size={14} className="animate-spin" />
              实时更新中...
            </span>
          )}
        </div>
        
        {logs.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">暂无执行日志</p>
        ) : (
          <LogsGroupedDisplay logs={logs} formatDate={formatDate} />
        )}
      </div>
    </div>
  );
}

function LogsGroupedDisplay({ logs, formatDate }: { logs: TaskExecutionLog[], formatDate: (date: string) => string }) {
  const [agentOutputExpanded, setAgentOutputExpanded] = useState(true);
  const [toolCallsExpanded, setToolCallsExpanded] = useState(true);
  const [errorsExpanded, setErrorsExpanded] = useState(true);
  const [statusExpanded, setStatusExpanded] = useState(true);

  const groupedLogs = useMemo(() => {
    const agentOutputLogs = logs.filter(l => l.message === 'Agent 输出');
    const toolCallLogs = logs.filter(l => l.message === '工具调用');
    const errorLogs = logs.filter(l => l.level === 'error');
    const statusLogs = logs.filter(l => 
      !['Agent 输出', '工具调用'].includes(l.message) && l.level !== 'error'
    );
    
    const agentOutputText = agentOutputLogs.map(l => l.details || '').join('');
    
    return {
      agentOutput: { logs: agentOutputLogs, text: agentOutputText },
      toolCalls: { logs: toolCallLogs },
      errors: { logs: errorLogs },
      status: { logs: statusLogs },
    };
  }, [logs]);

  return (
    <div className="space-y-4">
      {/* Agent 输出流 */}
      {groupedLogs.agentOutput.logs.length > 0 && (
        <div className="bg-gray-900/50 rounded-lg border border-gray-700/50">
          <button
            onClick={() => setAgentOutputExpanded(!agentOutputExpanded)}
            className="w-full flex items-center justify-between p-3 hover:bg-gray-800/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-green-400" />
              <span className="text-sm font-medium text-green-400">Agent 输出流</span>
              <span className="text-xs text-gray-500">({groupedLogs.agentOutput.logs.length} 条)</span>
            </div>
            {agentOutputExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          </button>
          
          {agentOutputExpanded && (
            <div className="px-3 pb-3">
              <pre className="bg-gray-900 text-green-400 p-4 rounded-lg text-sm overflow-x-auto max-h-96 whitespace-pre-wrap font-mono leading-relaxed">
                {groupedLogs.agentOutput.text.length > 10000 
                  ? groupedLogs.agentOutput.text.slice(0, 10000) + '\n...(内容过长，已截断)'
                  : groupedLogs.agentOutput.text}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* 工具调用列表 */}
      {groupedLogs.toolCalls.logs.length > 0 && (
        <div className="bg-blue-900/20 rounded-lg border border-blue-500/30">
          <button
            onClick={() => setToolCallsExpanded(!toolCallsExpanded)}
            className="w-full flex items-center justify-between p-3 hover:bg-blue-800/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Wrench size={16} className="text-blue-400" />
              <span className="text-sm font-medium text-blue-400">工具调用记录</span>
              <span className="text-xs text-gray-500">({groupedLogs.toolCalls.logs.length} 次)</span>
            </div>
            {toolCallsExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          </button>
          
          {toolCallsExpanded && (
            <div className="px-3 pb-3">
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {groupedLogs.toolCalls.logs.map((log, idx) => (
                  <div key={log.id} className="flex items-center gap-2 text-sm">
                    <span className="text-gray-500 font-mono">{idx + 1}.</span>
                    <span className="text-blue-300">{log.details}</span>
                    <span className="text-xs text-gray-600 ml-auto">{formatDate(log.timestamp)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 错误信息 */}
      {groupedLogs.errors.logs.length > 0 && (
        <div className="bg-red-900/20 rounded-lg border border-red-500/30">
          <button
            onClick={() => setErrorsExpanded(!errorsExpanded)}
            className="w-full flex items-center justify-between p-3 hover:bg-red-800/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <XCircle size={16} className="text-red-400" />
              <span className="text-sm font-medium text-red-400">错误信息</span>
              <span className="text-xs text-gray-500">({groupedLogs.errors.logs.length} 条)</span>
            </div>
            {errorsExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          </button>
          
          {errorsExpanded && (
            <div className="px-3 pb-3">
              <div className="space-y-2">
                {groupedLogs.errors.logs.map((log) => (
                  <div key={log.id} className="bg-red-900/30 p-3 rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-red-400">{log.message}</span>
                      <span className="text-xs text-gray-600">{formatDate(log.timestamp)}</span>
                    </div>
                    {log.details && (
                      <pre className="text-xs text-red-300 whitespace-pre-wrap overflow-x-auto mt-1">
                        {log.details}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 执行状态时间线 */}
      {groupedLogs.status.logs.length > 0 && (
        <div className="bg-dark-surface rounded-lg border border-gray-700/50">
          <button
            onClick={() => setStatusExpanded(!statusExpanded)}
            className="w-full flex items-center justify-between p-3 hover:bg-gray-800/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-gray-400" />
              <span className="text-sm font-medium text-gray-300">执行状态时间线</span>
              <span className="text-xs text-gray-500">({groupedLogs.status.logs.length} 步)</span>
            </div>
            {statusExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          </button>
          
          {statusExpanded && (
            <div className="px-3 pb-3">
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {groupedLogs.status.logs.map((log) => {
                  const logConfig = logLevelConfig[log.level] || logLevelConfig.info;
                  const LogIcon = logConfig.icon;
                  
                  return (
                    <div key={log.id} className="flex items-start gap-2">
                      <LogIcon size={14} className={`${logConfig.text} mt-0.5`} />
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className={`text-sm ${logConfig.text}`}>{log.message}</span>
                          <span className="text-xs text-gray-500">{formatDate(log.timestamp)}</span>
                        </div>
                        {log.details && (
                          <p className="text-xs text-gray-400 mt-0.5">{log.details}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}