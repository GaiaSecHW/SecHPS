'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, User, Settings, FileText, Clock, Play, CheckCircle, XCircle, AlertCircle, Loader2, ChevronDown, ChevronRight, Wrench, Activity, Cpu, Timer, ShieldAlert, ExternalLink, Download, Shield, Eye, X, Bug, Ban } from 'lucide-react';
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
  workerNodeId: string | null;
  workerStatus: string | null;
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
  const [vulnStats, setVulnStats] = useState<{ total: number; bySeverity: Record<string, number>; byStatus: Record<string, number> } | null>(null);
  const [reportFiles, setReportFiles] = useState<{ hasReport: boolean; files: { url: string; name: string }[] } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [vulnList, setVulnList] = useState<any[]>([]);
  const [vulnLoading, setVulnLoading] = useState<Record<string, boolean>>({});
  const [expandedVulnId, setExpandedVulnId] = useState<string | null>(null);

  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const sortedVulnList = useMemo(() => [...vulnList].sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9)), [vulnList]);
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

  useEffect(() => {
    const fetchVulnStats = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/vulnerabilities/stats?taskId=${taskId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setVulnStats(data.stats || null);
        }
      } catch {}
    };
    fetchVulnStats();
  }, [taskId]);

  useEffect(() => {
    const fetchVulnList = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/vulnerabilities?taskId=${taskId}&limit=200`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setVulnList(data.data || []);
        }
      } catch {}
    };
    fetchVulnList();
  }, [taskId]);

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

  // 轮询 CodeswarmTask 状态（running 时持续轮询，completed 后继续 60 秒以捕获 VulnParse 日志）
  useEffect(() => {
    const completedAtMs = task?.completedAt ? new Date(task.completedAt).getTime() : 0;

    if (task?.status === 'running') {
      pollingRef.current = setInterval(() => {
        fetchTaskDetail(taskId, false);
      }, 5000);
    } else if ((task?.status === 'completed' || task?.status === 'failed') && completedAtMs > 0) {
      const elapsed = Date.now() - completedAtMs;
      if (elapsed < 60000) {
        pollingRef.current = setInterval(() => {
          fetchTaskDetail(taskId, false);
        }, 5000);
        const remaining = 60000 - elapsed;
        const timeout = setTimeout(() => {
          if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
        }, remaining);
        return () => {
          if (pollingRef.current) clearInterval(pollingRef.current);
          clearTimeout(timeout);
        };
      }
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [task?.status, task?.completedAt, taskId, fetchTaskDetail]);

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

  const fetchReportFiles = useCallback(async () => {
    if (task?.status !== 'completed') return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/task-builder/tasks/${taskId}/report-files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setReportFiles(data);
      }
    } catch {}
  }, [task?.status, taskId]);

  const downloadFile = async (url: string, fileName: string) => {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(blobUrl);
  };

  const handleDownloadAllReports = async () => {
    if (!reportFiles?.files?.length || downloading) return;
    setDownloading(true);
    
    try {
      for (const file of reportFiles.files) {
        await downloadFile(file.url, file.name);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      toast.success('报告下载完成');
    } catch (error) {
      toast.error('下载失败');
    } finally {
      setDownloading(false);
    }
  };

  const handleVulnAction = async (vulnId: string, action: string) => {
    setVulnLoading(prev => ({ ...prev, [vulnId]: true }));
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/vulnerabilities/${vulnId}/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        toast.success('操作成功');
        setVulnList(prev => prev.map(v => v.id === vulnId ? { ...v, status: action === 'false-positive' ? 'false-positive' : action } : v));
      } else {
        toast.error('操作失败');
      }
    } catch {
      toast.error('网络错误');
    } finally {
      setVulnLoading(prev => ({ ...prev, [vulnId]: false }));
    }
  };

  useEffect(() => {
    fetchReportFiles();
  }, [fetchReportFiles]);

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
  const getParallelPhases = (): { agentPhase: string; agentColor: string; agentDetail: string; codedmapPhase: string; codedmapColor: string; codedmapDetail: string } => {
    const defaults = { agentPhase: '未执行', agentColor: 'text-gray-400', agentDetail: '', codedmapPhase: '跳过', codedmapColor: 'text-gray-500', codedmapDetail: '' };
    if (!codeswarmStatus) {
      if (task.status === 'running') return { ...defaults, agentPhase: '等待调度', agentColor: 'text-yellow-400', agentDetail: '任务已提交，等待 Worker 接收' };
      return defaults;
    }
    const events = codeswarmStatus.recentEvents || [];
    let agentPhaseStart = '';
    let agentPhaseComplete = '';
    let codedmapPhaseStart = '';
    let codedmapPhaseComplete = '';
    let codedmapSuccess = true;
    let hasSessionCreated = false;
    let hasAgentActivity = false;

    for (const e of events) {
      try {
        const d = JSON.parse(e.data);
        if (e.type === 'phase_start' && d.phase) {
          if (d.phase === 'codedmap') codedmapPhaseStart = 'codedmap';
          else if (d.phase === 'executing') agentPhaseStart = 'executing';
          else if (d.phase === 'building') agentPhaseStart = 'building';
        }
        if (e.type === 'phase_complete' && d.phase) {
          if (d.phase === 'codedmap') { codedmapPhaseComplete = 'codedmap'; codedmapSuccess = d.success !== false; }
          else if (d.phase === 'executing') agentPhaseComplete = 'executing';
          else if (d.phase === 'building') agentPhaseComplete = 'building';
        }
        if (e.type === 'session_created') hasSessionCreated = true;
        if (['agent_message_chunk', 'tool_call', 'tool_result', 'agent_response'].includes(e.type)) hasAgentActivity = true;
      } catch {}
    }

    const state = codeswarmStatus.state;

    let agentPhase: string, agentColor: string, agentDetail: string;
    if (state === 'completed') { agentPhase = '已完成'; agentColor = 'text-green-400'; agentDetail = 'Agent 执行完毕'; }
    else if (state === 'failed') { agentPhase = '失败'; agentColor = 'text-red-400'; agentDetail = '执行过程中出错'; }
    else if (agentPhaseComplete === 'executing') { agentPhase = '已完成'; agentColor = 'text-green-400'; agentDetail = 'Agent 执行完毕'; }
    else if (agentPhaseStart === 'executing' || hasAgentActivity) { agentPhase = 'Agent 执行中'; agentColor = 'text-blue-400'; agentDetail = `引擎: ${codeswarmStatus.engine || 'opencode'}`; }
    else if (agentPhaseComplete === 'building') { agentPhase = '环境构建完成'; agentColor = 'text-blue-300'; agentDetail = '准备启动 Agent'; }
    else if (agentPhaseStart === 'building') { agentPhase = '环境构建中'; agentColor = 'text-yellow-400'; agentDetail = '正在准备 Agent 运行环境'; }
    else if (hasSessionCreated) { agentPhase = 'Agent 启动中'; agentColor = 'text-blue-400'; agentDetail = `Session: ${codeswarmStatus.sessionId?.slice(0, 20)}...`; }
    else if (state === 'dispatched') { agentPhase = '已分发'; agentColor = 'text-yellow-400'; agentDetail = 'Worker 已接收，准备执行'; }
    else if (state === 'queued') { agentPhase = '排队中'; agentColor = 'text-gray-400'; agentDetail = '等待 Worker 调度'; }
    else { agentPhase = '运行中'; agentColor = 'text-blue-400'; agentDetail = state; }

    let codedmapPhase: string, codedmapColor: string, codedmapDetail: string;
    if (!codedmapPhaseStart) { codedmapPhase = '跳过'; codedmapColor = 'text-gray-500'; codedmapDetail = ''; }
    else if (codedmapPhaseComplete) { codedmapPhase = codedmapSuccess ? '已就绪' : '构建失败'; codedmapColor = codedmapSuccess ? 'text-green-400' : 'text-red-400'; codedmapDetail = codedmapSuccess ? '知识图谱可供 Agent 使用' : '不影响 Agent 执行'; }
    else { codedmapPhase = '构建中'; codedmapColor = 'text-purple-400 animate-pulse'; codedmapDetail = '后台并行处理'; }

    return { agentPhase, agentColor, agentDetail, codedmapPhase, codedmapColor, codedmapDetail };
  };

  const formatElapsed = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const parallelPhases = getParallelPhases();

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
            {task.status === 'completed' && reportFiles?.hasReport && (
              <button
                onClick={handleDownloadAllReports}
                disabled={downloading}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                {downloading ? '下载中...' : `下载报告 (${reportFiles.files.length})`}
              </button>
            )}
           </div>
        </div>
      </div>

      {/* 执行状态 */}
      {(task.startedAt || task.status === 'running' || codeswarmStatus) && (
        <div className="bg-dark-surface rounded-lg border border-gray-700/50 px-4 py-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-center text-xs">
            <div className="flex items-center gap-2">
              <Cpu size={14} className="text-blue-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-gray-500">Agent</p>
                <p className={`font-medium truncate ${parallelPhases.agentColor}`}>{parallelPhases.agentPhase}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Activity size={14} className="text-purple-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-gray-500">知识图谱</p>
                <p className={`font-medium truncate ${parallelPhases.codedmapColor}`}>{parallelPhases.codedmapPhase}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-gray-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-gray-500">时间</p>
                <p className="text-gray-300 truncate">
                  {task.startedAt ? formatDate(task.startedAt) : '-'}
                  {task.completedAt
                    ? ` → ${formatDate(task.completedAt)}`
                    : task.status === 'running' && <span className="text-blue-400 font-mono ml-1">{formatElapsed(elapsedSeconds)}</span>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Wrench size={14} className="text-gray-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-gray-500">引擎</p>
                <p className="text-gray-300 truncate">
                  {codeswarmStatus?.engine || '-'}
                  {codeswarmStatus?.model && <span className="text-gray-500 ml-1">· {codeswarmStatus.model}</span>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Cpu size={14} className="text-gray-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-gray-500">Worker</p>
                <p className="text-gray-300 truncate">
                  {codeswarmStatus?.workerNodeId
                    ? <span>{codeswarmStatus.workerNodeId} <span className={`ml-1 text-xs ${codeswarmStatus.workerStatus === 'online' ? 'text-green-400' : 'text-gray-500'}`}>{codeswarmStatus.workerStatus === 'online' ? '在线' : codeswarmStatus.workerStatus}</span></span>
                    : '-'}
                </p>
              </div>
            </div>
          </div>
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


      {task.errorMessage && (
        <div className="bg-red-600/10 rounded-lg border border-red-500/20 p-6">
          <div className="flex items-center gap-2 mb-4">
            <XCircle size={20} className="text-red-400" />
            <h2 className="text-lg font-semibold text-red-400">错误信息</h2>
          </div>
          <pre className="text-sm text-red-400 whitespace-pre-wrap overflow-x-auto">{task.errorMessage}</pre>
        </div>
      )}

      {sortedVulnList.length > 0 && (
        <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ShieldAlert size={20} className="text-red-400" />
              <h2 className="text-lg font-semibold text-gray-100">漏洞列表</h2>
              <span className="text-sm text-gray-500">({sortedVulnList.length} 条)</span>
            </div>
          </div>
          <div className="space-y-2">
            {sortedVulnList.map((v) => {
              const severityMap: Record<string, { label: string; color: string; bg: string }> = {
                critical: { label: '严重', color: 'text-red-400', bg: 'bg-red-500/10' },
                high: { label: '高危', color: 'text-orange-400', bg: 'bg-orange-500/10' },
                medium: { label: '中危', color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
                low: { label: '低危', color: 'text-blue-400', bg: 'bg-blue-500/10' },
                info: { label: '信息', color: 'text-gray-400', bg: 'bg-gray-500/10' },
              };
              const sev = severityMap[v.severity] || severityMap.info;
              const isLoading = vulnLoading[v.id];
              const statusLabel: Record<string, { label: string; color: string }> = {
                new: { label: '待处理', color: 'text-yellow-400' },
                confirmed: { label: '已确认', color: 'text-orange-400' },
                'false-positive': { label: '误报', color: 'text-gray-400' },
                fixed: { label: '已修复', color: 'text-green-400' },
                verified: { label: '已验证', color: 'text-cyan-400' },
              };
              const st = statusLabel[v.status] || { label: v.status, color: 'text-gray-400' };
              const isExpanded = expandedVulnId === v.id;

              return (
                <div key={v.id} className={`border rounded-lg overflow-hidden transition-colors ${isExpanded ? 'border-gray-600/70 bg-gray-800/50' : 'border-gray-700/50 hover:bg-gray-800/30'}`}>
                  <div
                    className="flex items-start justify-between gap-3 p-3 cursor-pointer"
                    onClick={() => setExpandedVulnId(isExpanded ? null : v.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${sev.bg} ${sev.color}`}>{sev.label}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${st.color}`}>{st.label}</span>
                        <span className="text-sm text-gray-200 truncate">{v.title}</span>
                      </div>
                      {v.location && (
                        <p className="text-xs text-gray-500 truncate">{v.location}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      {v.status === 'new' && (
                        <>
                          <button onClick={() => handleVulnAction(v.id, 'confirm')} disabled={isLoading} className="p-1.5 rounded-md text-orange-400 hover:bg-orange-500/15 disabled:opacity-50 transition-colors" title="确认为真漏洞">
                            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
                          </button>
                          <button onClick={() => handleVulnAction(v.id, 'false-positive')} disabled={isLoading} className="p-1.5 rounded-md text-gray-400 hover:bg-gray-600/15 disabled:opacity-50 transition-colors" title="标记为误报">
                            <Ban size={14} />
                          </button>
                        </>
                      )}
                      {v.status === 'confirmed' && (
                        <button onClick={() => handleVulnAction(v.id, 'fix')} disabled={isLoading} className="p-1.5 rounded-md text-green-400 hover:bg-green-500/15 disabled:opacity-50 transition-colors" title="标记已修复">
                          {isLoading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                        </button>
                      )}
                      {v.status === 'fixed' && (
                        <button onClick={() => handleVulnAction(v.id, 'verify')} disabled={isLoading} className="p-1.5 rounded-md text-cyan-400 hover:bg-cyan-500/15 disabled:opacity-50 transition-colors" title="验证通过">
                          {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                        </button>
                      )}
                      <span className={`text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                        <ChevronRight size={14} />
                      </span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-4 pb-3 pt-1 border-t border-gray-700/40 space-y-3 text-sm">
                      {v.description && (
                        <div>
                          <span className="text-gray-500 text-xs">描述</span>
                          <p className="text-gray-300 mt-0.5 whitespace-pre-wrap">{v.description}</p>
                        </div>
                      )}
                      {v.location && (
                        <div>
                          <span className="text-gray-500 text-xs">位置</span>
                          <p className="text-gray-300 mt-0.5 font-mono text-xs break-all">{v.location}</p>
                        </div>
                      )}
                      <div className="flex gap-6 text-xs text-gray-400">
                        {v.cwe && <span>CWE: <span className="text-gray-300">{v.cwe}</span></span>}
                        {v.type && <span>类型: <span className="text-gray-300">{v.type}</span></span>}
                        <span>状态: <span className={st.color}>{st.label}</span></span>
                      </div>
                      {v.POC && (
                        <div>
                          <span className="text-gray-500 text-xs">PoC</span>
                          <pre className="mt-0.5 bg-gray-900/60 text-red-300 p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap max-h-40">{v.POC}</pre>
                        </div>
                      )}
                      {v.fixSuggestion && (
                        <div>
                          <span className="text-gray-500 text-xs">修复建议</span>
                          <pre className="mt-0.5 bg-gray-900/60 text-green-300 p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap max-h-40">{v.fixSuggestion}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {task.executionResult && (
        <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle size={20} className="text-green-400" />
            <h2 className="text-lg font-semibold text-gray-100">执行结果</h2>
          </div>
          <pre className="bg-gray-900 text-green-400 p-4 rounded-lg text-sm overflow-x-auto max-h-96 whitespace-pre-wrap">
            {task.executionResult}
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
            {task.reportPath}
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
    </div>
  );
}

/** Simple markdown-ish renderer for agent output text */
function renderAgentText(text: string) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${i}`} className="bg-black/40 text-emerald-300 p-3 rounded-md text-xs overflow-x-auto my-2 font-mono border border-gray-700/50">
            {codeBlockLines.join('\n')}
          </pre>
        );
        codeBlockLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Headers
    if (line.startsWith('### ')) {
      elements.push(<h4 key={`h4-${i}`} className="text-sm font-bold text-emerald-300 mt-3 mb-1">{line.slice(4)}</h4>);
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(<h3 key={`h3-${i}`} className="text-base font-bold text-emerald-300 mt-3 mb-1">{line.slice(3)}</h3>);
      continue;
    }
    if (line.startsWith('# ')) {
      elements.push(<h2 key={`h2-${i}`} className="text-lg font-bold text-emerald-300 mt-3 mb-1">{line.slice(2)}</h2>);
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={`hr-${i}`} className="border-gray-700/50 my-3" />);
      continue;
    }

    // Table row
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      elements.push(
        <div key={`tbl-${i}`} className="text-xs font-mono text-gray-300 leading-relaxed">{line}</div>
      );
      continue;
    }

    // List item
    if (/^[-*]\s/.test(line.trim())) {
      elements.push(
        <div key={`li-${i}`} className="flex gap-2 text-sm leading-relaxed">
          <span className="text-gray-600 flex-shrink-0">•</span>
          <span>{renderInlineMarkdown(line.trim().replace(/^[-*]\s/, ''))}</span>
        </div>
      );
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(line.trim())) {
      const match = line.trim().match(/^(\d+\.)\s(.*)$/);
      elements.push(
        <div key={`ol-${i}`} className="flex gap-2 text-sm leading-relaxed">
          <span className="text-gray-500 flex-shrink-0 font-mono">{match?.[1]}</span>
          <span>{renderInlineMarkdown(match?.[2] || '')}</span>
        </div>
      );
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      elements.push(<div key={`br-${i}`} className="h-2" />);
      continue;
    }

    // Regular paragraph
    elements.push(<p key={`p-${i}`} className="text-sm leading-relaxed">{renderInlineMarkdown(line)}</p>);
  }

  return elements;
}

function renderInlineMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*)|(`[^`]+`)|(\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const m = match[0];
    if (m.startsWith('**') && m.endsWith('**')) {
      parts.push(<strong key={match.index} className="text-white font-semibold">{m.slice(2, -2)}</strong>);
    } else if (m.startsWith('`') && m.endsWith('`')) {
      parts.push(<code key={match.index} className="bg-black/40 text-amber-300 px-1.5 py-0.5 rounded text-xs font-mono">{m.slice(1, -1)}</code>);
    } else {
      parts.push(m);
    }
    lastIndex = match.index + m.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

const toolDisplayNameMap: Record<string, string> = { other: '其他工具', unknown: '未知工具' };

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
      !['Agent 输出', '工具调用', '工具结果'].includes(l.message) && l.level !== 'error'
    );

    const agentOutputText = agentOutputLogs.map(l => l.details || '').join('');

    // Tool call summary
    const toolCounts: Record<string, number> = {};
    toolCallLogs.forEach(l => {
      const rawName = l.details?.replace(/^工具:\s*/, '') || 'unknown';
      const toolName = toolDisplayNameMap[rawName] || rawName;
      toolCounts[toolName] = (toolCounts[toolName] || 0) + 1;
    });

    return {
      agentOutput: { logs: agentOutputLogs, text: agentOutputText },
      toolCalls: { logs: toolCallLogs, counts: toolCounts },
      errors: { logs: errorLogs },
      status: { logs: statusLogs },
    };
  }, [logs]);

  const agentCharCount = groupedLogs.agentOutput.text.length;

  return (
    <div className="space-y-4">
      {/* Agent 输出流 */}
      {groupedLogs.agentOutput.logs.length > 0 && (
        <div className="rounded-lg border border-green-500/20 overflow-hidden">
          <button
            onClick={() => setAgentOutputExpanded(!agentOutputExpanded)}
            className="w-full flex items-center justify-between p-3 bg-green-500/5 hover:bg-green-500/10 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-green-400" />
              <span className="text-sm font-medium text-green-400">Agent 输出流</span>
              <span className="text-xs text-gray-500">({groupedLogs.agentOutput.logs.length} 条 · {agentCharCount > 1000 ? `${(agentCharCount / 1000).toFixed(1)}k` : agentCharCount} 字符)</span>
            </div>
            {agentOutputExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          </button>

          {agentOutputExpanded && (
            <div className="border-t border-green-500/10">
              <div className="p-4 max-h-[500px] overflow-y-auto bg-[#0a0f0a]/50">
                <div className="text-gray-200">
                  {renderAgentText(groupedLogs.agentOutput.text)}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 工具调用统计 */}
      {groupedLogs.toolCalls.logs.length > 0 && (
        <div className="rounded-lg border border-blue-500/20 overflow-hidden">
          <button
            onClick={() => setToolCallsExpanded(!toolCallsExpanded)}
            className="w-full flex items-center justify-between p-3 bg-blue-500/5 hover:bg-blue-500/10 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Wrench size={16} className="text-blue-400" />
              <span className="text-sm font-medium text-blue-400">工具调用</span>
              <span className="text-xs text-gray-500">({groupedLogs.toolCalls.logs.length} 次)</span>
              <div className="hidden sm:flex items-center gap-1.5 ml-2">
                {Object.entries(groupedLogs.toolCalls.counts).map(([name, count]) => (
                  <span key={name} className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-500/10 text-blue-300 border border-blue-500/20">
                    {name} <span className="text-blue-400/60 ml-1">×{count}</span>
                  </span>
                ))}
              </div>
            </div>
            {toolCallsExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          </button>

          {toolCallsExpanded && (
            <div className="border-t border-blue-500/10 px-3 pb-3">
              <div className="space-y-0.5 max-h-40 overflow-y-auto py-2">
                {groupedLogs.toolCalls.logs.map((log, idx) => (
                  <div key={log.id} className="flex items-center gap-2 text-xs">
                    <span className="text-gray-600 font-mono w-6 text-right">{idx + 1}.</span>
                    <span className="text-blue-300">{toolDisplayNameMap[log.details?.replace(/^工具:\s*/, '') || 'unknown'] || log.details}</span>
                    <span className="text-gray-700 ml-auto">{formatDate(log.timestamp)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 错误信息 */}
      {groupedLogs.errors.logs.length > 0 && (
        <div className="rounded-lg border border-red-500/20 overflow-hidden">
          <button
            onClick={() => setErrorsExpanded(!errorsExpanded)}
            className="w-full flex items-center justify-between p-3 bg-red-500/5 hover:bg-red-500/10 transition-colors"
          >
            <div className="flex items-center gap-2">
              <XCircle size={16} className="text-red-400" />
              <span className="text-sm font-medium text-red-400">错误信息</span>
              <span className="text-xs text-gray-500">({groupedLogs.errors.logs.length} 条)</span>
            </div>
            {errorsExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          </button>

          {errorsExpanded && (
            <div className="border-t border-red-500/10 px-3 pb-3">
              <div className="space-y-2 py-2">
                {groupedLogs.errors.logs.map((log) => (
                  <div key={log.id} className="bg-red-500/5 p-3 rounded-md border border-red-500/10">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-red-400">{log.message}</span>
                      <span className="text-xs text-gray-600">{formatDate(log.timestamp)}</span>
                    </div>
                    {log.details && (
                      <pre className="text-xs text-red-300/80 whitespace-pre-wrap overflow-x-auto mt-1 font-mono">
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
        <div className="rounded-lg border border-gray-700/30 overflow-hidden">
          <button
            onClick={() => setStatusExpanded(!statusExpanded)}
            className="w-full flex items-center justify-between p-3 bg-gray-500/5 hover:bg-gray-500/10 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-gray-400" />
              <span className="text-sm font-medium text-gray-300">执行状态时间线</span>
              <span className="text-xs text-gray-500">({groupedLogs.status.logs.length} 步)</span>
            </div>
            {statusExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          </button>

          {statusExpanded && (
            <div className="border-t border-gray-700/20 px-4 pb-3">
              <div className="space-y-0 max-h-64 overflow-y-auto py-3">
                {groupedLogs.status.logs.map((log, idx) => {
                  const logConfig = logLevelConfig[log.level] || logLevelConfig.info;
                  const isPhase = log.message === '阶段开始' || log.message === '阶段完成' || log.message === '知识图谱预处理' || log.message === '知识图谱就绪';
                  const dotColor = log.message.includes('完成') || log.message.includes('就绪')
                    ? 'bg-green-500'
                    : log.message.includes('开始') || log.message.includes('预处理')
                      ? 'bg-blue-500'
                      : log.level === 'error' ? 'bg-red-500' : 'bg-gray-500';

                  return (
                    <div key={log.id} className="flex items-start gap-3 relative">
                      {/* Timeline dot and line */}
                      <div className="flex flex-col items-center flex-shrink-0 w-4">
                        <div className={`w-2 h-2 rounded-full ${dotColor} ${isPhase ? 'ring-2 ring-offset-1 ring-offset-[#0a0f0a]' : ''} ${isPhase && dotColor === 'bg-green-500' ? 'ring-green-500/30' : isPhase && dotColor === 'bg-blue-500' ? 'ring-blue-500/30' : ''}`} />
                        {idx < groupedLogs.status.logs.length - 1 && (
                          <div className="w-px flex-1 bg-gray-700/30 min-h-[20px]" />
                        )}
                      </div>

                      <div className="flex-1 pb-3">
                        <div className="flex items-center justify-between">
                          <span className={`text-sm ${isPhase ? 'font-medium' : ''} ${logConfig.text}`}>{log.message}</span>
                          <span className="text-xs text-gray-600 flex-shrink-0 ml-4">{formatDate(log.timestamp)}</span>
                        </div>
                        {log.details && (
                          <p className="text-xs text-gray-500 mt-0.5">{log.details}</p>
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