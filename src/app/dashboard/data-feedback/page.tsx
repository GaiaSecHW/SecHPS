'use client';

import { useState, useEffect, useCallback } from 'react';
import { GitBranch, RefreshCw, CheckCircle, XCircle, Loader2, Clock, ChevronRight, ChevronDown } from 'lucide-react';
import { useApiFetch } from '@/hooks/useApiFetch';
import { apiGet } from '@/lib/api-client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TaskRow {
  id: string;
  name: string;
  agentName: string;
  modelName: string | null;
  status: string;
  targetProduct: string | null;
  codeswarmTaskId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  errorMessage: string | null;
  csState: string | null;
  engine: string | null;
  sessionId: string | null;
}

interface TasksResponse {
  tasks: TaskRow[];
  total: number;
  page: number;
  limit: number;
}

interface TraceData {
  instance: any;
  csTask: any;
  events: any[];
  execLogs: any[];
  sessionExtract: any;
}

type Tab = 'events' | 'skills' | 'tools' | 'reasoning' | 'result';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CHUNK_TYPES = new Set(['agent_message_chunk', 'log_chunk', 'agent_log_chunk']);

function mergeChunks(events: any[]): any[] {
  const merged: any[] = [];
  for (const ev of events) {
    const type = ev._type || ev.type;
    if (CHUNK_TYPES.has(type)) {
      const prev = merged[merged.length - 1];
      if (prev?._merged && CHUNK_TYPES.has(prev._type || prev.type)) {
        prev.content = (prev.content || '') + (ev.content || '');
        continue;
      }
      merged.push({ ...ev, _merged: true });
    } else {
      merged.push(ev);
    }
  }
  return merged;
}

function fmtTime(d: string | null) {
  if (!d) return '-';
  return new Date(d).toLocaleString('zh-CN');
}

