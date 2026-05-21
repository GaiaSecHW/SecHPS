'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Brain,
  Search,
  ChevronDown,
  Play,
  RefreshCw,
  Trash2,
  CheckCircle,
  Circle,
  Settings,
  X,
} from 'lucide-react';
import { AdminGuard } from '@/components/PermissionGuard';

interface Experience {
  id: string;
  title: string;
  errorCategory: string;
  errorPatterns: string;
  sourceModel: string;
  sourceSessionId: string;
  directSolution: string;
  lesson: string;
  isInjected: boolean;
  injectedAt: string | null;
  hitCount: number;
  savedAttempts: number;
  createdAt: string;
}

interface Stats {
  total: number;
  injected: number;
  weekNew: number;
  avgSavedAttempts: number;
  lastAutoExtract: string | null;
  totalUsage: number;
}

interface IdleConfig {
  enabled: boolean;
  windowStart: string;
  windowEnd: string;
  pollIntervalMinutes: number;
  maxSequencesPerRun: number;
}

interface SSELog {
  type: string;
  message?: string;
  scanned?: number;
  total?: number;
  skipped?: number;
  newFiles?: number;
  sequences?: number;
  created?: number;
  merged?: number;
}

interface RunLog {
  id: string;
  mode: string;
  trigger: string;
  scanned: number;
  skipped: number;
  newFiles: number;
  sequences: number;
  created: number;
  merged: number;
  status: string;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  tool_failure: '工具失败',
  path_error: '路径错误',
  permission: '权限问题',
  mcp_timeout: 'MCP超时',
  other: '其他',
};

export default function AutonomousEvolutionPage() {
  return (
    <AdminGuard>
      <AutonomousEvolutionContent />
    </AdminGuard>
  );
}

