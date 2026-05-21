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
    return <span className="px-2 py-0.5 text-xs rounded-full bg-blue-500/15 text-blue-400">{s}</span>;
  return <span className="px-2 py-0.5 text-xs rounded-full bg-gray-700 text-gray-400">{s}</span>;
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
    if (CHUNK_TYPES.has(t)) return { badge: 'Log', text: (ev.content || '').slice(0, 200), color: 'bg-gray-800 text-gray-400' };
    return { badge: t, text: ev.content || ev.message || '', color: 'bg-gray-700 text-gray-300' };
  };

  if (merged.length === 0) return <Empty text="暂无事件记录" />;

  return (
    <div className="bg-gray-900 rounded-lg p-3 overflow-y-auto max-h-[calc(100vh-320px)]">
      <div className="space-y-0.5 font-mono text-xs">
        {merged.map((ev, i) => {
          const { badge, text, color } = getDisplay(ev);
          const ts = ev._createdAt || ev.timestamp;
          return (
            <div key={i} className="flex items-start gap-2 py-0.5">
              <span className="text-gray-600 shrink-0 w-20 text-right">
                {ts ? new Date(ts).toLocaleTimeString('zh-CN') : ''}
              </span>
              <span className={`px-1.5 rounded text-[10px] shrink-0 ${color}`}>{badge}</span>
              {text && <span className="text-gray-300 break-all">{text}</span>}
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
        <div key={i} className="border border-gray-700/50 rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center gap-2 px-3 py-2 bg-dark-surface hover:bg-dark-surface-hover text-left"
            onClick={() => setOpen(open === i ? null : i)}
          >
            {open === i ? <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" /> : <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />}
            <span className="text-xs font-medium text-purple-300">{sk.toolName}</span>
            <span className="text-xs text-gray-500 ml-auto">{fmtTime(sk.startTime)}</span>
          </button>
          {open === i && (
            <div className="px-3 py-2 bg-gray-900 space-y-2 text-xs font-mono">
              <div>
                <span className="text-gray-500">Input:</span>
                <pre className="mt-1 text-cyan-400 whitespace-pre-wrap break-all">{JSON.stringify(sk.input, null, 2)}</pre>
              </div>
              {sk.result !== undefined && (
                <div>
                  <span className="text-gray-500">Result:</span>
                  <pre className="mt-1 text-green-400 whitespace-pre-wrap break-all">
                    {typeof sk.result === 'string' ? sk.result.slice(0, 1000) : JSON.stringify(sk.result, null, 2).slice(0, 1000)}
                  </pre>
                </div>
              )}
              {sk.reasoning?.length > 0 && (
                <div>
                  <span className="text-gray-500">Reasoning:</span>
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
        <div key={i} className="border border-gray-700/50 rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center gap-2 px-3 py-2 bg-dark-surface hover:bg-dark-surface-hover text-left"
            onClick={() => setOpen(open === i ? null : i)}
          >
            {open === i ? <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" /> : <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />}
            <span className="text-xs font-medium text-yellow-300">{t.toolName}</span>
            <span className="text-xs text-gray-500 ml-auto">{fmtTime(t.startTime)}</span>
          </button>
          {open === i && (
            <div className="px-3 py-2 bg-gray-900 space-y-2 text-xs font-mono">
              <div>
                <span className="text-gray-500">Input:</span>
                <pre className="mt-1 text-cyan-400 whitespace-pre-wrap break-all">{JSON.stringify(t.input, null, 2).slice(0, 1000)}</pre>
              </div>
              {t.result !== undefined && (
                <div>
                  <span className="text-gray-500">Result:</span>
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
          <div className="text-xs text-gray-500 mb-1">{fmtTime(r.startTime)}</div>
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
          <h4 className="text-xs font-medium text-gray-400 mb-1">执行结果</h4>
          <pre className="bg-gray-900 text-green-400 p-3 rounded-lg text-xs whitespace-pre-wrap break-all">
            {csTask.result}
          </pre>
        </div>
      )}
      {csTask?.reportContent && (
        <div>
          <h4 className="text-xs font-medium text-gray-400 mb-1">安全报告</h4>
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
          <h4 className="text-xs font-medium text-gray-400 mb-1">执行日志 ({execLogs.length})</h4>
          <div className="bg-gray-900 rounded-lg p-3 space-y-0.5 font-mono text-xs">
            {execLogs.map((log, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-gray-600 shrink-0">{new Date(log.timestamp).toLocaleTimeString('zh-CN')}</span>
                <span className={`shrink-0 ${log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-yellow-400' : 'text-gray-400'}`}>[{log.level}]</span>
                <span className="text-gray-300 break-all">{log.message}</span>
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
    <div className="flex items-center justify-center h-32 text-sm text-gray-500">{text}</div>
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
      <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
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
        <div><span className="text-gray-500">任务名称：</span><span className="text-gray-200">{instance.name}</span></div>
        <div><span className="text-gray-500">Agent：</span><span className="text-gray-200">{instance.agentName}</span></div>
        <div><span className="text-gray-500">模型：</span><span className="text-gray-200">{instance.modelName || csTask?.model || '-'}</span></div>
        <div><span className="text-gray-500">引擎：</span><span className="text-gray-200">{csTask?.engine || '-'}</span></div>
        <div><span className="text-gray-500">目标产品：</span><span className="text-gray-200">{instance.targetProduct || '-'}</span></div>
        <div><span className="text-gray-500">耗时：</span><span className="text-gray-200">{fmtDuration(instance.startedAt, instance.completedAt)}</span></div>
        {csTask?.workspacePath && (
          <div className="col-span-2"><span className="text-gray-500">工作目录：</span><code className="text-gray-300">{csTask.workspacePath}</code></div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-700/50">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-xs rounded-t transition-colors ${
              tab === t.key ? 'bg-dark-surface-hover text-white border-b-2 border-blue-500' : 'text-gray-400 hover:text-gray-200'
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
      {/* Header */}
      <div className="flex items-center justify-between bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center">
            <GitBranch size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">数据回流</h1>
            <p className="text-sm text-gray-400 mt-0.5">任务执行 Trace 记录</p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-3 py-2 bg-dark-surface-hover hover:bg-gray-700 rounded-lg text-sm transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          刷新
        </button>
      </div>

      {/* Body: two-column layout */}
      <div className="flex gap-4 items-start">
        {/* Left: task list */}
        <div className="w-80 shrink-0 bg-dark-surface border border-gray-700/50 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700/50 text-sm font-medium text-gray-300">
            任务列表 {total > 0 && <span className="text-gray-500 font-normal">({total})</span>}
          </div>
          {loading && tasks.length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-gray-500">暂无任务</div>
          ) : (
            <div className="divide-y divide-gray-700/30">
              {tasks.map(t => (
                <button
                  key={t.id}
                  onClick={() => handleSelect(t.id)}
                  className={`w-full text-left px-4 py-3 hover:bg-dark-surface-hover transition-colors ${
                    selectedId === t.id ? 'bg-blue-900/20 border-l-2 border-blue-500' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {t.csState === 'completed' || t.status === 'completed'
                      ? <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      : t.csState === 'failed' || t.status === 'failed'
                      ? <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                      : <Clock className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                    <span className="text-xs font-medium text-gray-200 truncate">{t.name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-gray-500">
                    <span className="truncate">{t.agentName}</span>
                    {t.targetProduct && <span className="shrink-0 text-teal-500">{t.targetProduct}</span>}
                  </div>
                  <div className="text-[11px] text-gray-600 mt-0.5">{fmtTime(t.createdAt)}</div>
                </button>
              ))}
            </div>
          )}
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-gray-700/50 text-xs text-gray-400">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="disabled:opacity-40 hover:text-gray-200">上一页</button>
              <span>{page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="disabled:opacity-40 hover:text-gray-200">下一页</button>
            </div>
          )}
        </div>

        {/* Right: trace detail */}
        <div className="flex-1 min-w-0 bg-dark-surface border border-gray-700/50 rounded-xl p-5">
          {selectedId ? (
            <TracePanel key={selectedId} taskId={selectedId} />
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
              <GitBranch className="w-12 h-12 opacity-30 mb-3" />
              <p className="text-sm">选择左侧任务查看执行 Trace</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
