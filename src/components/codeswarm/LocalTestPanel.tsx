'use client';

import { useState, useEffect, useRef } from 'react';
import { Play, Loader2, CheckCircle, XCircle, Clock, Copy, RefreshCw, ChevronDown, ChevronRight, FolderSearch, HardDrive, AlertTriangle, FileText, Shield, Zap, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { safeClipboardWrite } from '@/lib/clipboard';
import { AnsiText } from '@/components/ui/AnsiText';

interface TestRecord {
  taskId: string;
  workspace: string;
  instruction: string;
  status: string;
  result?: string | null;
  error?: string | null;
  parsedVulnerabilities?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  createdAt?: string;
  uploadedFilePath?: string | null;
}

interface ParseLog {
  timestamp: string;
  level: 'info' | 'success' | 'error' | 'warn';
  message: string;
}

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

const COMMON_WORKSPACES = [
  { path: 'E:\\work\\202605\\claude-web-platform', name: 'claude-web-platform' },
];

function parseLogsFromResult(result: string): ParseLog[] {
  return result.split('\n').filter(l => l.trim()).map(line => {
    const timeMatch = line.match(/^\[(\d{2}:\d{2}:\d{2})\]/);
    const levelMatch = line.match(/\[(INFO|SUCCESS|ERROR|WARN)\]/);
    const timestamp = timeMatch?.[1] || new Date().toISOString().substring(11, 19);
    const level = levelMatch?.[1]?.toLowerCase() === 'success' ? 'success'
      : levelMatch?.[1]?.toLowerCase() === 'error' ? 'error'
      : levelMatch?.[1]?.toLowerCase() === 'warn' ? 'warn'
      : 'info';
    const message = line.replace(/^\[.*?\]\s*\[.*?\]\s*/, '').trim();
    return { timestamp, level, message };
  });
}

function TimelineStep({ label, status, detail, icon }: {
  label: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
  detail?: string;
  icon: React.ReactNode;
}) {
  const colors = {
    pending: 'border-gray-600 bg-gray-800/50',
    running: 'border-blue-500 bg-blue-500/10',
    done: 'border-green-500 bg-green-500/10',
    error: 'border-red-500 bg-red-500/10',
    skipped: 'border-gray-600 bg-gray-800/30 opacity-50',
  };
  const iconColors = {
    pending: 'text-gray-500',
    running: 'text-blue-400 animate-pulse',
    done: 'text-green-400',
    error: 'text-red-400',
    skipped: 'text-gray-600',
  };

  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border ${colors[status]}`}>
      <div className={`mt-0.5 ${iconColors[status]}`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${status === 'pending' ? 'text-gray-500' : status === 'skipped' ? 'text-gray-600' : 'text-gray-200'}`}>
            {label}
          </span>
          {status === 'running' && <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />}
          {status === 'done' && <CheckCircle className="w-3.5 h-3.5 text-green-400" />}
          {status === 'error' && <XCircle className="w-3.5 h-3.5 text-red-400" />}
        </div>
        {detail && <p className="text-xs text-gray-400 mt-0.5 truncate">{detail}</p>}
      </div>
    </div>
  );
}