function fmtDuration(start: string | null, end: string | null) {
  if (!start) return '-';
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  if (ms < 0) return '0s';
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function statusBadge(status: string, csState: string | null) {
  const s = csState || status;
  if (s === 'completed') return <span className="px-2 py-0.5 text-xs rounded-full bg-green-500/15 text-green-400">完成</span>;
  if (s === 'failed') return <span className="px-2 py-0.5 text-xs rounded-full bg-red-500/15 text-red-400">失败</span>;
  if (['running', 'dispatched', 'building', 'queued'].includes(s))
    return <span className="px-2 py-0.5 text-xs rounded-full bg-indigo-500/15 text-indigo-400">{s}</span>;
  return <span className="px-2 py-0.5 text-xs rounded-full bg-dark-surface-hover text-dark-text-muted">{s}</span>;
}

// ─── Event Stream Tab ─────────────────────────────────────────────────────────

function EventsTab({ events }: { events: any[] }) {
  const merged = mergeChunks(events);

  const getDisplay = (ev: any) => {
    const t = ev._type || ev.type;
    if (t === 'skill_start') return { badge: 'Skill', text: ev.skill || '', color: 'bg-purple-900/50 text-purple-300' };
    if (t === 'skill_complete') return { badge: 'Skill✓', text: ev.skill || '', color: 'bg-purple-900/30 text-purple-400' };
    if (t === 'tool_call') return { badge: 'Tool', text: ev.tool || '', color: 'bg-yellow-900/50 text-yellow-300' };
    if (t === 'tool_call_update') return { badge: 'Result', text: (ev.output || '').slice(0, 120), color: 'bg-blue-900/50 text-blue-300' };
    if (t === 'error') return { badge: 'Error', text: ev.message || '', color: 'bg-red-900/50 text-red-400' };
    if (t === 'phase_start' || t === 'phase_complete') return { badge: 'Phase', text: ev.phase || ev.message || '', color: 'bg-cyan-900/50 text-cyan-300' };
    if (CHUNK_TYPES.has(t)) return { badge: 'Log', text: (ev.content || '').slice(0, 200), color: 'bg-dark-surface-hover text-dark-text-muted' };
    return { badge: t, text: ev.content || ev.message || '', color: 'bg-dark-surface-hover text-dark-text-secondary' };
  };

  if (merged.length === 0) return <Empty text="暂无事件记录" />;

  return (
    <div className="bg-dark-bg rounded-lg p-3 overflow-y-auto max-h-[calc(100vh-320px)]">
      <div className="space-y-0.5 font-mono text-xs">
        {merged.map((ev, i) => {
          const { badge, text, color } = getDisplay(ev);
          const ts = ev._createdAt || ev.timestamp;
          return (
            <div key={i} className="flex items-start gap-2 py-0.5">
              <span className="text-dark-text-muted shrink-0 w-20 text-right">
                {ts ? new Date(ts).toLocaleTimeString('zh-CN') : ''}
              </span>
              <span className={`px-1.5 rounded text-[10px] shrink-0 ${color}`}>{badge}</span>
              {text && <span className="text-dark-text-secondary break-all">{text}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Skills Tab ───────────────────────────────────────────────────────────────

function SkillsTab({ skills, events }: { skills: any[]; events: any[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const items = skills?.length ? skills : extractFromEvents(events || []).skills;
  if (!items.length) return <Empty text="暂无 Skill 调用记录" />;
  return (
    <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-320px)]">
      {items.map((sk, i) => (
        <div key={i} className="border border-dark-border/40 rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center gap-2 px-3 py-2 bg-dark-surface hover:bg-dark-surface-hover text-left"
            onClick={() => setOpen(open === i ? null : i)}
          >
            {open === i ? <ChevronDown className="w-3 h-3 text-dark-text-muted shrink-0" /> : <ChevronRight className="w-3 h-3 text-dark-text-muted shrink-0" />}
            <span className="text-xs font-medium text-purple-300">{sk.toolName}</span>
            <span className="text-xs text-dark-text-muted ml-auto">{fmtTime(sk.startTime)}</span>
          </button>
          {open === i && (
            <div className="px-3 py-2 bg-dark-bg space-y-2 text-xs font-mono">
              <div>
                <span className="text-dark-text-muted">Input:</span>
                <pre className="mt-1 text-cyan-400 whitespace-pre-wrap break-all">{JSON.stringify(sk.input, null, 2)}</pre>
              </div>
              {sk.result !== undefined && (
                <div>
                  <span className="text-dark-text-muted">Result:</span>
                  <pre className="mt-1 text-green-400 whitespace-pre-wrap break-all">
                    {typeof sk.result === 'string' ? sk.result.slice(0, 1000) : JSON.stringify(sk.result, null, 2).slice(0, 1000)}
                  </pre>
                </div>
              )}
              {sk.reasoning?.length > 0 && (
                <div>
                  <span className="text-dark-text-muted">Reasoning:</span>
                  <div className="mt-1 text-yellow-300 space-y-1">
                    {sk.reasoning.map((r: string, j: number) => <p key={j}>{r.slice(0, 300)}</p>)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Tools Tab ────────────────────────────────────────────────────────────────

function isSkillTool(toolName: string): boolean {
  const lower = (toolName || '').toLowerCase();
  return lower === 'skill' || lower.includes('skill') ||
    lower.startsWith('audit-') || lower.startsWith('cdm-') || lower.startsWith('tech-');
}

function extractFromEvents(events: any[]): { tools: any[]; skills: any[] } {
  const tools: any[] = [];
  const skills: any[] = [];
  // track last entry in insertion order for sequential pairing (no toolUseId in these events)
  let lastEntry: any = null;

  for (const ev of events) {
    const t = ev._type || ev.type;
    if (t === 'tool_call') {
      const entry = {
        toolName: ev.tool || ev.toolName || '(unknown)',
        toolUseId: ev.toolUseId || ev._id,
        input: ev.input ?? ev.params ?? {},
        result: undefined,
        startTime: ev._createdAt || ev.timestamp,
      };
      if (isSkillTool(entry.toolName)) skills.push(entry);
      else tools.push(entry);
      lastEntry = entry;
    } else if (t === 'tool_call_update') {
      const output: string = ev.output ?? ev.result ?? '';
      // Try to resolve the real skill name from "Launching skill: <name>"
      const skillMatch = typeof output === 'string' && output.match(/Launching skill:\s*([^\s"\\]+)/);
      if (lastEntry) {
        lastEntry.result = output;
        if (skillMatch) lastEntry.toolName = skillMatch[1];
        lastEntry = null;
      }
    }
  }
  return { tools, skills };
}

function ToolsTab({ tools, events }: { tools: any[]; events: any[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const items = tools?.length ? tools : extractFromEvents(events || []).tools;
  if (!items.length) return <Empty text="暂无工具调用记录" />;
  return (
    <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-320px)]">
      {items.map((t, i) => (
        <div key={i} className="border border-dark-border/40 rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center gap-2 px-3 py-2 bg-dark-surface hover:bg-dark-surface-hover text-left"
            onClick={() => setOpen(open === i ? null : i)}
          >
            {open === i ? <ChevronDown className="w-3 h-3 text-dark-text-muted shrink-0" /> : <ChevronRight className="w-3 h-3 text-dark-text-muted shrink-0" />}
            <span className="text-xs font-medium text-yellow-300">{t.toolName}</span>
            <span className="text-xs text-dark-text-muted ml-auto">{fmtTime(t.startTime)}</span>
          </button>
          {open === i && (
            <div className="px-3 py-2 bg-dark-bg space-y-2 text-xs font-mono">
              <div>
                <span className="text-dark-text-muted">Input:</span>
                <pre className="mt-1 text-cyan-400 whitespace-pre-wrap break-all">{JSON.stringify(t.input, null, 2).slice(0, 1000)}</pre>
              </div>
              {t.result !== undefined && (
                <div>
                  <span className="text-dark-text-muted">Result:</span>
                  <pre className="mt-1 text-green-400 whitespace-pre-wrap break-all">
                    {typeof t.result === 'string' ? t.result.slice(0, 1000) : JSON.stringify(t.result, null, 2).slice(0, 1000)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Reasoning Tab ────────────────────────────────────────────────────────────

function ReasoningTab({ reasoning }: { reasoning: any[] }) {
  if (!reasoning?.length) return <Empty text="暂无模型思考记录" />;
  return (
    <div className="space-y-3 overflow-y-auto max-h-[calc(100vh-320px)]">
      {reasoning.map((r, i) => (
        <div key={i} className="border border-yellow-900/30 rounded-lg p-3 bg-yellow-900/5">
          <div className="text-xs text-dark-text-muted mb-1">{fmtTime(r.startTime)}</div>
          <p className="text-sm text-yellow-200 whitespace-pre-wrap">{r.content}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Result Tab ───────────────────────────────────────────────────────────────

function ResultTab({ csTask, instance, execLogs }: { csTask: any; instance: any; execLogs: any[] }) {
  return (
    <div className="space-y-4 overflow-y-auto max-h-[calc(100vh-320px)]">
      {csTask?.result && (
        <div>
          <h4 className="text-xs font-medium text-dark-text-muted mb-1">执行结果</h4>
          <pre className="bg-dark-bg text-green-400 p-3 rounded-lg text-xs whitespace-pre-wrap break-all">
            {csTask.result}
          </pre>
        </div>
      )}
      {csTask?.reportContent && (
        <div>
          <h4 className="text-xs font-medium text-dark-text-muted mb-1">安全报告</h4>
          <pre className="bg-dark-surface-hover p-3 rounded-lg text-xs whitespace-pre-wrap break-all">
            {csTask.reportContent}
          </pre>
        </div>
      )}
      {(csTask?.error || instance?.errorMessage) && (
        <div>
          <h4 className="text-xs font-medium text-red-400 mb-1">错误信息</h4>
          <pre className="bg-red-900/10 text-red-400 p-3 rounded-lg text-xs whitespace-pre-wrap">
            {csTask?.error || instance?.errorMessage}
          </pre>
        </div>
      )}
      {execLogs?.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-dark-text-muted mb-1">执行日志 ({execLogs.length})</h4>
          <div className="bg-dark-bg rounded-lg p-3 space-y-0.5 font-mono text-xs">
            {execLogs.map((log, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-dark-text-muted shrink-0">{new Date(log.timestamp).toLocaleTimeString('zh-CN')}</span>
                <span className={`shrink-0 ${log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-yellow-400' : 'text-dark-text-muted'}`}>[{log.level}]</span>
                <span className="text-dark-text-secondary break-all">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {!csTask?.result && !csTask?.reportContent && !csTask?.error && !instance?.errorMessage && execLogs?.length === 0 && (
        <Empty text="暂无结果数据" />
      )}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function Empty({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center h-32 text-sm text-dark-text-muted">{text}</div>
  );
}

// ─── Trace Panel ──────────────────────────────────────────────────────────────

function TracePanel({ taskId }: { taskId: string }) {
  const [trace, setTrace] = useState<TraceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('events');

  useEffect(() => {
    setTrace(null);
    setTab('events');
    setLoading(true);
    apiGet<TraceData>(`/api/data-feedback/tasks/${taskId}`)
      .then(({ data, error }) => setTrace(error ? ({ error } as any) : data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [taskId]);

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <Loader2 className="w-6 h-6 animate-spin text-dark-text-muted" />
    </div>
  );
  if (!trace) return null;
  if (!trace.instance) return (
    <div className="flex items-center justify-center h-32 text-sm text-red-400">
      {(trace as any).error || '加载失败'}
    </div>
  );

  const { instance, csTask, events, execLogs, sessionExtract } = trace;

  const eventsExtracted = extractFromEvents(events || []);
  const skillCount = sessionExtract?.skills?.length || eventsExtracted.skills.length;
  const toolCount = sessionExtract?.tools?.length || eventsExtracted.tools.length;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'events', label: '事件流', count: events?.length },
    { key: 'skills', label: 'Skill', count: skillCount },
    { key: 'tools', label: '工具', count: toolCount },
    { key: 'reasoning', label: '思考', count: sessionExtract?.reasoning?.length },
    { key: 'result', label: '结果' },
  ];

  return (
    <div className="space-y-4">
      {/* Meta */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
        <div><span className="text-dark-text-muted">任务名称：</span><span className="text-dark-text">{instance.name}</span></div>
        <div><span className="text-dark-text-muted">Agent：</span><span className="text-dark-text">{instance.agentName}</span></div>
        <div><span className="text-dark-text-muted">模型：</span><span className="text-dark-text">{instance.modelName || csTask?.model || '-'}</span></div>
        <div><span className="text-dark-text-muted">引擎：</span><span className="text-dark-text">{csTask?.engine || '-'}</span></div>
        <div><span className="text-dark-text-muted">目标产品：</span><span className="text-dark-text">{instance.targetProduct || '-'}</span></div>
        <div><span className="text-dark-text-muted">耗时：</span><span className="text-dark-text">{fmtDuration(instance.startedAt, instance.completedAt)}</span></div>
        {csTask?.workspacePath && (
          <div className="col-span-2"><span className="text-dark-text-muted">工作目录：</span><code className="text-dark-text-secondary">{csTask.workspacePath}</code></div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-dark-border/40">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-xs rounded-t transition-colors ${
              tab === t.key ? 'bg-dark-surface-hover text-white border-b-2 border-indigo-500' : 'text-dark-text-muted hover:text-dark-text'
            }`}
          >
            {t.label}{t.count !== undefined ? ` (${t.count})` : ''}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'events' && <EventsTab events={events || []} />}
      {tab === 'skills' && <SkillsTab skills={sessionExtract?.skills || []} events={events || []} />}
      {tab === 'tools' && <ToolsTab tools={sessionExtract?.tools || []} events={events || []} />}
      {tab === 'reasoning' && <ReasoningTab reasoning={sessionExtract?.reasoning || []} />}
      {tab === 'result' && <ResultTab csTask={csTask} instance={instance} execLogs={execLogs || []} />}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DataFeedbackPage() {
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, loading, refetch } = useApiFetch<TasksResponse>(`/api/data-feedback/tasks?page=${page}&limit=20`);

  const tasks = data?.tasks || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / 20);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(prev => prev === id ? null : id);
  }, []);

  return (
    <div className="space-y-4">
      {/* Body: two-column layout */}
      <div className="flex gap-4 items-start">
        {/* Left: task list */}
        <div className="w-80 shrink-0 bg-dark-surface border border-dark-border/40 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-dark-border/40 flex items-center justify-between">
            <span className="text-sm font-medium text-dark-text-secondary">
              任务列表 {total > 0 && <span className="text-dark-text-muted font-normal">({total})</span>}
            </span>
            <button
              onClick={() => refetch()}
              className="p-1.5 text-dark-text-muted hover:text-dark-text-secondary hover:bg-dark-surface-hover rounded-lg transition-colors"
              title="刷新"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {loading && tasks.length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-dark-text-muted" />
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-dark-text-muted">暂无任务</div>
          ) : (
            <div className="divide-y divide-gray-700/30">
              {tasks.map(t => (
                <button
                  key={t.id}
                  onClick={() => handleSelect(t.id)}
                  className={`w-full text-left px-4 py-3 hover:bg-dark-surface-hover transition-colors ${
                    selectedId === t.id ? 'bg-indigo-500/10 border-l-2 border-indigo-500' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {t.csState === 'completed' || t.status === 'completed'
                      ? <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      : t.csState === 'failed' || t.status === 'failed'
                      ? <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                      : <Clock className="w-3.5 h-3.5 text-dark-text-muted shrink-0" />}
                    <span className="text-xs font-medium text-dark-text truncate">{t.name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-dark-text-muted">
                    <span className="truncate">{t.agentName}</span>
                    {t.targetProduct && <span className="shrink-0 text-teal-500">{t.targetProduct}</span>}
                  </div>
                  <div className="text-[11px] text-dark-text-muted mt-0.5">{fmtTime(t.createdAt)}</div>
                </button>
              ))}
            </div>
          )}
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-dark-border/40 text-xs text-dark-text-muted">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="disabled:opacity-40 hover:text-dark-text">上一页</button>
              <span>{page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="disabled:opacity-40 hover:text-dark-text">下一页</button>
            </div>
          )}
        </div>

        {/* Right: trace detail */}
        <div className="flex-1 min-w-0 bg-dark-surface border border-dark-border/40 rounded-xl p-5">
          {selectedId ? (
            <TracePanel key={selectedId} taskId={selectedId} />
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-dark-text-muted">
              <GitBranch className="w-12 h-12 opacity-30 mb-3" />
              <p className="text-sm">选择左侧任务查看执行 Trace</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
