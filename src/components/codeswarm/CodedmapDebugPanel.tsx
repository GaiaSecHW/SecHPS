'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, Database, Trash2, RefreshCw, Loader2, ChevronDown, ChevronRight,
  CheckCircle, XCircle, HardDrive, FileCode, FolderOpen, Settings, Terminal,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ====== Types ======

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

// ====== Helpers ======

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const DEFAULT_CODEDMAP_HOME = process.env.NEXT_PUBLIC_CODEDMAP_HOME || '';
const DEFAULT_JOERN_HOME = process.env.NEXT_PUBLIC_JOERN_HOME || '';

export function CodedmapDebugPanel() {
  // ====== Build form ======
  const [targetDir, setTargetDir] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [codedmapHome, setCodedmapHome] = useState(DEFAULT_CODEDMAP_HOME);
  const [joernHome, setJoernHome] = useState(DEFAULT_JOERN_HOME);
  const [projectName, setProjectName] = useState('');

  // ====== Build execution ======
  const [isBuilding, setIsBuilding] = useState(false);
  const [logs, setLogs] = useState<{ type: 'stdout' | 'stderr' | 'info' | 'error' | 'exit'; text: string }[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // ====== Settings ======
  const [showSettings, setShowSettings] = useState(false);

  // ====== Cache ======
  const [cacheEntries, setCacheEntries] = useState<CacheEntry[]>([]);
  const [loadingCache, setLoadingCache] = useState(false);
  const [expandedCache, setExpandedCache] = useState<string | null>(null);

  useEffect(() => {
    fetchCache();
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // ====== Cache actions ======

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

  const handleDeleteCache = async (product: string) => {
    if (!confirm(`确定删除 ${product} 的所有缓存文件？`)) return;
    try {
      const res = await fetch(`/api/codeswarm/codedmap/cache?targetProduct=${encodeURIComponent(product)}`, { method: 'DELETE' });
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

  // ====== Build action ======

  const handleBuild = useCallback(async () => {
    if (!targetDir.trim()) {
      toast.error('请输入目标源码目录');
      return;
    }
    if (!codedmapHome.trim()) {
      toast.error('请配置 CodeDMap 安装路径');
      return;
    }

    setIsBuilding(true);
    setLogs([]);
    setExitCode(null);
    setShowLogs(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/codeswarm/codedmap/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetDir,
          workspace: workspace || undefined,
          joernHome: joernHome || undefined,
          codedmapHome: codedmapHome || undefined,
          projectName: projectName || undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json();
        setLogs(prev => [...prev, { type: 'error', text: data.error || '构建请求失败' }]);
        setIsBuilding(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setLogs(prev => [...prev, { type: 'error', text: '无法读取响应流' }]);
        setIsBuilding(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const text = JSON.parse(line.slice(6));
              if (currentEvent === 'exit') {
                const { code } = JSON.parse(text);
                setExitCode(code);
                setIsBuilding(false);
                if (code === 0) {
                  toast.success('构建完成');
                  fetchCache();
                } else {
                  toast.error(`构建失败 (exit code: ${code})`);
                }
              } else {
                const type = currentEvent as 'stdout' | 'stderr' | 'info' | 'error';
                setLogs(prev => [...prev, { type, text }]);
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setLogs(prev => [...prev, { type: 'error', text: `请求失败: ${(err as Error).message}` }]);
      }
      setIsBuilding(false);
    }
  }, [targetDir, workspace, codedmapHome, joernHome, projectName]);

  const handleStop = () => {
    abortRef.current?.abort();
    setIsBuilding(false);
    setLogs(prev => [...prev, { type: 'info', text: '用户中断构建' }]);
  };

  // ====== Render ======

  return (
    <div className="space-y-6">
      {/* ====== Build Form ====== */}
      <div className="bg-dark-surface rounded-lg border border-gray-700/50">
        <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/20 rounded-lg">
              <Database className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-100">Codedmap 构建</h2>
              <p className="text-sm text-gray-400">执行 build_map.py 生成 CPG 知识图谱 (graph.db)</p>
            </div>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2 rounded-lg transition-colors ${showSettings ? 'bg-purple-500/20 text-purple-400' : 'text-gray-400 hover:text-gray-200'}`}
            title="路径配置"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Target directory */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              <FolderOpen className="w-4 h-4 inline mr-1" />
              目标源码目录 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={targetDir}
              onChange={(e) => setTargetDir(e.target.value)}
              placeholder="D:\work\nazhua-agent-opencode-0420\codedmap"
              className="w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-200 placeholder-gray-500 font-mono text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">要分析的源代码根目录</p>
          </div>

          {/* Workspace output */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              输出目录 (workspace)
            </label>
            <input
              type="text"
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              placeholder="D:\custom\workspace（留空则使用默认 {targetDir}/workspace）"
              className="w-full px-3 py-2 bg-dark-bg border border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-gray-200 placeholder-gray-500 font-mono text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">graph.db 和分析文件的输出目录</p>
          </div>

          {/* Settings panel */}
          {showSettings && (
            <div className="bg-[#0a1020] rounded-lg p-4 space-y-4 border border-gray-700/50">
              <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                <Settings className="w-4 h-4" />
                路径配置
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">CODEDMAP_HOME</label>
                  <input
                    type="text"
                    value={codedmapHome}
                    onChange={(e) => setCodedmapHome(e.target.value)}
                    placeholder="D:\work\codedmap（codedmap 安装目录）"
                    className="w-full px-3 py-2 bg-dark-bg border border-gray-700 rounded-lg text-gray-200 placeholder-gray-600 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">JOERN_HOME</label>
                  <input
                    type="text"
                    value={joernHome}
                    onChange={(e) => setJoernHome(e.target.value)}
                    placeholder="D:\work\tools\joern\joern-cli"
                    className="w-full px-3 py-2 bg-dark-bg border border-gray-700 rounded-lg text-gray-200 placeholder-gray-600 font-mono text-xs"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">项目名称 (--name，可选)</label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="覆盖自动推断的项目名"
                  className="w-full px-3 py-2 bg-dark-bg border border-gray-700 rounded-lg text-gray-200 placeholder-gray-600 font-mono text-xs"
                />
              </div>
            </div>
          )}

          {/* Build command preview */}
          <div className="bg-[#0a1020] rounded-lg p-3 border border-gray-700/50">
            <p className="text-xs text-gray-500 mb-1">执行命令:</p>
            <code className="text-xs text-cyan-400 font-mono break-all">
              {typeof window !== 'undefined' && navigator.platform.includes('Win') ? 'py -3' : 'python3'}
              {' '}{codedmapHome ? `${codedmapHome}/tools/build_map.py` : 'build_map.py'}
              {' '}{targetDir || '<targetDir>'}
              {joernHome && ` --joern-home ${joernHome}`}
              {workspace && ` --workspace ${workspace}`}
              {projectName && ` --name ${projectName}`}
            </code>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            {!isBuilding ? (
              <button
                onClick={handleBuild}
                disabled={!targetDir.trim()}
                className="flex items-center gap-2 px-6 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="w-4 h-4" />
                <span>执行构建</span>
              </button>
            ) : (
              <button
                onClick={handleStop}
                className="flex items-center gap-2 px-6 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>构建中... (点击中断)</span>
              </button>
            )}

            {exitCode !== null && (
              <span className={`flex items-center gap-1 text-sm ${exitCode === 0 ? 'text-green-400' : 'text-red-400'}`}>
                {exitCode === 0 ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                exit code: {exitCode}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ====== Real-time Logs ====== */}
      {showLogs && (
        <div className="bg-dark-surface rounded-lg border border-gray-700/50">
          <div className="px-6 py-3 flex items-center justify-between border-b border-gray-700/50 bg-dark-surface-alt rounded-t-lg">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-green-400" />
              <span className="text-sm font-medium text-gray-100">构建日志</span>
              {isBuilding && <Loader2 className="w-3 h-3 animate-spin text-purple-400" />}
            </div>
            <button
              onClick={() => { setShowLogs(false); setLogs([]); setExitCode(null); }}
              className="text-gray-400 hover:text-red-400"
              title="关闭日志"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <div className="h-80 overflow-y-auto bg-dark-bg p-4 font-mono text-xs">
            {logs.length === 0 && !isBuilding ? (
              <div className="text-gray-500">点击"执行构建"开始...</div>
            ) : (
              logs.map((log, idx) => {
                let color = 'text-gray-300';
                if (log.type === 'stderr') color = 'text-yellow-400';
                else if (log.type === 'error') color = 'text-red-400';
                else if (log.type === 'info') color = 'text-cyan-400';
                else if (log.type === 'stdout' && log.text.startsWith('[+]')) color = 'text-green-400';
                else if (log.type === 'stdout' && log.text.startsWith('[*]')) color = 'text-blue-400';
                else if (log.type === 'stdout' && log.text.startsWith('[-]')) color = 'text-red-400';
                else if (log.type === 'stdout' && log.text.startsWith('$')) color = 'text-cyan-300';

                return (
                  <div key={idx} className={`${color} whitespace-pre-wrap break-all`}>
                    {log.text}
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
            title="刷新"
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
              <p className="text-xs text-gray-600 mt-1">构建完成后可手动上传到 MinIO</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cacheEntries.map((entry) => (
                <div key={entry.targetProduct} className="border border-gray-700/50 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-dark-bg">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <button
                        onClick={() => setExpandedCache(expandedCache === entry.targetProduct ? null : entry.targetProduct)}
                        className="text-gray-400 hover:text-gray-200"
                      >
                        {expandedCache === entry.targetProduct ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
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
