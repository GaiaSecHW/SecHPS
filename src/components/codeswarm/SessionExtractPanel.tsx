'use client';

import { useState, useEffect } from 'react';
import { Play, Loader2, FolderSearch, Copy, ChevronDown, ChevronRight, HardDrive, History, Trash2, Clock, RefreshCw, Brain, MessageSquare } from 'lucide-react';
import toast from 'react-hot-toast';

interface SkillCall {
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
  result: unknown;
  startTime: string;
  endTime: string;
  reasoning: string[];
  textOutputs: string[];
}

interface ToolCall {
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
  result: unknown;
  startTime: string;
  endTime: string;
}

interface SessionExtractResult {
  sessionId: string;
  summary: string;
  messageCount: number;
  lastActivity: string;
  skills: SkillCall[];
  tools: ToolCall[];
  reasoning: Array<{ content: string; startTime: string }>;
  textOutputs: Array<{ content: string; startTime: string }>;
  historyId?: string;
}

interface HistoryItem {
  id: string;
  sessionId: string;
  workspacePath: string;
  summary: string | null;
  skillsCount: number;
  toolsCount: number;
  messageCount: number;
  lastActivity: string;
  extractedAt: string;
}

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export function SessionExtractPanel() {
  const [activeTab, setActiveTab] = useState<'history' | 'new'>('history');
  const [workspacePath, setWorkspacePath] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractResult, setExtractResult] = useState<SessionExtractResult | null>(null);
  const [expandedSkill, setExpandedSkill] = useState<number | null>(null);
  const [expandedTool, setExpandedTool] = useState<number | null>(null);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);

  const [showDirBrowser, setShowDirBrowser] = useState(false);
  const [currentBrowsePath, setCurrentBrowsePath] = useState('');
  const [dirEntries, setDirEntries] = useState<DirEntry[]>([]);
  const [rootEntries, setRootEntries] = useState<DirEntry[]>([]);
  const [loadingDirs, setLoadingDirs] = useState(false);
  const [isRootList, setIsRootList] = useState(false);
  const [platform, setPlatform] = useState<string | null>(null);

  useEffect(() => {
    loadRootEntries();
    loadHistory();
  }, []);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch('/api/codeswarm/session-extract/history?limit=50');
      if (res.ok) {
        const data = await res.json();
        setHistory(data.history || []);
      }
    } catch {
      toast.error('加载历史失败');
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadHistoryDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/codeswarm/session-extract/history/${id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.rawData) {
          const parsed = JSON.parse(data.rawData) as SessionExtractResult;
          setExtractResult(parsed);
          setSelectedHistoryId(id);
          setExpandedSkill(null);
          setExpandedTool(null);
        }
      }
    } catch {
      toast.error('加载历史详情失败');
    }
  };

  const deleteHistoryItem = async (id: string) => {
    try {
      const res = await fetch(`/api/codeswarm/session-extract/history/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setHistory(history.filter(h => h.id !== id));
        if (selectedHistoryId === id) {
          setExtractResult(null);
          setSelectedHistoryId(null);
        }
        toast.success('已删除');
      }
    } catch {
      toast.error('删除失败');
    }
  };

  const clearAllHistory = async () => {
    if (!confirm('确定清空所有历史记录？')) return;
    try {
      const res = await fetch('/api/codeswarm/session-extract/history', { method: 'DELETE' });
      if (res.ok) {
        setHistory([]);
        setExtractResult(null);
        setSelectedHistoryId(null);
        toast.success('已清空');
      }
    } catch {
      toast.error('清空失败');
    }
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

  const handleSessionExtract = async () => {
    if (!workspacePath) {
      toast.error('请输入工作区路径');
      return;
    }

    setIsExtracting(true);
    setExtractResult(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/codeswarm/session-extract', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workspacePath }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '请求失败');
      }

      const data = await response.json();
      setExtractResult(data);
      setSelectedHistoryId(data.historyId);
      setExpandedSkill(null);
      setExpandedTool(null);
      setActiveTab('history');
      loadHistory();
      toast.success(`解析完成: ${data.skills?.length || 0} Skills, ${data.tools?.length || 0} Tools`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '解析失败');
    } finally {
      setIsExtracting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('已复制');
  };

  const formatJson = (obj: unknown) => {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  };

  const truncateJson = (obj: unknown, maxLength = 300) => {
    const str = formatJson(obj);
    return str.length > maxLength ? str.slice(0, maxLength) + '...' : str;
  };

  const truncatePath = (path: string, maxLen = 35) => {
    if (path.length <= maxLen) return path;
    const parts = path.split(/[\\/]/);
    if (parts.length <= 2) return path.slice(-maxLen);
    return '...' + parts.slice(-2).join('/');
  };

  const renderDirBrowser = () => showDirBrowser && (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#1E293B] border border-gray-700 rounded-lg w-[600px] max-h-[500px] flex flex-col">
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-200 flex items-center gap-2">
            <FolderSearch className="w-5 h-5" />
            浏览目录
          </h3>
          <button onClick={() => setShowDirBrowser(false)} className="text-gray-400 hover:text-gray-200">✕</button>
        </div>
        <div className="p-4 border-b border-gray-700 space-y-2">
          <div className="flex gap-2">
            {platform === 'windows' && (
              <select
                value={isRootList ? 'root://' : (currentBrowsePath.match(/^[A-Z]:\\/i)?.[0] || '')}
                onChange={(e) => { if (e.target.value === 'root://') browseDirectory('root://'); else if (e.target.value) browseDirectory(e.target.value); }}
                className="px-3 py-2 bg-[#0F172A] border border-gray-700 rounded text-sm text-gray-100"
              >
                <option value="root://">我的电脑</option>
                {rootEntries.map(e => <option key={e.path} value={e.path}>{e.name}</option>)}
              </select>
            )}
            <input
              value={isRootList ? (platform === 'windows' ? '我的电脑' : '根目录') : currentBrowsePath}
              onChange={(e) => setCurrentBrowsePath(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') browseDirectory(currentBrowsePath); }}
              className="flex-1 px-3 py-2 bg-[#0F172A] border border-gray-700 rounded text-sm text-gray-100"
              disabled={isRootList}
            />
            <button
              onClick={() => browseDirectory(currentBrowsePath)}
              disabled={loadingDirs || isRootList}
              className="px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-600 rounded text-sm text-white"
            >
              {loadingDirs ? <Loader2 className="w-4 h-4 animate-spin" /> : '跳转'}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 min-h-[300px]">
          {!isRootList && (
            <button
              onClick={goUpDir}
              className="w-full px-3 py-2 text-left hover:bg-gray-700/50 rounded text-sm text-blue-400 flex items-center gap-2"
            >
              <ChevronRight className="w-4 h-4 rotate-180" />
              上级目录
            </button>
          )}
          {loadingDirs ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : dirEntries.map(entry => (
            <button
              key={entry.path}
              onClick={() => { if (entry.isDirectory) browseDirectory(entry.path); else toast.error('请选择目录'); }}
              className={`w-full px-3 py-2 text-left hover:bg-gray-700/50 rounded text-sm flex items-center gap-2 ${entry.isDirectory ? 'text-gray-300' : 'text-gray-600'}`}
            >
              {entry.isDirectory ? <FolderSearch className="w-4 h-4 text-yellow-500" /> : <span className="w-4 text-center text-gray-500 text-xs">📄</span>}
              <span className="flex-1">{entry.name}</span>
              {entry.isDirectory && <ChevronRight className="w-4 h-4 text-gray-500" />}
            </button>
          ))}
        </div>
        <div className="p-4 border-t border-gray-700 flex justify-end gap-2">
          <button
            onClick={() => setShowDirBrowser(false)}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-300"
          >
            取消
          </button>
          <button
            onClick={() => { setWorkspacePath(currentBrowsePath); setShowDirBrowser(false); toast.success(`已选择: ${currentBrowsePath}`); }}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 rounded text-sm text-white"
          >
            选择当前目录
          </button>
        </div>
      </div>
    </div>
  );

  const renderHistoryPanel = () => (
    <div className="w-64 bg-[#1E293B] rounded-lg border border-gray-700/50 flex flex-col">
      <div className="p-3 border-b border-gray-700/50 flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-200 flex items-center gap-2">
          <History className="w-4 h-4" />
          解析历史 ({history.length})
        </h4>
        <button
          onClick={loadHistory}
          disabled={loadingHistory}
          className="p-1 text-gray-400 hover:text-gray-200"
        >
          <RefreshCw className={`w-4 h-4 ${loadingHistory ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto max-h-[400px]">
        {loadingHistory ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : history.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-500">
            暂无历史记录
          </div>
        ) : history.map(item => (
          <div
            key={item.id}
            className={`p-3 border-b border-gray-700/30 cursor-pointer hover:bg-gray-700/30 ${selectedHistoryId === item.id ? 'bg-cyan-900/20 border-l-2 border-l-cyan-500' : ''}`}
            onClick={() => loadHistoryDetail(item.id)}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(item.extractedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteHistoryItem(item.id); }}
                className="p-1 text-gray-500 hover:text-red-400"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            <p className="text-sm text-gray-200 truncate mb-1">{item.summary || item.sessionId}</p>
            <p className="text-xs text-gray-500 truncate">{truncatePath(item.workspacePath)}</p>
            <div className="flex gap-2 mt-1 text-xs">
              <span className="text-cyan-400">{item.skillsCount}s</span>
              <span className="text-purple-400">{item.toolsCount}t</span>
              <span className="text-gray-500">{item.messageCount}m</span>
            </div>
          </div>
        ))}
      </div>
      {history.length > 0 && (
        <div className="p-3 border-t border-gray-700/50">
          <button
            onClick={clearAllHistory}
            className="w-full px-3 py-2 bg-red-900/30 hover:bg-red-900/50 rounded text-sm text-red-400 flex items-center justify-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            清空历史
          </button>
        </div>
      )}
    </div>
  );

  const renderResultPanel = () => (
    <div className="flex-1 space-y-4">
      {!extractResult ? (
        <div className="bg-[#1E293B] rounded-lg p-8 border border-gray-700/50 text-center">
          <p className="text-gray-500">选择历史记录或执行新解析查看结果</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div className="bg-blue-900/20 rounded p-3 border border-blue-700/30">
              <p className="text-blue-300 text-xs">Session ID</p>
              <p className="text-white font-mono truncate">{extractResult.sessionId}</p>
            </div>
            <div className="bg-green-900/20 rounded p-3 border border-green-700/30">
              <p className="text-green-300 text-xs">Skills</p>
              <p className="text-white font-bold">{extractResult.skills?.length || 0}</p>
            </div>
            <div className="bg-purple-900/20 rounded p-3 border border-purple-700/30">
              <p className="text-purple-300 text-xs">Tools</p>
              <p className="text-white font-bold">{extractResult.tools?.length || 0}</p>
            </div>
            <div className="bg-gray-700/20 rounded p-3 border border-gray-600/30">
              <p className="text-gray-300 text-xs">Messages</p>
              <p className="text-white font-bold">{extractResult.messageCount}</p>
            </div>
          </div>

          <div className="bg-[#1E293B] rounded-lg p-3 border border-gray-700/50">
            <p className="text-xs text-gray-400">Summary</p>
            <p className="text-sm text-gray-200">{extractResult.summary || '无'}</p>
          </div>

          {extractResult.skills?.length > 0 && (
            <div className="bg-[#1E293B] rounded-lg border border-cyan-700/30">
              <div className="p-3 border-b border-gray-700/50 flex items-center justify-between">
                <h4 className="text-sm font-medium text-cyan-400">Skills 调用 ({extractResult.skills.length})</h4>
                <p className="text-xs text-gray-500">连续加载的 skills 共享 reasoning/output</p>
              </div>
              <div className="divide-y divide-gray-700/30 max-h-[300px] overflow-y-auto">
                {extractResult.skills.map((skill, i) => {
                  const hasSharedOutput = skill.reasoning?.length > 0 || skill.textOutputs?.length > 0;
                  const sameOutputSkills = extractResult.skills.filter(s => 
                    s.reasoning?.length > 0 && skill.reasoning?.length > 0 &&
                    s.reasoning[0] === skill.reasoning[0]
                  );
                  return (
                    <div key={i} className="p-3">
                      <div className="w-full flex items-center justify-between">
                        <button
                          onClick={() => setExpandedSkill(expandedSkill === i ? null : i)}
                          className="flex items-center gap-2 text-left"
                        >
                          {expandedSkill === i ? (
                            <ChevronDown className="w-4 h-4 text-cyan-400" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-gray-400" />
                          )}
                          <span className="text-sm font-medium text-cyan-300">{skill.toolName}</span>
                          <span className="text-xs text-gray-500">
                            {new Date(skill.startTime).toLocaleTimeString()}
                          </span>
                          {sameOutputSkills.length > 1 && (
                            <span className="text-xs text-blue-400 bg-blue-900/30 px-1 rounded">
                              +{sameOutputSkills.length - 1}
                            </span>
                          )}
                        </button>
                        <button
                          onClick={() => copyToClipboard(formatJson(skill))}
                          className="p-1 text-gray-400 hover:text-cyan-400"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                      {expandedSkill === i && (
                        <div className="mt-3 space-y-3">
                          <div>
                            <p className="text-xs text-gray-500 mb-1">Input (skill 名称)</p>
                            <pre className="text-xs text-gray-300 bg-[#0B1120] p-2 rounded overflow-x-auto">
                              {truncateJson(skill.input, 300)}
                            </pre>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 mb-1">Skill 定义内容</p>
                            <pre className="text-xs text-cyan-300 bg-[#0B1120] p-2 rounded overflow-x-auto max-h-[150px] overflow-y-auto">
                              {skill.result ? truncateJson(skill.result, 500) : '无'}
                            </pre>
                          </div>
                          {sameOutputSkills.length > 1 && (
                            <div className="text-xs text-blue-400 bg-blue-900/20 p-2 rounded">
                              此 skill 与 {sameOutputSkills.length - 1} 个其他 skills 连续加载，共享后续输出
                            </div>
                          )}
                          {skill.reasoning?.length > 0 && (
                            <div>
                              <p className="text-xs text-yellow-500 mb-1 flex items-center gap-1">
                                <Brain className="w-3 h-3" />
                                Reasoning ({skill.reasoning.length})
                                {sameOutputSkills.length > 1 && <span className="text-blue-400 ml-2">共享</span>}
                              </p>
                              <div className="bg-[#0B1120] p-2 rounded max-h-[200px] overflow-y-auto">
                                {skill.reasoning.map((r, ri) => (
                                  <p key={ri} className="text-xs text-yellow-200 mb-1 last:mb-0 whitespace-pre-wrap">
                                    {r.length > 200 ? r.slice(0, 200) + '...' : r}
                                  </p>
                                ))}
                              </div>
                            </div>
                          )}
                          {skill.textOutputs?.length > 0 && (
                            <div>
                              <p className="text-xs text-green-500 mb-1 flex items-center gap-1">
                                <MessageSquare className="w-3 h-3" />
                                Output ({skill.textOutputs.length})
                                {sameOutputSkills.length > 1 && <span className="text-blue-400 ml-2">共享</span>}
                              </p>
                              <div className="bg-[#0B1120] p-2 rounded max-h-[200px] overflow-y-auto">
                                {skill.textOutputs.map((t, ti) => (
                                  <p key={ti} className="text-xs text-green-200 mb-2 last:mb-0 whitespace-pre-wrap">
                                    {t.length > 300 ? t.slice(0, 300) + '...' : t}
                                  </p>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="text-xs text-gray-400">
                            耗时: {new Date(skill.endTime).getTime() - new Date(skill.startTime).getTime()}ms
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {extractResult.tools?.length > 0 && (
            <div className="bg-[#1E293B] rounded-lg border border-purple-700/30">
              <div className="p-3 border-b border-gray-700/50">
                <h4 className="text-sm font-medium text-purple-400">Tools 调用 ({extractResult.tools.length})</h4>
              </div>
              <div className="divide-y divide-gray-700/30 max-h-[300px] overflow-y-auto">
                {extractResult.tools.map((tool, i) => (
                  <div key={i} className="p-3">
                    <div className="w-full flex items-center justify-between">
                      <button
                        onClick={() => setExpandedTool(expandedTool === i ? null : i)}
                        className="flex items-center gap-2 text-left"
                      >
                        {expandedTool === i ? (
                          <ChevronDown className="w-4 h-4 text-purple-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                        )}
                        <span className="text-sm font-medium text-purple-300">{tool.toolName}</span>
                        <span className="text-xs text-gray-500">
                          {new Date(tool.startTime).toLocaleTimeString()}
                        </span>
                      </button>
                      <button
                        onClick={() => copyToClipboard(formatJson(tool))}
                        className="p-1 text-gray-400 hover:text-purple-400"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                    {expandedTool === i && (
                      <div className="mt-3 space-y-2">
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Input</p>
                          <pre className="text-xs text-gray-300 bg-[#0B1120] p-2 rounded overflow-x-auto">
                            {truncateJson(tool.input, 500)}
                          </pre>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Result</p>
                          <pre className="text-xs text-green-300 bg-[#0B1120] p-2 rounded overflow-x-auto max-h-[200px] overflow-y-auto">
                            {tool.result ? truncateJson(tool.result, 1000) : '无结果'}
                          </pre>
                        </div>
                        <div className="text-xs text-gray-400">
                          耗时: {new Date(tool.endTime).getTime() - new Date(tool.startTime).getTime()}ms
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {extractResult.reasoning?.length > 0 && (
            <div className="bg-[#1E293B] rounded-lg border border-yellow-700/30">
              <div className="p-3 border-b border-gray-700/50">
                <h4 className="text-sm font-medium text-yellow-400 flex items-center gap-2">
                  <Brain className="w-4 h-4" />
                  全局 Reasoning ({extractResult.reasoning.length})
                </h4>
              </div>
              <div className="p-3 max-h-[200px] overflow-y-auto">
                {extractResult.reasoning.map((r, i) => (
                  <div key={i} className="mb-2 last:mb-0">
                    <p className="text-xs text-gray-500 mb-1">
                      {new Date(r.startTime).toLocaleTimeString()}
                    </p>
                    <p className="text-xs text-yellow-200 whitespace-pre-wrap bg-[#0B1120] p-2 rounded">
                      {r.content.length > 300 ? r.content.slice(0, 300) + '...' : r.content}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {extractResult.textOutputs?.length > 0 && (
            <div className="bg-[#1E293B] rounded-lg border border-green-700/30">
              <div className="p-3 border-b border-gray-700/50">
                <h4 className="text-sm font-medium text-green-400 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  全局 Output ({extractResult.textOutputs.length})
                </h4>
              </div>
              <div className="p-3 max-h-[200px] overflow-y-auto">
                {extractResult.textOutputs.map((t, i) => (
                  <div key={i} className="mb-2 last:mb-0">
                    <p className="text-xs text-gray-500 mb-1">
                      {new Date(t.startTime).toLocaleTimeString()}
                    </p>
                    <p className="text-xs text-green-200 whitespace-pre-wrap bg-[#0B1120] p-2 rounded">
                      {t.content.length > 400 ? t.content.slice(0, 400) + '...' : t.content}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-gray-800 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-medium text-gray-400">完整 JSON</h4>
              <button
                onClick={() => copyToClipboard(formatJson(extractResult))}
                className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-cyan-400"
              >
                <Copy className="w-3 h-3" />
                复制
              </button>
            </div>
            <pre className="text-xs text-gray-300 bg-[#0B1120] p-2 rounded overflow-x-auto max-h-[200px] overflow-y-auto">
              {truncateJson(extractResult, 5000)}
            </pre>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        {renderHistoryPanel()}
        
        <div className="flex-1 flex flex-col gap-4">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('history')}
              className={`px-4 py-2 rounded-md text-sm flex items-center gap-2 ${activeTab === 'history' ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            >
              <History className="w-4 h-4" />
              查看历史
            </button>
            <button
              onClick={() => setActiveTab('new')}
              className={`px-4 py-2 rounded-md text-sm flex items-center gap-2 ${activeTab === 'new' ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            >
              <Play className="w-4 h-4" />
              新解析
            </button>
          </div>

          {activeTab === 'new' && (
            <div className="bg-[#1E293B] rounded-lg p-4 border border-gray-700/50">
              <h3 className="text-sm font-semibold text-gray-100 mb-3">执行新解析</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={workspacePath}
                  onChange={(e) => setWorkspacePath(e.target.value)}
                  placeholder={platform === 'windows' ? 'E:/work/202605/project' : '/home/user/project'}
                  className="flex-1 px-3 py-2 bg-[#0B1120] border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm text-gray-100"
                />
                <button
                  onClick={() => {
                    if (platform === 'windows') {
                      browseDirectory('root://');
                    } else {
                      browseDirectory('/');
                    }
                    setShowDirBrowser(true);
                  }}
                  className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-md text-sm text-gray-300 flex items-center gap-1"
                >
                  {platform === 'windows' ? <HardDrive className="w-4 h-4" /> : <FolderSearch className="w-4 h-4" />}
                  {platform === 'windows' ? '磁盘' : '目录'}
                </button>
                <button
                  onClick={handleSessionExtract}
                  disabled={isExtracting || !workspacePath}
                  className="px-4 py-2 bg-cyan-600 text-white rounded-md hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isExtracting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                  解析
                </button>
              </div>
            </div>
          )}

          {renderResultPanel()}
        </div>
      </div>

      {renderDirBrowser()}
    </div>
  );
}