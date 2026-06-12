'use client';

import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Settings, FileText, Clock, Play, CheckCircle, XCircle, Loader2, ChevronRight, Wrench, Activity, Cpu, ShieldAlert, Download, Shield, Eye, Ban, MapPin } from 'lucide-react';
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
  fileName: string | null;
  projectPath: string | null;
  skills: string | null;
  scripts: string | null;
  mergedSkills: string | null;
  mergedScripts: string | null;
  notes: string | null;
  targetProduct: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  executionResult: string | null;
  reportPath: string | null;
  reportFilePath: string | null;
  codeswarmTaskId: string | null;
  createdAt: string;
  updatedAt: string;
  displayStatus?: 'pending' | 'queued' | 'dispatched' | 'running' | 'completed' | 'failed';
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
  pending:     { bg: 'bg-dark-surface-hover', text: 'text-gray-300', label: '未执行', icon: Clock },
  queued:      { bg: 'bg-slate-100', text: 'text-slate-400', label: '排队中', icon: Clock },
  dispatched:  { bg: 'bg-purple-100', text: 'text-purple-400', label: '已分发', icon: Loader2 },
  running:     { bg: 'bg-blue-100', text: 'text-blue-400', label: '执行中', icon: Loader2 },
  completed:   { bg: 'bg-green-100', text: 'text-green-400', label: '已完成', icon: CheckCircle },
  failed:      { bg: 'bg-red-100', text: 'text-red-400', label: '失败', icon: XCircle },
};

const getDisplayStatus = (task: TaskInstance): 'pending' | 'queued' | 'dispatched' | 'running' | 'completed' | 'failed' => {
  if (task.displayStatus) return task.displayStatus;
  // Fallback: compute from task.status and codeswarmStatus
  if (!task.codeswarmTaskId) {
    if (task.status === 'completed') return 'completed';
    if (task.status === 'failed') return 'failed';
    return 'pending';
  }
  // No codeswarmStatus available in interface, rely on displayStatus from API
  return task.status as any;
};

export default function TaskDetailPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <TaskDetailContent />
    </Suspense>
  );
}

function TaskDetailContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskId = params.id as string;

  const backParams = (() => {
    const p = new URLSearchParams();
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const page = searchParams.get('page');
    const limit = searchParams.get('limit');
    if (status) p.set('status', status);
    if (search) p.set('search', search);
    if (page) p.set('page', page);
    if (limit) p.set('limit', limit);
    return p.toString();
  })();
  const backUrl = `/dashboard/task-builder${backParams ? `?${backParams}` : ''}`;

  const [task, setTask] = useState<TaskInstance | null>(null);
  const [logs, setLogs] = useState<TaskExecutionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [codeswarmStatus, setCodeswarmStatus] = useState<CodeswarmStatus | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [vulnStats, setVulnStats] = useState<{ total: number; bySeverity: Record<string, number>; byStatus: Record<string, number> } | null>(null);
  const [reportFiles, setReportFiles] = useState<{ hasReport: boolean; files: { name: string }[] } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [vulnList, setVulnList] = useState<any[]>([]);
  const [vulnLoading, setVulnLoading] = useState<Record<string, boolean>>({});
  const [expandedVulnId, setExpandedVulnId] = useState<string | null>(null);
  const [fpVulnId, setFpVulnId] = useState<string | null>(null);
  const [fpReason, setFpReason] = useState('');

  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const sortedVulnList = useMemo(() => [...vulnList].sort((a: any, b: any) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9)), [vulnList]);
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
        setCodeswarmStatus(data.codeswarmStatus || null);
        if (data.task && data.displayStatus) {
          setTask({ ...data.task, displayStatus: data.displayStatus });
        }
      } else {
        setTask(null);
        setCodeswarmStatus(null);
      }
    } catch {
      setTask(null);
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
    if ((task?.status === 'running' || (task?.displayStatus === 'running' || task?.displayStatus === 'queued' || task?.displayStatus === 'dispatched')) && task.startedAt) {
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
  // 轮询 CodeswarmTask 状态（running 最长 30 分钟，completed 后继续 60 秒）
  useEffect(() => {
    const completedAtMs = task?.completedAt ? new Date(task.completedAt).getTime() : 0;

    if (task?.status === 'running' || task?.displayStatus === 'running' || task?.displayStatus === 'queued' || task?.displayStatus === 'dispatched') {
      const startedAt = Date.now();
      const MAX_DURATION = 30 * 60 * 1000;
      const maxTimeout = setTimeout(() => {
        if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
      }, MAX_DURATION);

      pollingRef.current = setInterval(() => {
        if (Date.now() - startedAt > MAX_DURATION) {
          if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
          return;
        }
        fetchTaskDetail(taskId, false);
      }, 5000);

      return () => {
        if (pollingRef.current) clearInterval(pollingRef.current);
        clearTimeout(maxTimeout);
      };
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

  const streamAbortRef = useRef<AbortController | null>(null);

  const subscribeToLogs = async (id: string) => {
    const token = localStorage.getItem('token');
    setIsStreaming(true);
    streamAbortRef.current = new AbortController();

    try {
      const response = await fetch(`/api/task-builder/tasks/${id}/logs/stream`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: streamAbortRef.current.signal,
      });

      if (!response.ok || !response.body) {
        setIsStreaming(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const processChunk = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (!data) continue;
                try {
                  const log = JSON.parse(data);

                  if (log.type === 'initial' && log.logs) {
                    setLogs(log.logs.map((l: any) => ({
                      id: l.id || Date.now().toString(),
                      taskId: id,
                      timestamp: l.timestamp || new Date().toISOString(),
                      level: l.level,
                      message: l.message,
                      details: l.details,
                      createdAt: new Date().toISOString(),
                    })));
                    continue;
                  }

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
                    reader.cancel();
                    setIsStreaming(false);
                    fetchTaskDetail(id, false);
                    return;
                  }
                } catch {}
              }
            }
          }
        } catch {
          // reader cancelled or connection closed
        } finally {
          setIsStreaming(false);
        }
      };

      processChunk();
    } catch {
      setIsStreaming(false);
    }
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

  const handleStop = async () => {
    if (stopping) return;
    setStopping(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/task-builder/tasks/${taskId}/stop`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '停止失败');
      }

      toast.success('任务已停止');
      fetchTaskDetail(taskId, false);
    } catch (error) {
      console.error('停止失败:', error);
      toast.error(error instanceof Error ? error.message : '停止失败');
    } finally {
      setStopping(false);
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

  const downloadFile = async (fileIndex: number, fileName: string) => {
    const token = localStorage.getItem('token');
    const response = await fetch(`/api/task-builder/tasks/${taskId}/download-report?fileIndex=${fileIndex}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('下载失败');
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
      for (let i = 0; i < reportFiles.files.length; i++) {
        await downloadFile(i, reportFiles.files[i].name);
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
    if (action === 'false-positive') {
      setFpVulnId(vulnId);
      setFpReason('');
      return;
    }
    setVulnLoading(prev => ({ ...prev, [vulnId]: true }));
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/vulnerabilities/${vulnId}/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        toast.success('操作成功');
        setVulnList(prev => prev.map(v => v.id === vulnId ? { ...v, ...data.vulnerability } : v));
      } else {
        toast.error('操作失败');
      }
    } catch {
      toast.error('网络错误');
    } finally {
      setVulnLoading(prev => ({ ...prev, [vulnId]: false }));
    }
  };

  const submitFalsePositive = async () => {
    if (!fpVulnId) return;
    setVulnLoading(prev => ({ ...prev, [fpVulnId!]: true }));
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/vulnerabilities/${fpVulnId}/false-positive`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: fpReason }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success('已标记为误报');
        setVulnList(prev => prev.map(v => v.id === fpVulnId ? { ...v, ...data.vulnerability } : v));
      } else {
        toast.error('操作失败');
      }
    } catch {
      toast.error('网络错误');
    } finally {
      setVulnLoading(prev => ({ ...prev, [fpVulnId!]: false }));
      setFpVulnId(null);
      setFpReason('');
    }
  };

  useEffect(() => {
    fetchReportFiles();
  }, [fetchReportFiles]);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      streamAbortRef.current?.abort();
    };
  }, []);

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
          onClick={() => router.push(backUrl)}
          className="mt-4 px-4 py-2 text-blue-400 hover:text-blue-800"
        >
          返回列表
        </button>
      </div>
    );
  }

  const config = statusConfig[getDisplayStatus(task)] || statusConfig.pending;
  const StatusIcon = config.icon;

  // 从事件推断当前 Agent 执行阶段
  const getParallelPhases = (): { agentPhase: string; agentColor: string; agentDetail: string; codedmapPhase: string; codedmapColor: string; codedmapDetail: string } => {
    const defaults = { agentPhase: '未执行', agentColor: 'text-gray-400', agentDetail: '', codedmapPhase: '跳过', codedmapColor: 'text-gray-500', codedmapDetail: '' };
    if (!codeswarmStatus) {
      if (getDisplayStatus(task) === 'running' || getDisplayStatus(task) === 'queued' || getDisplayStatus(task) === 'dispatched') return { ...defaults, agentPhase: '等待调度', agentColor: 'text-yellow-400', agentDetail: '任务已提交，等待 Worker 接收' };
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
          onClick={() => router.push(backUrl)}
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
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-gray-100">{task.name}</h1>
                {task.targetProduct && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-purple-500/15 text-purple-400 border border-purple-500/30">
                    <MapPin size={12} />
                    {task.targetProduct}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-400 mt-1">Agent: {task.agentName}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${config.bg} ${config.text}`}>
              <StatusIcon size={14} className={`mr-1 ${(getDisplayStatus(task) === 'running' || getDisplayStatus(task) === 'queued' || getDisplayStatus(task) === 'dispatched') ? 'animate-spin' : ''}`} />
              {config.label}
            </span>
{getDisplayStatus(task) === 'pending' && (
               <button
                 onClick={handleExecute}
                 disabled={executing}
                 className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
               >
                 {executing ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                 {executing ? '启动中...' : '执行任务'}
               </button>
             )}
{(getDisplayStatus(task) === 'running' || getDisplayStatus(task) === 'queued' || getDisplayStatus(task) === 'dispatched') && (
                 <button
                   onClick={handleStop}
                   disabled={stopping}
                   className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                 >
                   {stopping ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
                   {stopping ? '停止中...' : '停止任务'}
                 </button>
               )}
            {getDisplayStatus(task) === 'completed' && reportFiles?.hasReport && (
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
      {(task.startedAt || getDisplayStatus(task) === 'running' || getDisplayStatus(task) === 'queued' || getDisplayStatus(task) === 'dispatched' || codeswarmStatus) && (
        <div className="bg-dark-surface rounded-lg border border-gray-700/50 px-4 py-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-start text-xs">
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
                <p className="text-gray-300 whitespace-normal break-all">
                  {task.startedAt ? formatDate(task.startedAt) : '-'}
                  {task.completedAt
                    ? ` → ${formatDate(task.completedAt)}`
                    : (getDisplayStatus(task) === 'running' || getDisplayStatus(task) === 'queued' || getDisplayStatus(task) === 'dispatched') && <span className="text-blue-400 font-mono ml-1">{formatElapsed(elapsedSeconds)}</span>}
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

      {(task.fileName || task.projectPath) && (
        <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={20} className="text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-100">上传文件</h2>
          </div>
          {task.fileName && (
            <p className="text-sm text-gray-300">
              <span className="text-gray-500 mr-2">文件名:</span>{task.fileName}
            </p>
          )}
          {task.projectPath && (
            <p className="text-sm text-gray-400 mt-1">
              <span className="text-gray-500 mr-2">工作目录:</span>{task.projectPath}
            </p>
          )}
        </div>
      )}

      {task.targetProduct && (
        <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-6">
          <div className="flex items-center gap-2 mb-4">
            <MapPin size={20} className="text-purple-400" />
            <h2 className="text-lg font-semibold text-gray-100">产品与知识图谱</h2>
          </div>
          <div className="flex items-start gap-6">
            <div>
              <p className="text-xs text-gray-500 mb-1">目标产品</p>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm font-medium bg-purple-500/15 text-purple-300 border border-purple-500/30">
                <MapPin size={14} />
                {task.targetProduct}
              </span>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">知识图谱状态</p>
              <span className={`text-sm font-medium ${parallelPhases.codedmapColor}`}>
                {parallelPhases.codedmapPhase}
              </span>
              {parallelPhases.codedmapDetail && (
                <p className="text-xs text-gray-500 mt-0.5">{parallelPhases.codedmapDetail}</p>
              )}
            </div>
          </div>
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
                      {v.status === 'false-positive' && v.falsePositiveReason && (
                        <div>
                          <span className="text-gray-500 text-xs">误报原因</span>
                          <p className="mt-0.5 text-gray-300 whitespace-pre-wrap bg-gray-900/60 p-2 rounded text-xs">{v.falsePositiveReason}</p>
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

      {fpVulnId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-gray-800 rounded-lg border border-gray-600 p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-semibold text-gray-100 mb-3">标记为误报</h3>
            <p className="text-sm text-gray-400 mb-4">请填写标记为误报的原因（可选）：</p>
            <textarea
              value={fpReason}
              onChange={e => setFpReason(e.target.value)}
              rows={3}
              className="w-full bg-gray-900 border border-gray-600 rounded-md p-3 text-sm text-gray-200 resize-none focus:outline-none focus:border-blue-500"
              placeholder="如：该漏洞在当前上下文中不构成实际威胁..."
            />
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => { setFpVulnId(null); setFpReason(''); }} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 rounded-md transition-colors">取消</button>
              <button onClick={submitFalsePositive} disabled={vulnLoading[fpVulnId]} className="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-500 text-gray-100 rounded-md disabled:opacity-50 transition-colors">确认</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}