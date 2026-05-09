'use client';

import { useEffect, useState, useRef, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Send, RefreshCw, Settings, Terminal, FileText,
  FolderOpen, Trash2, Plus, Loader2, Square, X, ArrowRight, MessageSquare
} from 'lucide-react';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { PermissionRequest } from '@/components/chat/PermissionRequest';
import StatusBar from '@/components/chat/StatusBar';
import TerminalComponent from '@/components/terminal/TerminalComponent';
import ClaudeFileBrowser from '@/components/files/ClaudeFileBrowser';
import ClaudeFileEditor from '@/components/files/ClaudeFileEditor';

interface Session {
  id: string;
  summary: string;
  lastActivity: string;
  messageCount?: number;
  model?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | any[];
  timestamp?: string;
  thinking?: string;
  _raw?: any;
}

interface ClaudeProject {
  name: string;
  path: string;
  displayName?: string;
  sessions: Session[];
}

type PanelType = 'chat' | 'terminal' | 'files';

interface SelectedFile {
  path: string;
  language: string;
}

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export default function ClaudeSessionPage({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project: projectName } = use(params);
  const router = useRouter();
  
  const [project, setProject] = useState<ClaudeProject | null>(null);
  const [projectPath, setProjectPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionsTotal, setSessionsTotal] = useState(0);
  const [sessionsOffset, setSessionsOffset] = useState(0);
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);
  
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activePanel, setActivePanel] = useState<PanelType>('chat');
  const [terminalSessionId, setTerminalSessionId] = useState('');
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [fileEditorOpen, setFileEditorOpen] = useState(false);
  const [pendingToolCall, setPendingToolCall] = useState<ToolCall | null>(null);
  const [toolCallHistory, setToolCallHistory] = useState<ToolCall[]>([]);

  const loadProject = async () => {
    try {
      const token = localStorage.getItem('token');
      
      // 调用项目详情 API 获取完整会话列表
      const projName = decodeURIComponent(projectName);
      const response = await fetch(`/api/claude/${encodeURIComponent(projName)}?limit=50&offset=0`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (response.status === 401) {
          router.push('/login');
          return;
        }
        throw new Error('获取项目失败');
      }

      const data = await response.json();
      
      setSessions(data.sessions || []);
      setSessionsTotal(data.total || 0);
      setSessionsOffset(data.sessions?.length || 0);
      
      // 获取项目路径
      const projectResponse = await fetch('/api/claude', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (projectResponse.ok) {
        const projectData = await projectResponse.json();
        const current = (projectData.projects || []).find((p: any) => p.name === projName);
        if (current) {
          setProject(current);
          setProjectPath(current.path);
        }
      }
      
      setTerminalSessionId(`term-${Date.now()}`);
      
      const sessionId = new URLSearchParams(window.location.search).get('session');
      if (sessionId && data.sessions) {
        const session = data.sessions.find((s: any) => s.id === sessionId);
        if (session) {
          setCurrentSession(session);
          loadMessages(projName, session.id);
        }
      }
    } catch (err) {
      setError('加载失败');
    } finally {
      setLoading(false);
    }
  };
  
  // 格式化时间
  const formatTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return `${Math.floor(diff / 86400000)} 天前`;
  };
  
  const loadMoreSessions = async () => {
    if (loadingMoreSessions) return;
    setLoadingMoreSessions(true);
    
    try {
      const token = localStorage.getItem('token');
      const projName = decodeURIComponent(projectName);
      const response = await fetch(`/api/claude/${encodeURIComponent(projName)}?limit=50&offset=${sessionsOffset}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (response.ok) {
        const data = await response.json();
        setSessions(prev => [...prev, ...(data.sessions || [])]);
        setSessionsOffset(prev => prev + (data.sessions?.length || 0));
      }
    } catch (err) {
      console.error('加载更多会话失败:', err);
    } finally {
      setLoadingMoreSessions(false);
    }
  };

  const loadMessages = async (projName: string, sessionId: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/claude/${encodeURIComponent(projName)}/${sessionId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        const rawMessages = data.messages || [];
        
        const converted = rawMessages.map((msg: any) => ({
          id: msg.id || msg.uuid || Math.random().toString(),
          role: msg.role || (msg.type === 'user' ? 'user' : 'assistant'),
          content: msg.content || msg.message?.content || '',
          timestamp: msg.timestamp || msg.createdAt,
          thinking: msg.thinking,
          _raw: msg,
        }));
        
        setMessages(converted);
      }
    } catch (err) {
      console.error('加载消息失败:', err);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || sending) return;

    const userMessage = input.trim();
    setInput('');
    setSending(true);
    setStreaming(true);

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);

    try {
      const token = localStorage.getItem('token');
      const projName = decodeURIComponent(projectName);
      const sessionId = currentSession?.id || '';
      
      // SSE 流式请求
      const response = await fetch(`/api/claude/${encodeURIComponent(projName)}/stream?sessionId=${encodeURIComponent(sessionId)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: userMessage }),
      });

      if (!response.ok) {
        throw new Error('发送失败');
      }

      const assistantMsg: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);
      
      let fullContent = '';
      const currentMsgIndex = messages.length + 1;

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const event = JSON.parse(data);
                
                if (event.type === 'content') {
                  fullContent += event.content;
                  setMessages(prev => {
                    const updated = [...prev];
                    if (updated[currentMsgIndex]) {
                      updated[currentMsgIndex] = { ...updated[currentMsgIndex], content: fullContent };
                    }
                    return updated;
                  });
                } else if (event.type === 'thinking') {
                  setMessages(prev => {
                    const updated = [...prev];
                    if (updated[currentMsgIndex]) {
                      updated[currentMsgIndex] = { ...updated[currentMsgIndex], thinking: event.content };
                    }
                    return updated;
                  });
                } else if (event.type === 'session' && event.session && !currentSession) {
                  setCurrentSession(event.session);
                  setSessions(prev => [event.session, ...prev]);
                  router.replace(`/dashboard/claude/${encodeURIComponent(projectName)}?session=${event.session.id}`);
                } else if (event.type === 'tool_use') {
                  // 显示权限请求弹窗
                  setPendingToolCall({
                    id: `tool-${Date.now()}`,
                    name: event.toolName || event.name || 'unknown',
                    input: event.input || {},
                  });
                } else if (event.type === 'tool_result') {
                  // 工具执行完成，添加到历史
                  setPendingToolCall(null);
                  setToolCallHistory(prev => [...prev, {
                    id: `tool-${Date.now()}`,
                    name: event.toolName || event.name || 'unknown',
                    input: {},
                  }]);
                }
              } catch { /* ignore */ }
            }
          }
        }
      }

      loadProject();
    } catch (err) {
      alert('发送失败');
    } finally {
      setSending(false);
      setStreaming(false);
    }
  };

  // 处理工具调用权限
  const handleApproveTool = async () => {
    if (!pendingToolCall) return;
    // TODO: 发送工具调用结果到后端
    setToolCallHistory(prev => [...prev, pendingToolCall]);
    setPendingToolCall(null);
  };

  const handleRejectTool = () => {
    if (!pendingToolCall) return;
    setPendingToolCall(null);
  };

  const createSession = async () => {
    try {
      const token = localStorage.getItem('token');
      const projName = decodeURIComponent(projectName);
      
      const response = await fetch(`/api/claude/${encodeURIComponent(projName)}/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setCurrentSession(data.session);
        setMessages([]);
        loadProject();
        router.replace(`/dashboard/claude/${encodeURIComponent(projectName)}?session=${data.session.id}`);
      }
    } catch (err) {
      alert('创建会话失败');
    }
  };

  const deleteSession = async (sessionId: string) => {
    if (!confirm('确定删除该会话？')) return;

    try {
      const token = localStorage.getItem('token');
      const projName = decodeURIComponent(projectName);
      
      await fetch(`/api/claude/${encodeURIComponent(projName)}/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (currentSession?.id === sessionId) {
        setCurrentSession(null);
        setMessages([]);
        router.replace(`/dashboard/claude/${encodeURIComponent(projectName)}`);
      }
      loadProject();
    } catch (err) {
      alert('删除失败');
    }
  };

  useEffect(() => {
    loadProject();
  }, [projectName]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <p className="text-red-500 mb-4">{error}</p>
        <button onClick={() => router.push('/dashboard/claude')} className="px-4 py-2 bg-blue-600 text-white rounded-md">
          返回
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* 侧边栏 */}
      <div className={`${sidebarOpen ? 'w-72' : 'w-0'} bg-white border-r transition-all overflow-hidden flex flex-col shadow-sm`}>
        <div className="p-4 border-b bg-gray-50">
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => router.push('/dashboard/claude')} className="flex items-center text-gray-600 hover:text-gray-900 transition-colors">
              <ArrowLeft size={18} className="mr-2" />
              <span className="font-medium text-sm">返回项目</span>
            </button>
            <button onClick={() => setSidebarOpen(false)} className="p-1 text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>
          <h2 className="font-semibold text-gray-900 truncate" title={project?.displayName || project?.name}>
            {project?.displayName || project?.name}
          </h2>
          <p className="text-xs text-gray-500 truncate mt-0.5">{projectPath}</p>
        </div>
        
        <button 
          onClick={createSession} 
          className="mx-4 mt-4 flex items-center justify-center space-x-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
        >
          <Plus size={18} />
          <span>新建会话</span>
        </button>
        
        <div className="flex items-center justify-between px-4 mt-4 mb-2">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">会话列表</span>
          <span className="text-xs text-gray-400">{sessionsTotal} 个会话</span>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <MessageSquare size={32} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">暂无会话</p>
              <p className="text-xs text-gray-400 mt-1">点击上方按钮创建新会话</p>
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className={`group px-4 py-3 cursor-pointer hover:bg-gray-50 border-l-3 transition-colors ${
                  currentSession?.id === session.id ? 'bg-blue-50 border-l-3 border-blue-500' : 'border-l-3 border-transparent'
                }`}
                onClick={() => {
                  setCurrentSession(session);
                  loadMessages(project!.name, session.id);
                  router.replace(`/dashboard/claude/${encodeURIComponent(projectName)}?session=${session.id}`);
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm truncate flex-1 text-gray-700">{session.summary || '新会话'}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 text-red-500 hover:bg-red-50 rounded transition-all"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-gray-400">{session.messageCount || 0} 条消息</span>
                  {session.lastActivity && (
                    <span className="text-xs text-gray-400">{formatTime(session.lastActivity)}</span>
                  )}
                </div>
              </div>
            ))
          )}
          
          {/* 加载更多按钮 */}
          {sessionsOffset < sessionsTotal && (
            <div className="p-4 border-t bg-gray-50">
              <button
                onClick={loadMoreSessions}
                disabled={loadingMoreSessions}
                className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {loadingMoreSessions ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>加载中...</span>
                  </>
                ) : (
                  <>
                    <span>加载更多</span>
                    <span className="text-xs text-gray-400">({sessionsOffset}/{sessionsTotal})</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col">
        {/* 顶部工具栏 */}
        <div className="h-14 bg-white border-b flex items-center justify-between px-6 shadow-sm">
          <div className="flex items-center space-x-4">
            {!sidebarOpen && (
              <button onClick={() => setSidebarOpen(true)} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">
                <FolderOpen size={18} />
              </button>
            )}
            <div>
              <h1 className="font-semibold text-gray-900">{currentSession?.summary || '新会话'}</h1>
              {currentSession && (
                <p className="text-xs text-gray-500">{currentSession.messageCount || 0} 条消息</p>
              )}
            </div>
          </div>
          
          {/* 面板切换 */}
          <div className="flex items-center space-x-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setActivePanel('chat')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activePanel === 'chat' ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              聊天
            </button>
            <button
              onClick={() => setActivePanel('terminal')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activePanel === 'terminal' ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              终端
            </button>
            <button
              onClick={() => setActivePanel('files')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activePanel === 'files' ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              文件
            </button>
          </div>
          
          <div className="flex items-center space-x-2">
            <button onClick={() => loadProject()} className="p-2 text-gray-500 hover:bg-gray-100 rounded" title="刷新">
              <RefreshCw size={18} />
            </button>
            <button className="p-2 text-gray-500 hover:bg-gray-100 rounded" title="设置">
              <Settings size={18} />
            </button>
          </div>
        </div>

{/* 内容区域 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 聊天面板 */}
          {activePanel === 'chat' && (
            <>
              <div className="flex-1 overflow-hidden">
                <ChatContainer messages={messages} isStreaming={streaming} className="h-full" />
              </div>
              
              {/* 权限请求弹窗 */}
              {pendingToolCall && (
                <div className="p-3 bg-white border-t shadow-sm">
                  <PermissionRequest
                    toolName={pendingToolCall.name}
                    toolInput={pendingToolCall.input}
                    onApprove={handleApproveTool}
                    onReject={handleRejectTool}
                    isPending={sending}
                    className="max-w-2xl mx-auto"
                  />
                </div>
              )}
              
              <div className="p-3 bg-white border-t shadow-sm">
                <div className="flex items-end space-x-3 max-w-4xl mx-auto">
                  <div className="flex-1">
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="输入消息... (Enter 发送)"
                      rows={1}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      style={{ minHeight: '48px', maxHeight: '120px' }}
                    />
                  </div>
                  <button
                    onClick={sendMessage}
                    disabled={!input.trim() || sending}
                    className="px-5 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 shadow-sm"
                  >
                    {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                    <span>发送</span>
                  </button>
                </div>
              </div>
            </>
          )}

          {/* 终端面板 */}
          {activePanel === 'terminal' && (
            <div className="flex-1 flex flex-col bg-[#1e1e1e]">
              <div className="h-10 bg-[#252526] flex items-center justify-between px-4 border-b border-[#3c3c3c] shrink-0">
                <span className="text-gray-400 text-sm">终端</span>
                <button onClick={() => setActivePanel('chat')} className="text-gray-400 hover:text-white">
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1">
                <TerminalComponent
                  sessionId={terminalSessionId}
                  cwd={projectPath}
                  token={localStorage.getItem('token') || ''}
                />
              </div>
            </div>
          )}

          {/* 文件面板 */}
          {activePanel === 'files' && (
            <div className="flex-1 flex flex-col bg-white">
              <div className="h-10 bg-gray-50 flex items-center justify-between px-4 border-b shrink-0">
                <div className="flex items-center space-x-2">
                  {fileEditorOpen ? (
                    <>
                      <button onClick={() => { setFileEditorOpen(false); setSelectedFile(null); }} className="text-gray-400 hover:text-gray-600">
                        <ArrowLeft size={16} />
                      </button>
                      <span className="text-gray-700 text-sm font-medium truncate max-w-xs">{selectedFile?.path}</span>
                    </>
                  ) : (
                    <span className="text-gray-700 text-sm font-medium">文件浏览器</span>
                  )}
                </div>
                <button onClick={() => setActivePanel('chat')} className="text-gray-400 hover:text-gray-600">
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                {fileEditorOpen && selectedFile ? (
                  <ClaudeFileEditor
                    projectName={decodeURIComponent(projectName)}
                    filePath={selectedFile.path}
                    language={selectedFile.language}
                    onClose={() => { setFileEditorOpen(false); setSelectedFile(null); }}
                    onSave={(path) => console.log('File saved:', path)}
                  />
                ) : (
                  <ClaudeFileBrowser
                    projectName={decodeURIComponent(projectName)}
                    projectPath={projectPath}
                    selectedPath={selectedFile?.path}
                    onFileSelect={(path, language) => {
                      setSelectedFile({ path, language });
                      setFileEditorOpen(true);
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* 状态栏 */}
        <StatusBar
          cwd={projectPath}
          model={currentSession?.model}
          provider="claude"
          sessionCount={sessions.length}
        />
      </div>
    </div>
  );
}
