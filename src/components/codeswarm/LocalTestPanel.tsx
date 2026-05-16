'use client';

import { useState, useEffect, useRef } from 'react';
import { Play, FolderOpen, Loader2, CheckCircle, XCircle, Clock, Copy, RefreshCw, ChevronDown, ChevronRight, Zap, FolderSearch, HardDrive, Download } from 'lucide-react';
import toast from 'react-hot-toast';

interface TestRecord {
  taskId: string;
  workspace: string;
  instruction: string;
  status: string;
  result?: string | null;
  error?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  createdAt?: string;
  uploadedFilePath?: string | null;
}

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  label?: string;
}

const COMMON_WORKSPACES = [
  { path: 'E:\\work\\202605\\claude-web-platform', name: 'claude-web-platform' },
  { path: 'E:\\work\\202605\\claude-web-platform\\AgentHarness_management', name: 'AgentHarness' },
];

export function LocalTestPanel() {
  const [workspacePath, setWorkspacePath] = useState('');
  const [timeoutSec, setTimeoutSec] = useState(600);
  const [isRunning, setIsRunning] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [result, setResult] = useState<TestRecord | null>(null);
  const [history, setHistory] = useState<TestRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedHistoryRecord, setSelectedHistoryRecord] = useState<TestRecord | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showWorkspaceList, setShowWorkspaceList] = useState(false);
  const [showDirBrowser, setShowDirBrowser] = useState(false);
  const [currentBrowsePath, setCurrentBrowsePath] = useState('drives://');
  const [dirEntries, setDirEntries] = useState<DirEntry[]>([]);
  const [loadingDirs, setLoadingDirs] = useState(false);
  const [drives, setDrives] = useState<DirEntry[]>([]);
  const [isDrivesList, setIsDrivesList] = useState(false);
  
  const logsRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

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

              if (data.record.status === 'completed') {
                addLog('任务执行完成', 'success');
                toast.success('任务执行成功');
              } else {
                addLog('任务执行失败', 'error');
                toast.error('任务执行失败');
              }
            }
          }
        } catch (e) {
          console.error('Poll error:', e);
        }
      }, 3000);

      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
        }
      };
    }
  }, [currentTaskId, isRunning]);

  const addLog = (message: string, type: 'info' | 'error' | 'success' = 'info') => {
    const timestamp = new Date().toISOString().substring(11, 19);
    const prefix = type === 'error' ? '[ERROR]' : type === 'success' ? '[OK]' : '[INFO]';
    setLogs(prev => [...prev, `${timestamp} ${prefix} ${message}`]);
  };

  const loadDrives = async () => {
    try {
      const res = await fetch('/api/codeswarm/browse-dirs?listDrives=true');
      if (res.ok) {
        const data = await res.json();
        setDrives(data.entries || []);
      }
    } catch (e) {
      console.error('Load drives error:', e);
    }
  };

  const browseDirectory = async (path: string) => {
    setLoadingDirs(true);
    try {
      const res = await fetch(`/api/codeswarm/browse-dirs?path=${encodeURIComponent(path)}`);
      if (res.ok) {
        const data = await res.json();
        setDirEntries(data.entries || []);
        setCurrentBrowsePath(data.currentPath || path);
        setIsDrivesList(data.isDrivesList || false);
      } else {
        toast.error('无法访问该目录');
      }
    } catch (e) {
      toast.error('浏览目录失败');
    } finally {
      setLoadingDirs(false);
    }
  };

  useEffect(() => {
    loadDrives();
  }, []);

  useEffect(() => {
    if (showDirBrowser) {
      browseDirectory(currentBrowsePath);
    }
  }, [showDirBrowser]);

  const selectDir = (entry: DirEntry) => {
    if (entry.isDirectory) {
      browseDirectory(entry.path);
    } else {
      toast.error('请选择目录而非文件');
    }
  };

  const confirmSelection = () => {
    setWorkspacePath(currentBrowsePath);
    setShowDirBrowser(false);
    toast.success(`已选择: ${currentBrowsePath}`);
  };

  const goUpDir = () => {
    if (isDrivesList) return;
    if (/^[A-Z]:\\?$/i.test(currentBrowsePath)) {
      browseDirectory('drives://');
    } else {
      const parentPath = currentBrowsePath.split(/[\\/]/).slice(0, -1).join('\\');
      if (parentPath && parentPath.length >= 2) {
        browseDirectory(parentPath);
      } else {
        browseDirectory('drives://');
      }
    }
  };

  const selectDrive = (drivePath: string) => {
    browseDirectory(drivePath);
  };

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch('/api/codeswarm/local-test');
      if (res.ok) {
        const data = await res.json();
        setHistory(data.records || []);
      }
    } catch (e) {
      console.error('Load history error:', e);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (showHistory) {
      loadHistory();
    }
  }, [showHistory]);

  const viewHistoryRecord = (record: TestRecord) => {
    setSelectedHistoryRecord(record);
  };

  const handleRun = async () => {
    if (!workspacePath) {
      toast.error('请选择工作区路径');
      return;
    }

    setIsRunning(true);
    setResult(null);
    setLogs([]);
    addLog('提交任务...');
    addLog(`工作区: ${workspacePath}`);
    addLog(`Agent: build`);
    addLog(`执行 audit-report-parser skill...`);

    try {
      const response = await fetch('/api/codeswarm/local-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspacePath,
          timeoutSec,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setCurrentTaskId(data.taskId);
        addLog(`任务已提交: ${data.taskId}`);
        addLog('后台执行中，等待结果...');
        toast.success('任务已提交');
      } else {
        addLog(`提交失败: ${data.error}`, 'error');
        setIsRunning(false);
        toast.error('提交失败');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      addLog(`请求失败: ${errorMsg}`, 'error');
      setIsRunning(false);
      toast.error('请求失败');
    }
  };

  const handleCopyResult = () => {
    if (result?.result) {
      navigator.clipboard.writeText(result.result);
      toast.success('已复制输出到剪贴板');
    }
  };

  const formatDuration = (start?: string | null, end?: string | null) => {
    if (!start || !end) return '-';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const selectWorkspace = (path: string) => {
    setWorkspacePath(path);
    setShowWorkspaceList(false);
    toast.success(`已选择工作区: ${path}`);
  };

  return (
    <div className="space-y-6">
      {/* Directory Browser Modal */}
      {showDirBrowser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-dark-surface border border-gray-700 rounded-lg w-[600px] max-h-[500px] flex flex-col">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-200 flex items-center gap-2">
                <FolderSearch className="w-5 h-5" />
                浏览目录
              </h3>
              <button
                onClick={() => setShowDirBrowser(false)}
                className="text-gray-400 hover:text-gray-200"
              >
                ✕
              </button>
            </div>

            <div className="p-4 border-b border-gray-700 space-y-2">
              <div className="flex gap-2">
                <div className="relative">
                  <select
                    value={isDrivesList ? 'drives://' : (currentBrowsePath.match(/^[A-Z]:\\/i)?.[0] || '')}
                    onChange={(e) => {
                      if (e.target.value === 'drives://') {
                        browseDirectory('drives://');
                      } else if (e.target.value) {
                        browseDirectory(e.target.value);
                      }
                    }}
                    className="appearance-none px-3 py-2 pr-8 bg-[#0F172A] border border-gray-700 rounded text-sm text-gray-100 cursor-pointer"
                  >
                    <option value="drives://">我的电脑</option>
                    {drives.map((drive) => (
                      <option key={drive.path} value={drive.path}>
                        {drive.name}
                      </option>
                    ))}
                  </select>
                  <HardDrive className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
                <input
                  type="text"
                  value={isDrivesList ? '我的电脑' : currentBrowsePath}
                  onChange={(e) => setCurrentBrowsePath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      browseDirectory(currentBrowsePath);
                    }
                  }}
                  className="flex-1 px-3 py-2 bg-[#0F172A] border border-gray-700 rounded text-sm text-gray-100"
                  placeholder="输入路径..."
                  disabled={isDrivesList}
                />
                <button
                  onClick={() => browseDirectory(currentBrowsePath)}
                  disabled={loadingDirs || isDrivesList}
                  className="px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 rounded text-sm text-white"
                >
                  {loadingDirs ? <Loader2 className="w-4 h-4 animate-spin" /> : '跳转'}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 min-h-[300px]">
              {!isDrivesList && (
                <button
                  onClick={goUpDir}
                  className="w-full px-3 py-2 text-left hover:bg-dark-surface-hover rounded text-sm text-blue-400 flex items-center gap-2"
                >
                  <ChevronRight className="w-4 h-4 rotate-180" />
                  上级目录
                </button>
              )}
              {loadingDirs ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : isDrivesList ? (
                <div className="space-y-1">
                  <div className="px-3 py-1 text-xs text-gray-500">选择驱动器</div>
                  {dirEntries.map((entry) => (
                    <button
                      key={entry.path}
                      onClick={() => selectDrive(entry.path)}
                      className="w-full px-3 py-2 text-left hover:bg-dark-surface-hover rounded text-sm flex items-center gap-2 text-gray-300"
                    >
                      <HardDrive className="w-4 h-4 text-blue-400" />
                      <span className="flex-1">{entry.name}</span>
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    </button>
                  ))}
                </div>
              ) : dirEntries.length === 0 ? (
                <div className="text-center text-gray-500 py-8">该目录为空</div>
              ) : (
                dirEntries.map((entry) => (
                  <button
                    key={entry.path}
                    onClick={() => selectDir(entry)}
                    className={`w-full px-3 py-2 text-left hover:bg-dark-surface-hover rounded text-sm flex items-center gap-2 ${
                      entry.isDirectory ? 'text-gray-300' : 'text-gray-500'
                    }`}
                  >
                    {entry.isDirectory ? (
                      <FolderOpen className="w-4 h-4 text-yellow-500" />
                    ) : (
                      <span className="w-4 text-center text-gray-400">📄</span>
                    )}
                    <span className="flex-1">{entry.name}</span>
                    {entry.isDirectory && (
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    )}
                  </button>
                ))
              )}
            </div>

            <div className="p-4 border-t border-gray-700 flex justify-end gap-2">
              <button
                onClick={() => setShowDirBrowser(false)}
                className="px-4 py-2 bg-dark-surface-hover hover:bg-gray-700 rounded text-sm text-gray-400"
              >
                取消
              </button>
              <button
                onClick={confirmSelection}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 rounded text-sm text-white"
              >
                选择当前目录
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Workspace Selection */}
      <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
          <FolderOpen className="w-4 h-4" />
          工作区路径
        </h3>

        <div className="flex gap-2">
          <input
            type="text"
            value={workspacePath}
            onChange={(e) => setWorkspacePath(e.target.value)}
            placeholder="输入本地目录路径，如 E:\\work\\project"
            className="flex-1 px-3 py-2 bg-[#0F172A] border border-gray-700 rounded-lg text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={() => setShowDirBrowser(true)}
            className="px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 rounded-lg text-sm text-blue-400 flex items-center gap-1"
          >
            <FolderSearch className="w-4 h-4" />
            浏览
          </button>
          <button
            onClick={() => setShowWorkspaceList(!showWorkspaceList)}
            className="px-3 py-2 bg-dark-surface-hover hover:bg-gray-700 rounded-lg text-sm text-gray-400 flex items-center gap-1"
          >
            <ChevronDown className="w-4 h-4" />
            常用
          </button>
        </div>

        {showWorkspaceList && (
          <div className="mt-2 bg-[#0F172A] border border-gray-700 rounded-lg p-2">
            {COMMON_WORKSPACES.map((ws) => (
              <button
                key={ws.path}
                onClick={() => selectWorkspace(ws.path)}
                className="w-full px-3 py-2 text-left hover:bg-dark-surface-hover rounded text-sm text-gray-300 flex items-center justify-between"
              >
                <span>{ws.name}</span>
                <span className="text-xs text-gray-500">{ws.path}</span>
              </button>
            ))}
          </div>
        )}

        <p className="text-xs text-gray-500 mt-2">
          选择包含代码的目录，opencode 将以 build 模式执行任务
        </p>
      </div>

      {/* Agent Info (Fixed to build) */}
      <div className="bg-dark-surface rounded-lg border border-gray-700/50 p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4" />
          执行模式
        </h3>

        <div className="inline-flex px-3 py-2 bg-blue-500/20 border border-blue-500/50 rounded-lg text-sm text-blue-400">
          build（固定模式）
        </div>

        <p className="text-xs text-gray-500 mt-2">
          使用 build 模式执行，加载已配置的 skills（如 audit-report-parser）
        </p>
      </div>

      {/* Advanced Settings */}
      <div className="bg-dark-surface rounded-lg border border-gray-700/50">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full px-4 py-3 flex items-center justify-between text-sm text-gray-400 hover:text-gray-200"
        >
          <span>高级设置</span>
          {showAdvanced ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        {showAdvanced && (
          <div className="px-4 pb-4 border-t border-gray-700/50 pt-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">超时时间（秒）</label>
              <input
                type="number"
                value={timeoutSec}
                onChange={(e) => setTimeoutSec(Math.max(60, parseInt(e.target.value) || 600))}
                min={60}
                max={7200}
                className="w-32 px-3 py-2 bg-[#0F172A] border border-gray-700 rounded-lg text-sm text-gray-100"
              />
            </div>
          </div>
        )}
      </div>

      {/* Execute Button */}
      <div className="flex gap-3">
        <button
          onClick={handleRun}
          disabled={isRunning || !workspacePath}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-white font-medium transition-colors"
        >
          {isRunning ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              执行中...
            </>
          ) : (
            <>
              <Play className="w-5 h-5" />
              执行任务（异步）
            </>
          )}
        </button>

        <button
          onClick={() => setShowHistory(true)}
          className="px-4 py-3 bg-green-500/20 hover:bg-green-500/30 rounded-lg text-green-400 flex items-center gap-2"
        >
          <Clock className="w-5 h-5" />
          历史
        </button>

        <button
          onClick={() => {
            setLogs([]);
            setResult(null);
            setCurrentTaskId(null);
            setIsRunning(false);
          }}
          disabled={isRunning}
          className="px-4 py-3 bg-dark-surface-hover hover:bg-gray-700 disabled:opacity-50 rounded-lg text-gray-400 flex items-center gap-2"
        >
          <RefreshCw className="w-5 h-5" />
          清空
        </button>
      </div>

      {/* History Modal */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-dark-surface border border-gray-700 rounded-lg w-[900px] max-h-[700px] flex flex-col">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-200 flex items-center gap-2">
                <Clock className="w-5 h-5" />
                测试记录历史
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={loadHistory}
                  disabled={loadingHistory}
                  className="px-3 py-1 bg-dark-surface-hover hover:bg-gray-700 rounded text-sm text-gray-400"
                >
                  {loadingHistory ? <Loader2 className="w-4 h-4 animate-spin" /> : '刷新'}
                </button>
                <button
                  onClick={() => {
                    setShowHistory(false);
                    setSelectedHistoryRecord(null);
                  }}
                  className="text-gray-400 hover:text-gray-200"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
              {/* 左侧列表 */}
              <div className="w-[350px] border-r border-gray-700 overflow-y-auto p-2">
                {loadingHistory ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                  </div>
                ) : history.length === 0 ? (
                  <div className="text-center text-gray-500 py-8">暂无测试记录</div>
                ) : (
                  <div className="space-y-2">
                    {history.map((record) => (
                      <button
                        key={record.taskId}
                        onClick={() => viewHistoryRecord(record)}
                        className={`w-full px-3 py-2 text-left hover:bg-dark-surface-hover rounded-lg border ${
                          selectedHistoryRecord?.taskId === record.taskId
                            ? 'border-blue-500 bg-blue-500/10'
                            : 'border-gray-700/50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {record.status === 'completed' ? (
                              <CheckCircle className="w-4 h-4 text-green-400" />
                            ) : record.status === 'failed' ? (
                              <XCircle className="w-4 h-4 text-red-400" />
                            ) : record.status === 'running' ? (
                              <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                            ) : (
                              <Clock className="w-4 h-4 text-yellow-400" />
                            )}
                            <div className="text-xs font-medium text-gray-200 truncate max-w-[180px]">
                              {record.taskId.slice(0, 20)}...
                            </div>
                          </div>
                          <div className="text-xs text-gray-500">
                            {record.durationMs ? `${(record.durationMs / 1000).toFixed(1)}s` : '-'}
                          </div>
                        </div>
                        <div className="text-xs text-gray-500 truncate mt-1">
                          {record.workspace}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 右侧详情 */}
              <div className="flex-1 overflow-y-auto p-4">
                {selectedHistoryRecord ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-gray-200">任务详情</h4>
                      <span className={`px-2 py-1 rounded text-xs ${
                        selectedHistoryRecord.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                        selectedHistoryRecord.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                        'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {selectedHistoryRecord.status}
                      </span>
                    </div>

                    <div className="bg-[#0F172A] rounded-lg p-3 space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">任务 ID</span>
                        <span className="text-gray-300">{selectedHistoryRecord.taskId}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">工作区</span>
                        <span className="text-gray-300 truncate max-w-[300px]">{selectedHistoryRecord.workspace}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500">执行指令</span>
                        <span className="text-gray-300 truncate max-w-[300px]">{selectedHistoryRecord.instruction}</span>
                      </div>
                      {selectedHistoryRecord.durationMs && (
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-500">执行耗时</span>
                          <span className="text-gray-300">{(selectedHistoryRecord.durationMs / 1000).toFixed(2)} 秒</span>
                        </div>
                      )}
                      {selectedHistoryRecord.startedAt && (
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-500">开始时间</span>
                          <span className="text-gray-300">{new Date(selectedHistoryRecord.startedAt).toLocaleString('zh-CN')}</span>
                        </div>
                      )}
                      {selectedHistoryRecord.completedAt && (
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-500">完成时间</span>
                          <span className="text-gray-300">{new Date(selectedHistoryRecord.completedAt).toLocaleString('zh-CN')}</span>
                        </div>
                      )}
                    </div>

                    {selectedHistoryRecord.uploadedFilePath && (
                      <div className="flex items-center justify-between bg-[#0F172A] rounded-lg p-3">
                        <div className="text-xs">
                          <span className="text-gray-500">审计报告: </span>
                          <span className="text-gray-300">{selectedHistoryRecord.uploadedFilePath}</span>
                        </div>
                        <button
                          onClick={() => {
                            window.open(`/api/codeswarm/download-report?taskId=${selectedHistoryRecord.taskId}`, '_blank');
                          }}
                          className="flex items-center gap-1 px-3 py-1 bg-blue-500/20 hover:bg-blue-500/30 rounded text-xs text-blue-400"
                        >
                          <Download className="w-3 h-3" />
                          下载报告
                        </button>
                      </div>
                    )}

                    {selectedHistoryRecord.result && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h5 className="text-xs font-medium text-gray-400">执行输出</h5>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(selectedHistoryRecord.result || '');
                              toast.success('已复制输出');
                            }}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-blue-400"
                          >
                            <Copy className="w-3 h-3" />
                            复制
                          </button>
                        </div>
                        <div className="bg-[#0F172A] rounded-lg p-3 max-h-[300px] overflow-y-auto">
                          <pre className="text-xs text-gray-200 whitespace-pre-wrap font-mono">
                            {selectedHistoryRecord.result}
                          </pre>
                        </div>
                      </div>
                    )}

                    {selectedHistoryRecord.error && selectedHistoryRecord.status === 'failed' && (
                      <div>
                        <h5 className="text-xs font-medium text-red-400 mb-2">错误信息</h5>
                        <div className="bg-[#0F172A] rounded-lg p-3 border border-red-700/50">
                          <pre className="text-xs text-red-300 whitespace-pre-wrap font-mono">
                            {selectedHistoryRecord.error}
                          </pre>
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

      {/* Status Info */}
      {currentTaskId && (
        <div className="bg-cyan-900/20 border border-cyan-700/40 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium text-cyan-400">任务 ID</h4>
              <code className="text-xs text-gray-300">{currentTaskId}</code>
            </div>
            <div className="text-right">
              <h4 className="text-sm font-medium text-cyan-400">状态</h4>
              <span className={`text-xs ${
                result?.status === 'completed' ? 'text-green-400' :
                result?.status === 'failed' ? 'text-red-400' :
                'text-yellow-400'
              }`}>
                {result?.status || 'queued'}
              </span>
            </div>
          </div>
          {result?.startedAt && result?.completedAt && (
            <div className="mt-2 text-xs text-gray-400">
              执行耗时: {formatDuration(result.startedAt, result.completedAt)}
            </div>
          )}
        </div>
      )}

      {/* Logs Output */}
      {logs.length > 0 && (
        <div className="bg-dark-surface rounded-lg border border-gray-700/50">
          <div className="px-4 py-2 border-b border-gray-700/50 flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              执行日志
            </h3>
          </div>

          <div
            ref={logsRef}
            className="p-4 h-48 overflow-y-auto bg-[#0F172A] font-mono text-xs"
          >
            {logs.map((log, i) => (
              <div
                key={i}
                className={`${
                  log.includes('[ERROR]') ? 'text-red-400' :
                  log.includes('[OK]') ? 'text-green-400' :
                  'text-gray-300'
                }`}
              >
                {log}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Result Output */}
      {result?.result && (
        <div className="bg-dark-surface rounded-lg border border-gray-700/50">
          <div className="px-4 py-2 border-b border-gray-700/50 flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-400" />
              执行结果
            </h3>
            <button
              onClick={handleCopyResult}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-blue-400"
            >
              <Copy className="w-3 h-3" />
              复制
            </button>
          </div>

          <div className="p-4 bg-[#0F172A] max-h-96 overflow-y-auto">
            <pre className="text-sm text-gray-200 whitespace-pre-wrap font-mono">
              {result.result}
            </pre>
          </div>
        </div>
      )}

      {/* Error Output */}
      {result?.error && result.status === 'failed' && (
        <div className="bg-dark-surface rounded-lg border border-red-700/50">
          <div className="px-4 py-2 border-b border-red-700/50 flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-400" />
            <h3 className="text-sm font-medium text-red-400">错误信息</h3>
          </div>

          <div className="p-4 bg-[#0F172A]">
            <pre className="text-sm text-red-300 whitespace-pre-wrap font-mono">
              {result.error}
            </pre>
          </div>
        </div>
      )}

      {/* Help Tips */}
      <div className="bg-cyan-900/20 border border-cyan-700/40 rounded-lg p-4">
        <h4 className="text-sm font-medium text-cyan-400 mb-2">使用说明</h4>
        <ul className="text-xs text-gray-300 space-y-1">
          <li>• 选择包含审计报告的工作区目录</li>
          <li>• 点击执行，自动运行 audit-report-parser skill</li>
          <li>• 任务异步后台执行，不阻塞页面</li>
          <li>• 执行完成后自动获取解析结果</li>
          <li>• 结果存储在数据库，可随时查询</li>
        </ul>
      </div>
    </div>
  );
}