function AutonomousEvolutionContent() {
  const router = useRouter();
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterInjected, setFilterInjected] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Batch selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleSelectAll = () => {
    if (selectedIds.size === experiences.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(experiences.map(e => e.id)));
    }
  };
  const handleBatchInject = async (action: 'enable' | 'disable') => {
    if (selectedIds.size === 0) return;
    await fetch('/api/autonomous-evolution/batch-inject', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selectedIds), action }),
    });
    setSelectedIds(new Set());
    fetchExperiences();
    fetchStats();
  };

  // Extract panel
  const [extracting, setExtracting] = useState(false);
  const [extractLogs, setExtractLogs] = useState<string[]>([]);
  const [extractProgress, setExtractProgress] = useState<SSELog | null>(null);
  const [showExtractPanel, setShowExtractPanel] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Injection toggle
  const [injectionEnabled, setInjectionEnabled] = useState<boolean>(true);

  const fetchInjectionConfig = async () => {
    const res = await fetch('/api/autonomous-evolution/injection-config', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setInjectionEnabled(data.enabled);
    }
  };

  const toggleInjection = async () => {
    const next = !injectionEnabled;
    setInjectionEnabled(next);
    await fetch('/api/autonomous-evolution/injection-config', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    });
  };

  // Idle config panel
  const [showIdleConfig, setShowIdleConfig] = useState(false);
  const [idleConfig, setIdleConfig] = useState<IdleConfig>({
    enabled: false,
    windowStart: '00:00',
    windowEnd: '06:00',
    pollIntervalMinutes: 30,
    maxSequencesPerRun: 20,
  });

  // Tab & run logs
  const [activeTab, setActiveTab] = useState<'experiences' | 'runlogs'>('experiences');
  const [runLogs, setRunLogs] = useState<RunLog[]>([]);
  const [runLogsLoading, setRunLogsLoading] = useState(false);
  const [runLogsPage, setRunLogsPage] = useState(1);
  const [runLogsTotalPages, setRunLogsTotalPages] = useState(1);

  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';

  useEffect(() => {
    fetchExperiences();
    fetchStats();
    fetchInjectionConfig();
  }, [page, filterCategory, filterInjected]);

  useEffect(() => {
    if (logsEndRef.current) logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [extractLogs]);

  const fetchExperiences = async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (filterCategory) params.set('errorCategory', filterCategory);
    if (filterInjected) params.set('isInjected', filterInjected);
    if (search) params.set('search', search);
    const res = await fetch(`/api/autonomous-evolution?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setExperiences(data.data || []);
      setTotalPages(data.pagination?.totalPages || 1);
    }
    setLoading(false);
  };

  const fetchStats = async () => {
    const res = await fetch('/api/autonomous-evolution/stats', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setStats(await res.json());
  };

  const fetchIdleConfig = async () => {
    const res = await fetch('/api/autonomous-evolution/idle-config', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setIdleConfig(await res.json());
  };

  const saveIdleConfig = async () => {
    await fetch('/api/autonomous-evolution/idle-config', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(idleConfig),
    });
    setShowIdleConfig(false);
  };

  const handleExtract = async (mode: 'incremental' | 'full') => {
    setShowDropdown(false);
    setShowExtractPanel(true);
    setExtracting(true);
    setExtractLogs([]);
    setExtractProgress(null);

    const res = await fetch('/api/autonomous-evolution/extract', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, maxSequences: idleConfig.maxSequencesPerRun }),
    });

    if (!res.body) { setExtracting(false); return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() || '';
      for (const part of parts) {
        const line = part.replace(/^data: /, '').trim();
        if (!line) continue;
        try {
          const evt = JSON.parse(line) as SSELog;
          if (evt.type === 'log' && evt.message) {
            setExtractLogs(prev => [...prev, evt.message!]);
          } else if (evt.type === 'progress' || evt.type === 'done') {
            setExtractProgress(evt);
            if (evt.type === 'done' && evt.message) {
              setExtractLogs(prev => [...prev, `✅ ${evt.message}`]);
            }
          } else if (evt.type === 'error' && evt.message) {
            setExtractLogs(prev => [...prev, `❌ ${evt.message}`]);
          }
        } catch { /* ignore */ }
      }
    }

    setExtracting(false);
    fetchExperiences();
    fetchStats();
    fetchRunLogs(1);
  };

  const handleToggleInject = async (id: string) => {
    await fetch(`/api/autonomous-evolution/${id}/inject`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchExperiences();
    fetchStats();
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`确定删除「${title}」？`)) return;
    await fetch(`/api/autonomous-evolution/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchExperiences();
    fetchStats();
  };

  const fetchRunLogs = async (p = runLogsPage) => {
    setRunLogsLoading(true);
    const res = await fetch(`/api/autonomous-evolution/run-logs?page=${p}&pageSize=20`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setRunLogs(data.data || []);
      setRunLogsTotalPages(data.pagination?.totalPages || 1);
    }
    setRunLogsLoading(false);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchExperiences();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
            <Brain size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">执行进化管理</h1>
            <p className="text-sm text-gray-400 mt-0.5">提取失败→成功经验，注入 System Prompt</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Injection on/off toggle */}
          <button
            onClick={toggleInjection}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              injectionEnabled
                ? 'bg-emerald-900/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-900/30'
                : 'bg-gray-800 text-gray-400 border-gray-600/50 hover:bg-gray-700'
            }`}
            title="控制提取时新经验是否默认启用"
          >
            <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${injectionEnabled ? 'bg-emerald-500' : 'bg-gray-600'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${injectionEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </span>
            自动启用
          </button>
          <button
            onClick={() => { setShowIdleConfig(true); fetchIdleConfig(); }}
            className="p-2 text-gray-500 hover:text-gray-300 hover:bg-dark-surface-hover rounded-lg"
            title="自动触发配置"
          >
            <Settings size={18} />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="flex items-center gap-1 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-400 text-sm font-medium shadow-lg shadow-primary-500/25"
            >
              <Play size={14} />
              立即提取
              <ChevronDown size={14} />
            </button>
            {showDropdown && (
              <div className="absolute right-0 mt-1 w-44 bg-dark-surface border border-gray-700/50 rounded-lg shadow-lg z-10">
                <button
                  onClick={() => handleExtract('incremental')}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-dark-bg"
                >
                  增量提取（推荐）
                </button>
                <button
                  onClick={() => handleExtract('full')}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-dark-bg text-orange-600"
                >
                  全量重新提取
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: '经验总量', value: stats.total },
            { label: '已启用', value: stats.injected },
            { label: '本周新增', value: stats.weekNew },
            { label: '总引用次数', value: stats.totalUsage },
          ].map(card => (
            <div key={card.label} className="bg-dark-surface rounded-lg border border-gray-700/50 p-4">
              <p className="text-sm text-gray-500">{card.label}</p>
              <p className="text-2xl font-bold text-gray-100 mt-1">{card.value}</p>
            </div>
          ))}
        </div>
      )}
      {stats?.lastAutoExtract && (
        <p className="text-xs text-gray-400">
          上次自动提取: {new Date(stats.lastAutoExtract).toLocaleString('zh-CN')}
        </p>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-700/50">
        <button
          onClick={() => setActiveTab('experiences')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'experiences'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          经验库
        </button>
        <button
          onClick={() => { setActiveTab('runlogs'); fetchRunLogs(1); setRunLogsPage(1); }}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'runlogs'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          运行历史
        </button>
      </div>

      {/* Extract Panel */}
      {showExtractPanel && (
        <div className="bg-gray-900 rounded-lg p-4 text-sm text-gray-100">
          <div className="flex items-center justify-between mb-3">
            <span className="font-medium">
              {extracting ? '正在提取经验...' : '提取完成'}
            </span>
            <div className="flex items-center gap-2">
              {extracting && <RefreshCw size={14} className="animate-spin" />}
              <button onClick={() => setShowExtractPanel(false)} className="text-gray-400 hover:text-white">
                <X size={16} />
              </button>
            </div>
          </div>
          {extractProgress && (
            <div className="mb-2 text-xs text-gray-400">
              已扫描: {extractProgress.scanned}/{extractProgress.total} |
              跳过: {extractProgress.skipped} |
              新增文件: {extractProgress.newFiles} |
              发现序列: {extractProgress.sequences}
              {extractProgress.type === 'done' && ` | 新增: ${extractProgress.created} 合并: ${extractProgress.merged}`}
            </div>
          )}
          <div className="max-h-48 overflow-y-auto space-y-0.5 font-mono text-xs">
            {extractLogs.map((log, i) => (
              <div key={i} className="text-gray-300">{log}</div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}

      {/* Experiences Tab */}
      {activeTab === 'experiences' && (
        <>
        {/* 搜索和筛选 */}
        <div className="bg-dark-surface border border-gray-700/50 rounded-xl px-5 py-4">
          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            {/* 搜索框 */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="搜索经验..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-3 py-2.5 bg-dark-bg border border-gray-700/50 rounded-lg focus:ring-2 focus:ring-primary-500 text-gray-100 placeholder-gray-500 text-sm"
              />
            </div>
            
            {/* 筛选控件 */}
            <div className="flex items-center gap-3">
              <select
                value={filterCategory}
                onChange={e => { setFilterCategory(e.target.value); setPage(1); }}
                className="w-[140px] px-3 py-2.5 bg-dark-bg border border-gray-700/50 rounded-lg text-gray-100 text-sm focus:ring-2 focus:ring-primary-500"
              >
                <option value="">所有错误类型</option>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <select
                value={filterInjected}
                onChange={e => { setFilterInjected(e.target.value); setPage(1); }}
                className="w-[120px] px-3 py-2.5 bg-dark-bg border border-gray-700/50 rounded-lg text-gray-100 text-sm focus:ring-2 focus:ring-primary-500"
              >
                <option value="">所有状态</option>
                <option value="true">已注入</option>
                <option value="false">未注入</option>
              </select>
              <button type="submit" className="px-4 py-2.5 bg-primary-500 text-white rounded-lg font-medium text-sm shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 hover:bg-primary-400 transition-all">
                搜索
              </button>
            </div>
          </form>
        </div>

        <div className="space-y-3">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : experiences.length === 0 ? (
          <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-12 text-center">
            <Brain className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-3 text-gray-500">暂无经验数据，点击「立即提取」开始分析评估日志</p>
          </div>
        ) : (
          <>
          {/* 批量操作栏 */}
          {experiences.length > 0 && (
            <div className="flex items-center gap-3 px-1 py-2">
              <input
                type="checkbox"
                checked={selectedIds.size === experiences.length && experiences.length > 0}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded"
              />
              <span className="text-xs text-gray-500">
                {selectedIds.size > 0 ? `已选 ${selectedIds.size} 条` : '全选'}
              </span>
              {selectedIds.size > 0 && (
                <>
                  <button
                    onClick={() => handleBatchInject('enable')}
                    className="px-3 py-1 text-xs bg-green-900/20 text-green-400 border border-green-500/20 rounded hover:bg-green-900/30"
                  >
                    批量启用
                  </button>
                  <button
                    onClick={() => handleBatchInject('disable')}
                    className="px-3 py-1 text-xs bg-dark-bg text-gray-400 border border-gray-700/50 rounded hover:bg-dark-surface-hover"
                  >
                    批量停用
                  </button>
                </>
              )}
            </div>
          )}
          {experiences.map(exp => {
            let patterns: string[] = [];
            try { patterns = JSON.parse(exp.errorPatterns); } catch { /* ignore */ }
            return (
              <div
                key={exp.id}
                className={`bg-dark-surface rounded-lg border p-4 hover:border-gray-600 transition-colors ${selectedIds.has(exp.id) ? 'border-blue-300 bg-blue-900/20/30' : 'border-gray-700/50'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(exp.id)}
                      onChange={() => toggleSelect(exp.id)}
                      className="mt-1 w-4 h-4 rounded flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {exp.isInjected ? (
                          <span className="flex items-center gap-1 text-xs text-green-700 font-medium">
                            <CheckCircle size={12} /> 已启用
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-gray-400">
                            <Circle size={12} /> 未启用
                          </span>
                        )}
                        <span className="px-2 py-0.5 text-xs bg-dark-surface-hover text-gray-400 rounded">
                          {CATEGORY_LABELS[exp.errorCategory] || exp.errorCategory}
                        </span>
                      </div>
                      <h3
                        className="mt-1.5 font-semibold text-gray-100 cursor-pointer hover:text-blue-600"
                        onClick={() => router.push(`/dashboard/admin/autonomous-evolution/${exp.id}`)}
                      >
                        {exp.title}
                      </h3>
                      {patterns.length > 0 && (
                        <p className="mt-1 text-xs text-gray-500 truncate">
                          触发: {patterns.slice(0, 3).join(' / ')}
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-4 text-xs text-gray-400">
                        <span>出现 {exp.hitCount} 次</span>
                        <span>来源: {exp.sourceModel || '未知'}</span>
                        <span>{new Date(exp.createdAt).toLocaleDateString('zh-CN')}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!exp.isInjected && (
                      <button
                        onClick={() => handleToggleInject(exp.id)}
                        className="px-2 py-1 text-xs bg-green-900/20 text-green-400 border border-green-500/20 rounded hover:bg-green-900/30"
                      >
                        启用
                      </button>
                    )}
                    {exp.isInjected && (
                      <button
                        onClick={() => handleToggleInject(exp.id)}
                        className="px-2 py-1 text-xs bg-dark-bg text-gray-400 border border-gray-700/50 rounded hover:bg-dark-surface-hover"
                      >
                        停用
                      </button>
                    )}
                    <button
                      onClick={() => router.push(`/dashboard/admin/autonomous-evolution/${exp.id}`)}
                      className="px-2 py-1 text-xs bg-blue-900/20 text-blue-400 border border-blue-500/20 rounded hover:bg-blue-900/30"
                    >
                      详情
                    </button>
                    <button
                      onClick={() => handleDelete(exp.id, exp.title)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-900/20 rounded"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          </>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
            className="px-3 py-1 text-sm border border-gray-600 rounded disabled:opacity-40 hover:bg-dark-bg"
          >
            上一页
          </button>
          <span className="px-3 py-1 text-sm text-gray-400">{page} / {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
            className="px-3 py-1 text-sm border border-gray-600 rounded disabled:opacity-40 hover:bg-dark-bg"
          >
            下一页
          </button>
        </div>
      )}
      </>
      )}

      {/* Run Logs Tab */}
      {activeTab === 'runlogs' && (
        <div className="space-y-3">
          {runLogsLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            </div>
          ) : runLogs.length === 0 ? (
            <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-12 text-center">
              <p className="text-gray-500">暂无运行记录</p>
            </div>
          ) : (
            runLogs.map(log => (
              <div key={log.id} className="bg-dark-surface rounded-lg border border-gray-700/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 text-xs rounded font-medium ${
                      log.status === 'done' ? 'bg-green-100 text-green-700' :
                      log.status === 'error' ? 'bg-red-100 text-red-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {log.status === 'done' ? '完成' : log.status === 'error' ? '失败' : '运行中'}
                    </span>
                    <span className="px-2 py-0.5 text-xs bg-dark-surface-hover text-gray-400 rounded">
                      {log.mode === 'full' ? '全量' : log.mode === 'auto' ? '自动' : '增量'}
                    </span>
                    <span className="px-2 py-0.5 text-xs bg-purple-900/20 text-purple-600 rounded">
                      {log.trigger === 'auto' ? '自动触发' : '手动触发'}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">
                    {new Date(log.startedAt).toLocaleString('zh-CN')}
                  </span>
                </div>
                {log.status !== 'error' ? (
                  <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                    <span>扫描 {log.scanned} 文件</span>
                    <span>跳过 {log.skipped}</span>
                    <span>新文件 {log.newFiles}</span>
                    <span>序列 {log.sequences}</span>
                    <span className="text-green-600 font-medium">新增 {log.created}</span>
                    <span className="text-blue-600 font-medium">合并 {log.merged}</span>
                    {log.finishedAt && (
                      <span>耗时 {Math.round((new Date(log.finishedAt).getTime() - new Date(log.startedAt).getTime()) / 1000)}s</span>
                    )}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-red-600">{log.errorMessage}</p>
                )}
              </div>
            ))
          )}
          {runLogsTotalPages > 1 && (
            <div className="flex justify-center gap-2">
              <button
                disabled={runLogsPage <= 1}
                onClick={() => { const p = runLogsPage - 1; setRunLogsPage(p); fetchRunLogs(p); }}
                className="px-3 py-1 text-sm border border-gray-600 rounded disabled:opacity-40 hover:bg-dark-bg"
              >上一页</button>
              <span className="px-3 py-1 text-sm text-gray-400">{runLogsPage} / {runLogsTotalPages}</span>
              <button
                disabled={runLogsPage >= runLogsTotalPages}
                onClick={() => { const p = runLogsPage + 1; setRunLogsPage(p); fetchRunLogs(p); }}
                className="px-3 py-1 text-sm border border-gray-600 rounded disabled:opacity-40 hover:bg-dark-bg"
              >下一页</button>
            </div>
          )}
        </div>
      )}

      {/* Idle Config Modal */}
      {showIdleConfig && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-dark-surface rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-100">自动触发配置</h3>
              <button onClick={() => setShowIdleConfig(false)} className="text-gray-400 hover:text-gray-400">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={idleConfig.enabled}
                  onChange={e => setIdleConfig(c => ({ ...c, enabled: e.target.checked }))}
                  className="w-4 h-4"
                />
                <span className="text-sm text-gray-300">启用自动提取</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">开始时间</label>
                  <input
                    type="time"
                    value={idleConfig.windowStart}
                    onChange={e => setIdleConfig(c => ({ ...c, windowStart: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-600 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">结束时间</label>
                  <input
                    type="time"
                    value={idleConfig.windowEnd}
                    onChange={e => setIdleConfig(c => ({ ...c, windowEnd: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-600 rounded-lg text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">轮询间隔（分钟）</label>
                <input
                  type="number"
                  min={5}
                  value={idleConfig.pollIntervalMinutes}
                  onChange={e => setIdleConfig(c => ({ ...c, pollIntervalMinutes: Number(e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-600 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">每次最多处理序列数</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={idleConfig.maxSequencesPerRun}
                  onChange={e => setIdleConfig(c => ({ ...c, maxSequencesPerRun: Number(e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-600 rounded-lg text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowIdleConfig(false)} className="px-4 py-2 text-sm text-gray-400 hover:bg-dark-surface-hover rounded-lg">
                取消
              </button>
              <button onClick={saveIdleConfig} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}