export function LocalTestPanel() {
  const [workspacePath, setWorkspacePath] = useState('');
  const [timeoutSec, setTimeoutSec] = useState(600);
  const [engine, setEngine] = useState<'opencode' | 'claudecode'>('opencode');
  const [isRunning, setIsRunning] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [result, setResult] = useState<TestRecord | null>(null);
  const [history, setHistory] = useState<TestRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedHistoryRecord, setSelectedHistoryRecord] = useState<TestRecord | null>(null);
  const [parseLogs, setParseLogs] = useState<ParseLog[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showWorkspaceList, setShowWorkspaceList] = useState(false);
  const [showDirBrowser, setShowDirBrowser] = useState(false);
  const [currentBrowsePath, setCurrentBrowsePath] = useState('root://');
  const [dirEntries, setDirEntries] = useState<DirEntry[]>([]);
  const [loadingDirs, setLoadingDirs] = useState(false);
  const [rootEntries, setRootEntries] = useState<DirEntry[]>([]);
  const [isRootList, setIsRootList] = useState(false);
  const [platform, setPlatform] = useState<'windows' | 'linux' | null>(null);
  const [showFilesModal, setShowFilesModal] = useState(false);
  const [filesData, setFilesData] = useState<{
    reportFiles: Array<{ name: string; url: string; size?: number }>;
    rawReportFiles: Array<{ name: string; url: string; size?: number }>;
  } | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);

  const logsRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [parseLogs]);

  useEffect(() => {
    if (currentTaskId && isRunning) {
      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/codeswarm/local-test?taskId=${currentTaskId}`);
          if (res.ok) {
            const data = await res.json();
            setResult(data.record);

            if (data.record.status === 'completed' || data.record.status === 'failed') {
              setIsRunning(false);
              if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
              }

              if (data.record.result) {
                setParseLogs(parseLogsFromResult(data.record.result));
              }

              if (data.record.status === 'completed') {
                toast.success('解析完成');
              } else {
                toast.error('解析失败');
              }
            }
          }
        } catch (e) {
          console.error('Poll error:', e);
        }
      }, 2000);

      return () => {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      };
    }
  }, [currentTaskId, isRunning]);

  useEffect(() => { loadRootEntries(); }, []);

  useEffect(() => {
    if (showDirBrowser && currentBrowsePath === 'root://') browseDirectory('root://');
  }, [showDirBrowser]);

  useEffect(() => {
    if (showHistory) loadHistory();
  }, [showHistory]);

  const addLog = (level: ParseLog['level'], message: string) => {
    setParseLogs(prev => [...prev, { timestamp: new Date().toISOString().substring(11, 19), level, message }]);
  };

  const loadRootEntries = async () => {
    try {
      const res = await fetch('/api/codeswarm/browse-dirs?listRoots=true');
      if (res.ok) {
        const data = await res.json();
        setRootEntries(data.entries || []);
        setPlatform(data.platform || null);
      }
    } catch {}
  };

  const browseDirectory = async (dirPath: string) => {
    setLoadingDirs(true);
    try {
      const res = await fetch(`/api/codeswarm/browse-dirs?path=${encodeURIComponent(dirPath)}`);
      if (res.ok) {
        const data = await res.json();
        setDirEntries(data.entries || []);
        setCurrentBrowsePath(data.currentPath || dirPath);
        setIsRootList(data.isRootList || false);
        if (data.platform && !platform) setPlatform(data.platform);
      } else {
        toast.error('无法访问该目录');
      }
    } catch {
      toast.error('浏览目录失败');
    } finally {
      setLoadingDirs(false);
    }
  };

  const handleRun = async () => {
    if (!workspacePath) {
      toast.error('请选择包含 Report 文件夹的工作区路径');
      return;
    }

    setIsRunning(true);
    setResult(null);
    setParseLogs([]);
    addLog('info', `提交解析任务 — 工作区: ${workspacePath}`);

    try {
      const response = await fetch('/api/codeswarm/local-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath, timeoutSec, engine }),
      });

      const data = await response.json();
      if (response.ok) {
        setCurrentTaskId(data.taskId);
        addLog('info', `任务已提交: ${data.taskId}`);
      } else {
        addLog('error', `提交失败: ${data.error}`);
        setIsRunning(false);
      }
    } catch (error) {
      addLog('error', `请求失败: ${error instanceof Error ? error.message : '未知错误'}`);
      setIsRunning(false);
    }
  };

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch('/api/codeswarm/local-test');
      if (res.ok) {
        const data = await res.json();
        setHistory(data.records || []);
      }
    } catch {} finally {
      setLoadingHistory(false);
    }
  };

  const loadTaskFiles = async (taskId: string) => {
    setLoadingFiles(true);
    setFilesData(null);
    try {
      const res = await fetch(`/api/codeswarm/local-test/files?taskId=${taskId}`);
      if (res.ok) {
        const data = await res.json();
        setFilesData({
          reportFiles: data.reportFiles || [],
          rawReportFiles: data.rawReportFiles || [],
        });
      } else {
        toast.error('获取文件列表失败');
      }
    } catch {
      toast.error('加载文件列表失败');
    } finally {
      setLoadingFiles(false);
    }
  };

  const downloadFile = async (url: string, filename: string) => {
    try {
      toast.loading(`下载 ${filename}...`);
      const res = await fetch(url);
      if (!res.ok) throw new Error('下载失败');
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
      toast.success(`已下载 ${filename}`);
    } catch (e) {
      toast.error(`下载失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  };

  // 从日志推断时间线各阶段状态
  type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

  const getTimelineStatus = (): Record<string, StepStatus> => {
    const has = (msg: string) => parseLogs.some(l => l.message.includes(msg));
    const hasLevel = (level: string) => parseLogs.some(l => l.level === level);

    const findReport = has('找到 Report') || has('未找到 Report');
    const skillParsed = has('Skill') && has('解析成功');
    const skillFailed = has('Skill') && (has('失败') || has('超时'));
    const fallbackStarted = has('Fallback') || (has('启动') && has('通用'));
    const fallbackCompleted = has('Fallback') && has('解析成功');
    const submitted = has('入库完成');
    const submitFailed = has('入库失败');
    const allFailed = hasLevel('error');

    return {
      findReport: result?.status ? (findReport ? 'done' : 'skipped') : (isRunning ? 'running' : 'pending'),
      skillParse: skillParsed ? 'done' : skillFailed ? 'error' : (isRunning && findReport ? 'running' : !result?.status ? 'pending' : 'skipped'),
      aiParse: fallbackCompleted ? 'done' : fallbackStarted ? 'running' : (allFailed && !skillParsed) ? 'error' : (!result?.status && !skillParsed) ? 'pending' : 'skipped',
      submit: submitted ? 'done' : submitFailed ? 'error' : (isRunning && (skillParsed || fallbackCompleted)) ? 'running' : (!result?.status ? 'pending' : 'skipped'),
    };
  };

  const timeline = getTimelineStatus();

  const getVulnCounts = () => {
    if (!result?.result) return null;
    const match = result.result.match(/创建 (\d+) 条.*?跳过 (\d+) 条/);
    if (!match) return null;
    return { created: parseInt(match[1]), skipped: parseInt(match[2]) };
  };

  const formatDuration = (ms?: number | null) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  // 渲染目录浏览器 modal
  const renderDirBrowser = () => showDirBrowser && (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-dark-surface border border-gray-700 rounded-lg w-[600px] max-h-[500px] flex flex-col">
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-200 flex items-center gap-2"><FolderSearch className="w-5 h-5" />浏览目录</h3>
          <button onClick={() => setShowDirBrowser(false)} className="text-gray-400 hover:text-gray-200">✕</button>
        </div>
        <div className="p-4 border-b border-gray-700 space-y-2">
          <div className="flex gap-2">
            {platform === 'windows' && (
              <select
                value={isRootList ? 'root://' : (currentBrowsePath.match(/^[A-Z]:\\/i)?.[0] || '')}
                onChange={(e) => { if (e.target.value === 'root://') browseDirectory('root://'); else if (e.target.value) browseDirectory(e.target.value); }}
                className="px-3 py-2 bg-dark-bg border border-gray-700 rounded text-sm text-gray-100"
              >
                <option value="root://">我的电脑</option>
                {rootEntries.map(e => <option key={e.path} value={e.path}>{e.name}</option>)}
              </select>
            )}
            <input
              value={isRootList ? (platform === 'windows' ? '我的电脑' : '根目录') : currentBrowsePath}
              onChange={(e) => setCurrentBrowsePath(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') browseDirectory(currentBrowsePath); }}
              className="flex-1 px-3 py-2 bg-dark-bg border border-gray-700 rounded text-sm text-gray-100"
              disabled={isRootList}
            />
            <button onClick={() => browseDirectory(currentBrowsePath)} disabled={loadingDirs || isRootList}
              className="px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 rounded text-sm text-white">
              {loadingDirs ? <Loader2 className="w-4 h-4 animate-spin" /> : '跳转'}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 min-h-[300px]">
          {!isRootList && (
            <button onClick={goUpDir} className="w-full px-3 py-2 text-left hover:bg-gray-700/50 rounded text-sm text-blue-400 flex items-center gap-2">
              <ChevronRight className="w-4 h-4 rotate-180" />上级目录
            </button>
          )}
          {loadingDirs ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          ) : dirEntries.map(entry => (
            <button key={entry.path} onClick={() => { if (entry.isDirectory) browseDirectory(entry.path); else toast.error('请选择目录'); }}
              className={`w-full px-3 py-2 text-left hover:bg-gray-700/50 rounded text-sm flex items-center gap-2 ${entry.isDirectory ? 'text-gray-300' : 'text-gray-600'}`}>
              {entry.isDirectory ? <FolderSearch className="w-4 h-4 text-yellow-500" /> : <span className="w-4 text-center text-gray-500 text-xs">📄</span>}
              <span className="flex-1">{entry.name}</span>
              {entry.isDirectory && <ChevronRight className="w-4 h-4 text-gray-500" />}
            </button>
          ))}
        </div>
        <div className="p-4 border-t border-gray-700 flex justify-end gap-2">
          <button onClick={() => setShowDirBrowser(false)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-300">取消</button>
          <button onClick={() => { setWorkspacePath(currentBrowsePath); setShowDirBrowser(false); toast.success(`已选择: ${currentBrowsePath}`); }}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 rounded text-sm text-white">选择当前目录</button>
        </div>
      </div>
    </div>
  );

  const goUpDir = () => {
    if (isRootList) return;
    if (platform === 'windows') {
      if (/^[A-Z]:\\?$/i.test(currentBrowsePath)) { browseDirectory('root://'); return; }
      const parts = currentBrowsePath.split(/[\\/]/).filter(p => p);
      browseDirectory(parts.length <= 1 ? 'root://' : parts[0] + '\\' + parts.slice(1, -1).join('\\'));
    } else {
      if (currentBrowsePath === '/') { browseDirectory('root://'); return; }
      const parts = currentBrowsePath.split('/').filter(p => p);
      browseDirectory(parts.length === 0 ? 'root://' : '/' + parts.slice(0, -1).join('/'));
    }
  };

  const renderFilesModal = () => showFilesModal && (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
      <div className="bg-dark-surface border border-gray-700 rounded-lg w-[700px] max-h-[600px] flex flex-col">
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-200 flex items-center gap-2">
            <Download className="w-5 h-5" />任务文件下载
          </h3>
          <button onClick={() => setShowFilesModal(false)} className="text-gray-400 hover:text-gray-200">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loadingFiles ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          ) : !filesData ? (
            <div className="text-center text-gray-500 py-8">无文件数据</div>
          ) : (
            <div className="space-y-4">
              {/* Report 文件 */}
              {filesData.reportFiles.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-blue-400 mb-2 flex items-center gap-2">
                    <FolderSearch className="w-4 h-4" />Report 文件夹文件
                  </h4>
                  <div className="bg-dark-bg rounded-lg p-2 space-y-1">
                    {filesData.reportFiles.map((file, i) => (
                      <div key={i} className="flex items-center justify-between px-2 py-1.5 hover:bg-gray-700/30 rounded">
                        <span className="text-xs text-gray-300 truncate flex-1">{file.name}</span>
                        <span className="text-xs text-gray-500 mr-2">{file.size ? `${(file.size / 1024).toFixed(1)}KB` : '-'}</span>
                        <button onClick={() => downloadFile(file.url, file.name)} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                          <Download className="w-3 h-3" />下载
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 漏洞原始文件 */}
              {filesData.rawReportFiles.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-purple-400 mb-2 flex items-center gap-2">
                    <FileText className="w-4 h-4" />漏洞原始文件
                  </h4>
                  <div className="bg-dark-bg rounded-lg p-2 space-y-1 max-h-[200px] overflow-y-auto">
                    {filesData.rawReportFiles.map((file, i) => (
                      <div key={i} className="flex items-center justify-between px-2 py-1.5 hover:bg-gray-700/30 rounded">
                        <span className="text-xs text-gray-300 truncate flex-1">{file.name.replace('raw/', '')}</span>
                        <span className="text-xs text-gray-500 mr-2">{file.size ? `${(file.size / 1024).toFixed(1)}KB` : '-'}</span>
                        <button onClick={() => downloadFile(file.url, file.name.replace('raw/', ''))} className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1">
                          <Download className="w-3 h-3" />下载
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {filesData.reportFiles.length === 0 && filesData.rawReportFiles.length === 0 && (
                <div className="text-center text-gray-500 py-8">暂无上传文件</div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-700 flex justify-end gap-2">
          <button onClick={() => setShowFilesModal(false)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-300">关闭</button>
        </div>
      </div>
    </div>
  );

  const vulnCounts = getVulnCounts();

  return (
    <div className="space-y-6">
      {renderDirBrowser()}
      {renderFilesModal()}

      {/* 工作区选择 */}
      <div className="bg-dark-surface rounded-xl border border-gray-700/50 p-5">
        <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4 text-blue-400" />
          报告路径
        </h3>
        <div className="flex gap-2">
          <input
            type="text" value={workspacePath}
            onChange={(e) => setWorkspacePath(e.target.value)}
            placeholder="选择包含 Report 文件夹的工作区目录"
            className="flex-1 px-3 py-2.5 bg-dark-bg border border-gray-700/50 rounded-lg text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          />
          <button onClick={() => setShowDirBrowser(true)}
            className="px-3 py-2.5 bg-blue-500/20 hover:bg-blue-500/30 rounded-lg text-sm text-blue-400 flex items-center gap-1">
            <FolderSearch className="w-4 h-4" />浏览
          </button>
          <button onClick={() => setShowWorkspaceList(!showWorkspaceList)}
            className="px-3 py-2.5 bg-gray-700/50 hover:bg-gray-700 rounded-lg text-sm text-gray-400">
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
        {showWorkspaceList && (
          <div className="mt-2 bg-dark-bg border border-gray-700 rounded-lg p-1">
            {COMMON_WORKSPACES.map(ws => (
              <button key={ws.path} onClick={() => { setWorkspacePath(ws.path); setShowWorkspaceList(false); }}
                className="w-full px-3 py-2 text-left hover:bg-gray-700/50 rounded text-sm text-gray-300 flex items-center justify-between">
                <span>{ws.name}</span><span className="text-xs text-gray-500">{ws.path}</span>
              </button>
            ))}
          </div>
        )}

        {/* 高级设置 */}
        <button onClick={() => setShowAdvanced(!showAdvanced)}
          className="mt-3 text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1">
          {showAdvanced ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          高级设置
        </button>
        {showAdvanced && (
          <div className="mt-2 space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">AI Fallback 引擎</span>
              <div className="flex gap-2">
                <button onClick={() => setEngine('opencode')}
                  className={`px-3 py-1 rounded text-xs border transition-colors ${engine === 'opencode' ? 'border-blue-500 bg-blue-500/20 text-blue-400' : 'border-gray-700 text-gray-500 hover:text-gray-300'}`}>
                  OpenCode
                </button>
                <button onClick={() => setEngine('claudecode')}
                  className={`px-3 py-1 rounded text-xs border transition-colors ${engine === 'claudecode' ? 'border-blue-500 bg-blue-500/20 text-blue-400' : 'border-gray-700 text-gray-500 hover:text-gray-300'}`}>
                  Claude Code
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="number" value={timeoutSec} onChange={(e) => setTimeoutSec(Math.max(60, parseInt(e.target.value) || 600))}
                min={60} max={7200} className="w-32 px-3 py-1.5 bg-dark-bg border border-gray-700 rounded text-sm text-gray-100" />
              <span className="text-xs text-gray-500">秒（fallback 超时时间）</span>
            </div>
          </div>
        )}
      </div>

      {/* 执行按钮 */}
      <div className="flex gap-3">
        <button onClick={handleRun} disabled={isRunning || !workspacePath}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-white font-medium transition-colors">
          {isRunning ? (
            <><Loader2 className="w-5 h-5 animate-spin" />解析中...</>
          ) : (
            <><Shield className="w-5 h-5" />解析漏洞报告</>
          )}
        </button>
        <button onClick={() => setShowHistory(true)}
          className="px-4 py-3 bg-green-500/20 hover:bg-green-500/30 rounded-lg text-green-400 flex items-center gap-2">
          <Clock className="w-5 h-5" />历史
        </button>
        <button onClick={() => { setParseLogs([]); setResult(null); setCurrentTaskId(null); setIsRunning(false); }}
          disabled={isRunning}
          className="px-4 py-3 bg-gray-700/50 hover:bg-gray-700 disabled:opacity-50 rounded-lg text-gray-400">
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {/* 执行时间线 */}
      {(isRunning || parseLogs.length > 0) && (
        <div className="bg-dark-surface rounded-xl border border-gray-700/50 p-5">
          <h3 className="text-sm font-medium text-gray-300 mb-4 flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            执行时间线
            {result?.durationMs != null && (
              <span className="ml-auto text-xs text-gray-500">总耗时 {formatDuration(result.durationMs)}</span>
            )}
          </h3>

          <div className="space-y-2">
            <TimelineStep
              label="查找 Report 文件夹"
              status={timeline.findReport}
              detail={parseLogs.find(l => l.message.includes('找到报告'))?.message}
              icon={<FileText className="w-4 h-4" />}
            />
            <TimelineStep
              label="Phase 1: audit-report-parser Skill"
              status={timeline.skillParse}
              detail={parseLogs.find(l => l.message.includes('Skill'))?.message}
              icon={<Zap className="w-4 h-4" />}
            />
            <TimelineStep
              label="Phase 2: 通用 AI Fallback (opencode)"
              status={timeline.aiParse}
              detail={parseLogs.find(l => l.message.includes('Fallback') || l.message.includes('opencode'))?.message}
              icon={<AlertTriangle className="w-4 h-4" />}
            />
            <TimelineStep
              label="漏洞入库"
              status={timeline.submit}
              detail={parseLogs.find(l => l.message.includes('入库'))?.message}
              icon={<Shield className="w-4 h-4" />}
            />
          </div>
        </div>
      )}

      {/* 执行结果摘要 */}
      {vulnCounts && (
        <div className="bg-green-900/20 border border-green-700/40 rounded-xl p-5">
          <h3 className="text-sm font-medium text-green-400 mb-3 flex items-center gap-2">
            <CheckCircle className="w-4 h-4" />
            解析结果
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-dark-bg rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-400">{vulnCounts.created}</p>
              <p className="text-xs text-gray-400 mt-1">新建漏洞</p>
            </div>
            <div className="bg-dark-bg rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-yellow-400">{vulnCounts.skipped}</p>
              <p className="text-xs text-gray-400 mt-1">跳过（重复）</p>
            </div>
            <div className="bg-dark-bg rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-blue-400">{vulnCounts.created + vulnCounts.skipped}</p>
              <p className="text-xs text-gray-400 mt-1">解析总数</p>
            </div>
          </div>
        </div>
      )}

      {/* 解析日志 */}
      {parseLogs.length > 0 && (
        <div className="bg-dark-surface rounded-xl border border-gray-700/50">
          <div className="px-5 py-3 border-b border-gray-700/50 flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              解析日志
            </h3>
            <button onClick={() => {
              safeClipboardWrite(parseLogs.map(l => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`).join('\n'));
              toast.success('已复制');
            }} className="text-xs text-gray-500 hover:text-blue-400 flex items-center gap-1">
              <Copy className="w-3 h-3" />复制
            </button>
          </div>
          <div ref={logsRef} className="p-4 max-h-64 overflow-y-auto bg-dark-bg rounded-b-xl">
            {parseLogs.map((log, i) => (
              <div key={i} className={`text-xs font-mono flex gap-3 py-0.5 ${
                log.level === 'error' ? 'text-red-400' :
                log.level === 'success' ? 'text-green-400' :
                log.level === 'warn' ? 'text-yellow-400' :
                'text-gray-300'
              }`}>
                <span className="text-gray-600 flex-shrink-0">{log.timestamp}</span>
                <span className={`flex-shrink-0 w-16 ${
                  log.level === 'error' ? 'text-red-500' :
                  log.level === 'success' ? 'text-green-500' :
                  log.level === 'warn' ? 'text-yellow-500' :
                  'text-gray-500'
                }`}>[{log.level.toUpperCase()}]</span>
                <span>{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 错误信息 */}
      {result?.error && result.status === 'failed' && (
        <div className="bg-red-900/20 border border-red-700/40 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <XCircle className="w-4 h-4 text-red-400" />
            <h3 className="text-sm font-medium text-red-400">错误信息</h3>
          </div>
          <AnsiText text={result.error} className="text-xs text-red-300 whitespace-pre-wrap font-mono bg-dark-bg rounded-lg p-3" />
        </div>
      )}

      {/* 使用说明 */}
      <div className="bg-cyan-900/20 border border-cyan-700/40 rounded-xl p-4">
        <h4 className="text-sm font-medium text-cyan-400 mb-2">解析流程说明</h4>
        <ul className="text-xs text-gray-300 space-y-1">
          <li>1. 选择包含 <code className="text-cyan-300">Report</code> 文件夹的工作区目录</li>
          <li>2. Phase 1: 使用 <code className="text-cyan-300">audit-report-parser</code> skill 解析报告</li>
          <li>3. Phase 2: 若 skill 失败，启动通用 AI Fallback (opencode --agent build)</li>
          <li>4. 解析成功后自动去重入库到漏洞管理</li>
        </ul>
      </div>

      {/* 历史 Modal */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-dark-surface border border-gray-700 rounded-lg w-[900px] max-h-[700px] flex flex-col">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-200 flex items-center gap-2">
                <Clock className="w-5 h-5" />解析历史
              </h3>
              <div className="flex items-center gap-2">
                <button onClick={loadHistory} disabled={loadingHistory}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-400">
                  {loadingHistory ? <Loader2 className="w-4 h-4 animate-spin" /> : '刷新'}
                </button>
                <button onClick={() => { setShowHistory(false); setSelectedHistoryRecord(null); }}
                  className="text-gray-400 hover:text-gray-200">✕</button>
              </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
              <div className="w-[350px] border-r border-gray-700 overflow-y-auto p-2">
                {loadingHistory ? (
                  <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
                ) : history.length === 0 ? (
                  <div className="text-center text-gray-500 py-8">暂无解析记录</div>
                ) : (
                  <div className="space-y-2">
                    {history.map(record => (
                      <button key={record.taskId} onClick={() => setSelectedHistoryRecord(record)}
                        className={`w-full px-3 py-2 text-left hover:bg-gray-700/50 rounded-lg border ${
                          selectedHistoryRecord?.taskId === record.taskId ? 'border-blue-500 bg-blue-500/10' : 'border-gray-700/50'
                        }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {record.status === 'completed' ? <CheckCircle className="w-4 h-4 text-green-400" />
                              : record.status === 'failed' ? <XCircle className="w-4 h-4 text-red-400" />
                              : <Clock className="w-4 h-4 text-yellow-400" />}
                            <span className="text-xs text-gray-200 truncate max-w-[180px]">{record.taskId.slice(0, 24)}</span>
                          </div>
                          <span className="text-xs text-gray-500">{record.durationMs ? `${(record.durationMs / 1000).toFixed(1)}s` : '-'}</span>
                        </div>
                        <div className="text-xs text-gray-500 truncate mt-1">{record.workspace}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {selectedHistoryRecord ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-gray-200">解析详情</h4>
                      <span className={`px-2 py-1 rounded text-xs ${
                        selectedHistoryRecord.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                        selectedHistoryRecord.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                        'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {selectedHistoryRecord.status}
                      </span>
                    </div>

                    <div className="bg-dark-bg rounded-lg p-3 space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">任务 ID</span>
                        <span className="text-gray-300">{selectedHistoryRecord.taskId}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">工作区</span>
                        <span className="text-gray-300 truncate max-w-[300px]">{selectedHistoryRecord.workspace}</span>
                      </div>
                      {selectedHistoryRecord.durationMs != null && (
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-500">耗时</span>
                          <span className="text-gray-300">{formatDuration(selectedHistoryRecord.durationMs)}</span>
                        </div>
                      )}
                      <div className="pt-2 border-t border-gray-700">
                        <button
                          onClick={() => {
                            setShowFilesModal(true);
                            loadTaskFiles('default');
                          }}
                          className="w-full px-3 py-2 bg-purple-500/20 hover:bg-purple-500/30 rounded-lg text-sm text-purple-400 flex items-center justify-center gap-2"
                        >
                          <Download className="w-4 h-4" />查看下载文件
                        </button>
                      </div>
                    </div>

                    {selectedHistoryRecord.result && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h5 className="text-xs font-medium text-gray-400">解析日志</h5>
                          <button onClick={() => { safeClipboardWrite(selectedHistoryRecord.result || ''); toast.success('已复制'); }}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-blue-400">
                            <Copy className="w-3 h-3" />复制
                          </button>
                        </div>
                        <div className="bg-dark-bg rounded-lg p-3 max-h-[350px] overflow-y-auto">
                          {parseLogsFromResult(selectedHistoryRecord.result).map((log, i) => (
                            <div key={i} className={`text-xs font-mono flex gap-3 py-0.5 ${
                              log.level === 'error' ? 'text-red-400' :
                              log.level === 'success' ? 'text-green-400' :
                              log.level === 'warn' ? 'text-yellow-400' :
                              'text-gray-300'
                            }`}>
                              <span className="text-gray-600">{log.timestamp}</span>
                              <span className="w-16">[{log.level.toUpperCase()}]</span>
                              <span>{log.message}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedHistoryRecord.error && (
                      <div>
                        <h5 className="text-xs font-medium text-red-400 mb-2">错误信息</h5>
                        <AnsiText text={selectedHistoryRecord.error} className="text-xs text-red-300 whitespace-pre-wrap font-mono bg-dark-bg rounded-lg p-3 border border-red-700/50" />
                      </div>
                    )}

                    {selectedHistoryRecord.parsedVulnerabilities && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h5 className="text-xs font-medium text-cyan-400">Skill 返回的完整数据 (入库前检查)</h5>
                          <button onClick={() => { safeClipboardWrite(selectedHistoryRecord.parsedVulnerabilities || ''); toast.success('已复制'); }}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-blue-400">
                            <Copy className="w-3 h-3" />复制JSON
                          </button>
                        </div>
                        <div className="bg-dark-bg rounded-lg p-3 max-h-[400px] overflow-y-auto">
                          <AnsiText text={(() => {
                            try {
                              const data = JSON.parse(selectedHistoryRecord.parsedVulnerabilities || '{}');
                              return JSON.stringify(data, null, 2);
                            } catch {
                              return selectedHistoryRecord.parsedVulnerabilities;
                            }
                          })()} className="text-xs text-cyan-300 whitespace-pre-wrap font-mono" />
                          <div className="mt-2 pt-2 border-t border-gray-700">
                            <p className="text-xs text-gray-400 mb-1">漏洞数量: {(() => {
                              try {
                                const data = JSON.parse(selectedHistoryRecord.parsedVulnerabilities || '{}');
                                return data.vulnerabilities?.length || 0;
                              } catch {
                                return 0;
                              }
                            })()}</p>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="text-gray-500">顶层字段:</div>
                              <div className="text-gray-300">
                                {(() => {
                                  try {
                                    const data = JSON.parse(selectedHistoryRecord.parsedVulnerabilities || '{}');
                                    const hasEvalId = 'evaluationId' in data;
                                    const hasSkillExecId = 'skillExecutionId' in data;
                                    return `${hasEvalId ? '✅' : '❌'} evaluationId | ${hasSkillExecId ? '✅' : '❌'} skillExecutionId`;
                                  } catch {
                                    return '解析失败';
                                  }
                                })()}
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs mt-1">
                              <div className="text-gray-500">漏洞字段检查:</div>
                              <div className="text-gray-300">
                                {(() => {
                                  try {
                                    const data = JSON.parse(selectedHistoryRecord.parsedVulnerabilities || '{}');
                                    const vulns: Array<{title?: string; type?: string}> = data.vulnerabilities || [];
                                    const allHaveTitle = vulns.every((v: {title?: string}) => v.title);
                                    const allHaveType = vulns.every((v: {type?: string}) => v.type);
                                    return `${allHaveTitle ? '✅' : '❌'} title | ${allHaveType ? '✅' : '❌'} type`;
                                  } catch {
                                    return '解析失败';
                                  }
                                })()}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                    点击左侧记录查看详情
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
