import { useState, useEffect, useRef } from 'react';
import type { FormEvent } from 'react';
import { Play, ChevronDown, ChevronRight, Loader2, Terminal, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { EngineSelector } from './task-debug/EngineSelector.js';
import { TaskBaseFields } from './task-debug/TaskBaseFields.js';
import { EngineFields } from './task-debug/EngineFields.js';
import { ToolDispatchFields } from './task-debug/ToolDispatchFields.js';
import { AdvancedFields } from './task-debug/AdvancedFields.js';
import { PayloadPreview } from './task-debug/PayloadPreview.js';
import { ValidationSummary } from './task-debug/ValidationSummary.js';
import { TaskTemplates } from './task-debug/TaskTemplates.js';
import { buildSubmitPayload } from './task-debug/payload.js';
import { hasBlockingIssues, validateSubmitPayload } from './task-debug/validation.js';
import { createDefaultTaskDebugForm } from './task-debug/types.js';
import type { TaskDebugForm, WorkerOption } from './task-debug/types.js';

interface TaskDebugPanelProps {
  onTaskCreated: (taskId: string) => void;
}

interface LogEntry {
  type: string;
  message: string;
  details: string;
  timestamp: string;
  stream?: 'stdout' | 'stderr';
}

export function TaskDebugPanel({ onTaskCreated }: TaskDebugPanelProps) {
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [workerOptions, setWorkerOptions] = useState<WorkerOption[]>([]);
  const [form, setForm] = useState<TaskDebugForm>(() => createDefaultTaskDebugForm());
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchWorkers();
  }, []);

  // SSE connection for real-time logs
  useEffect(() => {
    if (!currentTaskId) return;

    const eventSource = new EventSource(`/api/codeswarm/task/${currentTaskId}/stream`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'connected') return;

        if (data.type === 'task_complete') {
          setLogs(prev => [...prev, {
            type: 'task_complete',
            message: data.state === 'completed' ? '任务完成' : '任务失败',
            details: data.result || data.error || '',
            timestamp: new Date().toISOString(),
          }]);
          setTimeout(() => eventSource.close(), 1000);
          return;
        }

        if (data.data) {
          const eventData = data.data;
          const eventLevel = eventData.level || 'agent';
          let message = '';
          let details = '';
          let streamType: 'stdout' | 'stderr' | undefined = eventData.stream;

          if (data.type === 'log_chunk' || data.type === 'agent_log_chunk') {
            message = eventLevel === 'worker' ? 'Worker' : 'Agent';
            details = eventData.content || '';
          } else if (data.type === 'agent_message_chunk') {
            message = 'Agent';
            details = eventData.content || '';
          } else if (data.type === 'task_started' || data.type === 'task_completed') {
            message = data.type === 'task_started' ? 'Start' : 'Done';
            details = eventData.command || eventData.content || '';
          } else if (data.type === 'tool_call') {
            message = 'Tool';
            details = eventData.tool || '';
            const inputObj = eventData.input;
            if (inputObj && typeof inputObj === 'object' && Object.keys(inputObj).length > 0) {
              details += ` ${cleanLogText(JSON.stringify(inputObj), 80)}`;
            }
          } else if (data.type === 'tool_result' || data.type === 'tool_call_update') {
            message = 'Result';
            details = cleanLogText(eventData.output || '', 150);
          } else if (data.type === 'skill_start') {
            message = 'Skill';
            details = eventData.skill || '';
          } else if (data.type === 'skill_complete') {
            message = 'Skill Done';
            details = eventData.skill || '';
          } else if (data.type === 'phase_start' || data.type === 'phase_complete') {
            message = 'Phase';
            details = eventData.phase || eventData.message || '';
          } else if (data.type === 'command_output') {
            message = 'Shell';
            details = cleanLogText(eventData.content || '', 150);
          } else if (data.type === 'error') {
            message = 'Error';
            details = eventData.message || '';
          } else if (data.type === 'progress') {
            message = 'Progress';
            details = eventData.content || '';
          } else {
            message = data.type;
            details = '';
          }

          if (message) {
            setLogs(prev => [...prev, {
              type: data.type,
              message,
              details,
              timestamp: data.timestamp || new Date().toISOString(),
              stream: streamType,
            }]);
          }
        }
      } catch (err) {
        console.error('[TaskDebugPanel] SSE parse error:', err);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [currentTaskId]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const fetchWorkers = async () => {
    try {
      const response = await fetch('/api/codeswarm/node/list');
      if (response.ok) {
        const data = await response.json();
        setWorkerOptions(data.workers || []);
      }
    } catch {
      // ignore
    }
  };

  const updateForm = (patch: Partial<TaskDebugForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const payload = buildSubmitPayload(form);
  const validationIssues = validateSubmitPayload(form, payload);
  const submitDisabled = loading || hasBlockingIssues(validationIssues);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const blockingIssue = validationIssues.find((issue) => issue.severity === 'error');
    if (blockingIssue !== undefined) {
      toast.error(blockingIssue.message);
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch('/api/codeswarm/task/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await resp.json();

      if (resp.ok) {
        toast.success(`任务已创建: ${data.taskId}`);
        const taskId = data.taskId;
        setCurrentTaskId(taskId);
        setLogs([]);
        setShowLogs(true);
        onTaskCreated(taskId);

        setForm((prev) => ({
          ...prev,
          instruction: '',
          projectPath: '',
          workspacePath: '',
          platformTaskId: '',
        }));
      } else {
        toast.error(data.error || '创建任务失败');
      }
    } catch (err) {
      toast.error('创建任务失败');
    } finally {
      setLoading(false);
    }
  };

  const clearLogs = () => {
    setLogs([]);
    setShowLogs(false);
    setCurrentTaskId(null);
  };

  const cleanLogText = (text: string, maxLen = 200): string => {
    if (!text) return '';
    let clean = text;
    try { clean = JSON.parse(`"${clean}"`); } catch {}
    clean = clean.replace(/\\n/g, '\n').replace(/\\t/g, '  ').replace(/\\"/g, '"');
    clean = clean.replace(/\n{3,}/g, '\n\n').replace(/  +/g, ' ');
    if (clean.length > maxLen) clean = clean.slice(0, maxLen) + '...';
    return clean.trim();
  };

  return (
    <div className="bg-dark-surface rounded-lg shadow border border-gray-700/50">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-dark-surface-hover transition-colors"
      >
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <Play className="w-5 h-5 text-blue-400" />
          </div>
          <div className="text-left">
            <h2 className="text-lg font-semibold text-gray-100">手动任务调试</h2>
            <p className="text-sm text-gray-400">创建任务并分发给 Worker 执行</p>
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="w-5 h-5 text-gray-400" />
        ) : (
          <ChevronRight className="w-5 h-5 text-gray-400" />
        )}
      </button>

      {/* Form */}
      {expanded && (
        <form onSubmit={handleSubmit} className="p-6 border-t border-gray-700/50 space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-[220px_minmax(0,1fr)_340px] gap-6 items-start">
            <EngineSelector
              form={form}
              issues={validationIssues}
              workerOptions={workerOptions}
              onEngineChange={(engine) => updateForm({ engine })}
            />

            <div className="space-y-4">
              <TaskBaseFields form={form} workerOptions={workerOptions} updateForm={updateForm} />
              <EngineFields form={form} updateForm={updateForm} />
              <ToolDispatchFields form={form} updateForm={updateForm} />
              <AdvancedFields form={form} updateForm={updateForm} />
            </div>

            <div className="space-y-4 xl:sticky xl:top-4">
              <TaskTemplates form={form} onApply={setForm} />
              <ValidationSummary issues={validationIssues} />
              <PayloadPreview payload={payload} />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitDisabled}
              className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /><span>分发中...</span></>
              ) : (
                <><Play className="w-4 h-4" /><span>创建并分发任务</span></>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Real-time Logs Panel */}
      {showLogs && (
        <div className="border-t border-gray-700/50">
          <div className="px-6 py-3 flex items-center justify-between bg-dark-surface-alt">
            <div className="flex items-center space-x-2">
              <Terminal className="w-4 h-4 text-green-400" />
              <span className="text-sm font-medium text-gray-100">实时日志</span>
              {currentTaskId && (
                <span className="text-xs text-gray-500">({currentTaskId})</span>
              )}
            </div>
            <button onClick={clearLogs} className="p-1 text-gray-400 hover:text-red-400 rounded" title="关闭日志">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <div className="h-64 overflow-y-auto bg-dark-bg p-4 font-mono text-xs">
            {logs.length === 0 ? (
              <div className="text-gray-500">等待任务开始...</div>
            ) : (
              logs.map((log, idx) => {
                let textColor = 'text-gray-300';
                let badgeColor = 'bg-gray-700 text-gray-300';
                if (log.type === 'error') { textColor = 'text-red-400'; badgeColor = 'bg-red-900/50 text-red-400'; }
                else if (log.type === 'task_complete') { textColor = 'text-green-400'; badgeColor = 'bg-green-900/50 text-green-400'; }
                else if (log.type === 'skill_start') { textColor = 'text-purple-400'; badgeColor = 'bg-purple-900/50 text-purple-400'; }
                else if (log.type === 'skill_complete') { textColor = 'text-purple-300'; badgeColor = 'bg-purple-900/40 text-purple-300'; }
                else if (log.type === 'tool_call') { textColor = 'text-yellow-400'; badgeColor = 'bg-yellow-900/50 text-yellow-400'; }
                else if (log.type === 'tool_call_update' || log.type === 'tool_result') { textColor = 'text-blue-300'; badgeColor = 'bg-blue-900/50 text-blue-300'; }
                else if (log.type === 'command_output') {
                  textColor = log.stream === 'stderr' ? 'text-yellow-400' : 'text-green-300';
                  badgeColor = log.stream === 'stderr' ? 'bg-yellow-900/50 text-yellow-400' : 'bg-green-900/50 text-green-300';
                }
                else if (log.type === 'phase_start' || log.type === 'phase_complete') { textColor = 'text-cyan-400'; badgeColor = 'bg-cyan-900/50 text-cyan-400'; }
                const cleanDetails = cleanLogText(log.details, 200);
                return (
                  <div key={idx} className={`mb-1 ${textColor}`}>
                    <span className="text-gray-600">{new Date(log.timestamp).toLocaleTimeString()}</span>{' '}
                    <span className={`px-1 rounded text-[10px] ${badgeColor}`}>{log.message}</span>
                    {cleanDetails && <span className="text-gray-400 ml-2">{cleanDetails}</span>}
                  </div>
                );
              })
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}