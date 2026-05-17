'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Play, Database, Trash2, RefreshCw, Loader2, ChevronDown, ChevronRight,
  FolderOpen, Server, CheckCircle, XCircle, HardDrive, FileCode, AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ====== Cache types ======

interface CacheFile {
  name: string;
  size: number;
  lastModified: string;
}

interface CacheEntry {
  targetProduct: string;
  files: CacheFile[];
  totalSize: number;
  fileCount: number;
}

// ====== Log entry types ======

interface LogEntry {
  type: string;
  message: string;
  details: string;
  timestamp: string;
  phase?: string;
  level?: string;
}

// ====== Worker/Model option types ======

interface WorkerOption {
  nodeId: string;
  address: string;
  status: string;
}

interface ModelOption {
  key: string;
  modelId: string;
  modelName: string;
  label: string;
  hasApiKey: boolean;
  apiKey?: string;
}

// ====== Helpers ======

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function CodedmapDebugPanel() {
  // ====== Build form state ======
  const [targetProduct, setTargetProduct] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [selectedWorker, setSelectedWorker] = useState('');
  const [selectedModelKey, setSelectedModelKey] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [engine, setEngine] = useState<'opencode' | 'claudecode'>('opencode');

  // ====== Build execution state ======
  const [isBuilding, setIsBuilding] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  // ====== Cache state ======
  const [cacheEntries, setCacheEntries] = useState<CacheEntry[]>([]);
  const [loadingCache, setLoadingCache] = useState(false);
  const [expandedCache, setExpandedCache] = useState<string | null>(null);

  // ====== Options ======
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);

  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchWorkers();
    fetchModels();
    fetchCache();
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // ====== SSE connection for build logs ======
  useEffect(() => {
    if (!currentTaskId) return;

    const eventSource = new EventSource(`/api/codeswarm/tasks/${currentTaskId}/stream`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'connected') return;

        if (data.type === 'task_complete') {
          const isCompleted = data.state === 'completed';
          setLogs(prev => [...prev, {
            type: 'task_complete',
            message: isCompleted ? '构建完成' : '构建失败',
            details: data.result || data.error || '',
            timestamp: new Date().toISOString(),
          }]);
          setIsBuilding(false);
          if (isCompleted) {
            toast.success('Codedmap 构建完成');
            fetchCache();
          } else {
            toast.error('Codedmap 构建失败');
          }
          setTimeout(() => eventSource.close(), 1000);
          return;
        }

        if (data.data) {
          const eventData = data.data;
          let message = '';
          let details = '';
          const phase = eventData.phase;
          const level = eventData.level;

          if (data.type === 'log_chunk' || data.type === 'agent_log_chunk') {
            message = level === 'worker' ? '[Worker]' : '[Agent]';
            details = eventData.content || '';
          } else if (data.type === 'phase_start') {
            message = '阶段开始';
            details = eventData.message || phase || '';
          } else if (data.type === 'phase_complete') {
            message = eventData.success ? '阶段完成' : '阶段失败';
            details = eventData.message || phase || '';
          } else if (data.type === 'error') {
            message = '错误';
            details = eventData.message || '';
          } else {
            message = data.type;
            details = eventData.content || eventData.message || JSON.stringify(eventData);
          }

          setLogs(prev => [...prev, {
            type: data.type,
            message,
            details,
            timestamp: data.timestamp || new Date().toISOString(),
            phase,
            level,
          }]);
        }
      } catch {
        // ignore parse errors
      }
    };

    eventSource.onerror = () => eventSource.close();
    return () => eventSource.close();
  }, [currentTaskId]);

  // ====== Data fetching ======

  const fetchCache = async () => {
    setLoadingCache(true);
    try {
      const res = await fetch('/api/codeswarm/codedmap/cache');
      if (res.ok) {
        const data = await res.json();
        setCacheEntries(data.entries || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingCache(false);
    }
  };

  const fetchWorkers = async () => {
    try {
      const res = await fetch('/api/codeswarm/nodes');
      if (res.ok) {
        const data = await res.json();
        setWorkers(data.workers || []);
      }
    } catch {
      // ignore
    }
  };

  const fetchModels = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/models?isActive=true&forEvaluation=true', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const options: ModelOption[] = [];
        for (const cfg of data.models || []) {
          for (const modelName of cfg.models || []) {
            options.push({
              key: `${cfg.id}::${modelName}`,
              modelId: cfg.id,
              modelName,
              label: `${cfg.name} - ${modelName}`,
              hasApiKey: cfg.hasApiKey,
              apiKey: cfg.apiKey,
            });
          }
        }
        setModelOptions(options);
        if (options.length > 0) {
          setSelectedModelKey(options[0].key);
          if (options[0].hasApiKey && options[0].apiKey) {
            setApiKey(options[0].apiKey || '');
          }
        }
      }
    } catch {
      // ignore
    }
  };

  // ====== Actions ======

  const handleBuild = async () => {
    if (!targetProduct.trim()) {
      toast.error('请输入目标产品名');
      return;
    }
    if (!workspacePath.trim()) {
      toast.error('请输入工作区路径');
      return;
    }

    setIsBuilding(true);
    setLogs([]);
    setShowLogs(true);

    const selectedModel = modelOptions.find(o => o.key === selectedModelKey);

    try {
      const res = await fetch('/api/codeswarm/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction: `Codedmap 知识图谱构建: ${targetProduct}`,
          engine,
          agent: 'build',
          workspacePath,
          targetProduct,
          model: selectedModel?.modelName || undefined,
          apiKey: apiKey || undefined,
          timeoutSec: 3600,
          preferredWorkerNodeId: selectedWorker || undefined,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setCurrentTaskId(data.taskId);
        toast.success(data.dispatched ? '构建任务已分发到 Worker' : '任务已加入队列，等待 Worker');
      } else {
        toast.error(data.error || '创建任务失败');
        setIsBuilding(false);
      }
    } catch {
      toast.error('创建构建任务失败');
      setIsBuilding(false);
    }
  };

  const handleDeleteCache = async (product: string) => {
    if (!confirm(`确定删除 ${product} 的所有缓存文件？`)) return;

    try {
      const res = await fetch(`/api/codeswarm/codedmap/cache?targetProduct=${encodeURIComponent(product)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`已删除 ${data.deleted} 个文件`);
        fetchCache();
      } else {
        toast.error(data.error || '删除失败');
      }
    } catch {
      toast.error('删除缓存失败');
    }
  };

  // ====== Render ======

  return (
    <div className="space-y-6">
      {/* ====== Build Form ====== */}
      <div className="bg-dark-surface rounded-lg border border-gray-700/50">
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center gap-3">
          <div className="p-2 bg-purple-500/20 rounded-lg">
            <Database className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-100">Codedmap 构建</h2>
            <p className="text-sm text-gray-400">触发 Worker 构建 CPG 知识图谱 (graph.db)</p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {/* Required fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                目标产品 <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={targetProduct}
                onChange={(e) => setTargetProduct(e.target.value)}
                placeholder="如 my-project-v2"
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-200 placeholder-gray-500"
              />
              <p className="text-xs text-gray-500 mt-1">用于 MinIO 缓存 key，如已缓存则直接下载</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                工作区路径 <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={workspacePath}
                onChange={(e) => setWorkspacePath(e.target.value)}
                placeholder="/shared/workspace/task-xxx"
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-200 placeholder-gray-500"
              />
              <p className="text-xs text-gray-500 mt-1">NFS 共享目录，包含源代码</p>
            </div>
          </div>

          {/* Optional fields */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Worker 节点</label>
              <select
                value={selectedWorker}
                onChange={(e) => setSelectedWorker(e.target.value)}
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 rounded-lg text-gray-200"
              >
                <option value="">自动分配</option>
                {workers.map((w) => (
                  <option key={w.nodeId} value={w.nodeId}>
                    {w.nodeId} - {w.status}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">模型</label>
              <select
                value={selectedModelKey}
                onChange={(e) => {
                  setSelectedModelKey(e.target.value);
                  const opt = modelOptions.find(o => o.key === e.target.value);
                  if (opt?.hasApiKey && opt.apiKey) setApiKey(opt.apiKey);
                }}
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 rounded-lg text-gray-200"
              >
                <option value="">默认模型</option>
                {modelOptions.map((opt) => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">引擎</label>
              <select
                value={engine}
                onChange={(e) => setEngine(e.target.value as 'opencode' | 'claudecode')}
                className="w-full px-3 py-2 bg-[#0F172A] border border-gray-600 rounded-lg text-gray-200"
              >
                <option value="opencode">OpenCode</option>
                <option value="claudecode">Claude Code</option>
              </select>
            </div>
          </div>

          {/* Build button */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleBuild}
              disabled={isBuilding || !targetProduct.trim() || !workspacePath.trim()}
              className="flex items-center gap-2 px-6 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isBuilding ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>构建中...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  <span>触发构建</span>
                </>
              )}
            </button>

            {currentTaskId && (
              <span className="text-xs text-gray-500 font-mono">taskId: {currentTaskId}</span>
            )}
          </div>
        </div>
      </div>

      {/* ====== Real-time Logs ====== */}
      {showLogs && (
        <div className="bg-dark-surface rounded-lg border border-gray-700/50">
          <div className="px-6 py-3 flex items-center justify-between border-b border-gray-700/50 bg-[#162032] rounded-t-lg">
            <div className="flex items-center gap-2">
              <FileCode className="w-4 h-4 text-green-400" />
              <span className="text-sm font-medium text-gray-100">构建日志</span>
              {currentTaskId && <span className="text-xs text-gray-500">({currentTaskId})</span>}
            </div>
            <button
              onClick={() => { setShowLogs(false); setLogs([]); setCurrentTaskId(null); }}
              className="text-gray-400 hover:text-red-400"
              title="关闭日志"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <div className="h-64 overflow-y-auto bg-[#0F172A] p-4 font-mono text-xs">
            {logs.length === 0 ? (
              <div className="text-gray-500">等待 Worker 接收任务...</div>
            ) : (
              logs.map((log, idx) => {
                let color = 'text-gray-300';
                if (log.type === 'error') color = 'text-red-400';
                else if (log.type === 'task_complete') color = log.message.includes('完成') ? 'text-green-400' : 'text-red-400';
                else if (log.type === 'phase_complete') color = 'text-green-400';
                else if (log.type === 'phase_start') color = 'text-blue-400';
                else if (log.level === 'worker') color = 'text-cyan-300';
                else if (log.details?.startsWith('[Codedmap]')) color = 'text-purple-300';

                return (
                  <div key={idx} className={`mb-1 ${color}`}>
                    <span className="text-gray-600">[{new Date(log.timestamp).toLocaleTimeString()}]</span>{' '}
                    {log.phase && <span className="text-gray-500">[{log.phase}]</span>}{' '}
                    <span>{log.message}</span>
                    {log.details && <span className="text-gray-400 ml-2">{log.details}</span>}
                  </div>
                );
              })
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}

      {/* ====== MinIO Cache Management ====== */}
      <div className="bg-dark-surface rounded-lg border border-gray-700/50">
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-500/20 rounded-lg">
              <HardDrive className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-100">MinIO 缓存</h2>
              <p className="text-sm text-gray-400">已缓存的知识图谱文件</p>
            </div>
          </div>
          <button
            onClick={fetchCache}
            disabled={loadingCache}
            className="p-2 text-gray-400 hover:text-cyan-400 rounded-lg hover:bg-cyan-500/10 transition-colors"
            title="刷新缓存列表"
          >
            <RefreshCw className={`w-4 h-4 ${loadingCache ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="p-4">
          {loadingCache && cacheEntries.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : cacheEntries.length === 0 ? (
            <div className="text-center py-12">
              <Database className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500">暂无缓存文件</p>
              <p className="text-xs text-gray-600 mt-1">触发构建后，生成的 graph.db 会被上传到 MinIO</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cacheEntries.map((entry) => (
                <div key={entry.targetProduct} className="border border-gray-700/50 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-[#0F172A]">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <button
                        onClick={() => setExpandedCache(expandedCache === entry.targetProduct ? null : entry.targetProduct)}
                        className="text-gray-400 hover:text-gray-200"
                      >
                        {expandedCache === entry.targetProduct ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>
                      <Database className="w-4 h-4 text-purple-400 shrink-0" />
                      <span className="text-sm font-medium text-gray-200 truncate">{entry.targetProduct}</span>
                      <span className="text-xs text-gray-500 shrink-0">{entry.fileCount} 文件</span>
                      <span className="text-xs text-cyan-400 shrink-0">{formatSize(entry.totalSize)}</span>
                    </div>
                    <button
                      onClick={() => handleDeleteCache(entry.targetProduct)}
                      className="p-1.5 text-gray-500 hover:text-red-400 rounded hover:bg-red-500/10 transition-colors"
                      title="删除缓存"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {expandedCache === entry.targetProduct && (
                    <div className="px-4 py-2 bg-[#0a1020] border-t border-gray-700/50">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500">
                            <th className="text-left py-1 font-normal">文件</th>
                            <th className="text-right py-1 font-normal w-24">大小</th>
                            <th className="text-right py-1 font-normal w-40">修改时间</th>
                          </tr>
                        </thead>
                        <tbody>
                          {entry.files.map((file) => (
                            <tr key={file.name} className="text-gray-300 border-t border-gray-800">
                              <td className="py-1.5 font-mono">{file.name}</td>
                              <td className="py-1.5 text-right text-cyan-400">{formatSize(file.size)}</td>
                              <td className="py-1.5 text-right text-gray-500">
                                {new Date(file.lastModified).toLocaleString('zh-CN')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
