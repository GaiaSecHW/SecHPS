'use client';

import { useEffect, useState, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Copy,
  Clock,
  Square,
  Trash2,
  ArrowLeft,
  X,
  ChevronDown,
  ChevronRight,
  Code,
  FileText,
  Folder,
  GitBranch,
  Info,
  CheckCircle2,
  Circle,
  Loader2,
  ListTodo,
  FolderOpen,
  MessageSquare,
  ChevronUp,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';

export default function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const evaluationId = searchParams.get('evaluationId');

  const [evaluation, setEvaluation] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedMessage, setSelectedMessage] = useState<any>(null);
  const [messageDetail, setMessageDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [sessionDetail, setSessionDetail] = useState<any>(null);
  const [todos, setTodos] = useState<any[]>([]);
  const [sdkProjects, setSdkProjects] = useState<any[]>([]);
  const [sdkCurrentProject, setSdkCurrentProject] = useState<any>(null);
  const [loadingSdkProjects, setLoadingSdkProjects] = useState(false);
  const [childrenSessions, setChildrenSessions] = useState<any[]>([]);
  const [selectedChildSession, setSelectedChildSession] = useState<string | null>(null);
  const [isTodosExpanded, setIsTodosExpanded] = useState(true);
  const [isMessagesExpanded, setIsMessagesExpanded] = useState(false);
  const [isChildrenExpanded, setIsChildrenExpanded] = useState(true);

  useEffect(() => {
    if (evaluationId) {
      fetchEvaluation();
      fetchMessages();
    }
  }, [evaluationId]);

  useEffect(() => {
    if (evaluation?.opencodeSessionId) {
      fetchSessionDetail();
      fetchTodos();
      fetchSdkProjects();
      fetchChildrenSessions();
    }
  }, [evaluation?.opencodeSessionId]);

  useEffect(() => {
    if (!evaluation?.opencodeSessionId) return;

    const interval = setInterval(() => {
      fetchTodos();
      fetchSessionDetail();
      fetchChildrenSessions();
    }, 10000);

    return () => clearInterval(interval);
  }, [evaluation?.opencodeSessionId]);

  const fetchEvaluation = async () => {
    if (!evaluationId) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/evaluations/${evaluationId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || '获取评估会话失败');
        setLoading(false);
        return;
      }

      const data = await response.json();
      setEvaluation(data.evaluation);
      setLoading(false);
    } catch (err) {
      console.error('Fetch evaluation error:', err);
      setError('网络错误，请重试');
      setLoading(false);
    }
  };

  const fetchMessages = async () => {
    console.log('[fetchMessages] evaluationId:', evaluationId);
    if (!evaluationId) {
      console.log('[fetchMessages] No evaluationId, returning');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      console.log('[fetchMessages] Fetching from:', `/api/evaluations/${evaluationId}/messages`);
      const response = await fetch(`/api/evaluations/${evaluationId}/messages`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      console.log('[fetchMessages] Response status:', response.status, response.statusText);
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Messages] Failed to fetch:', response.status, errorText);
        return;
      }

      const data = await response.json();
      setMessages(data.messages || []);
      console.log('[Messages] Fetched', data.messages?.length || 0, 'messages');
    } catch (err) {
      console.error('[Messages] Error fetching:', err);
    }
  };

  const fetchSessionDetail = async () => {
    if (!evaluation?.opencodeSessionId) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/sessions/${evaluation.opencodeSessionId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        console.error('[Session] Failed to fetch session detail:', response.status);
        return;
      }

      const data = await response.json();
      setSessionDetail(data.session);
      console.log('[Session] Detail fetched:', data.session?.id);
    } catch (err) {
      console.error('[Session] Error fetching session detail:', err);
    }
  };

  const fetchTodos = async () => {
    if (!evaluation?.opencodeSessionId) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `/api/sessions/${evaluation.opencodeSessionId}/todo`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        console.error('[TODO] Failed to fetch todos:', response.status);
        return;
      }

      const data = await response.json();
      setTodos(data.todos || []);
      console.log('[TODO] Fetched', data.todos?.length || 0, 'todos');
    } catch (err) {
      console.error('[TODO] Error fetching todos:', err);
    }
  };

  const fetchSdkProjects = async () => {
    if (!evaluationId) return;

    setLoadingSdkProjects(true);
    try {
      const token = localStorage.getItem('token');

      const [listResponse, currentResponse] = await Promise.all([
        fetch(`/api/projects/sdk/list?evaluationId=${evaluationId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/projects/sdk/current?evaluationId=${evaluationId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (listResponse.ok) {
        const listData = await listResponse.json();
        setSdkProjects(listData.projects || []);
        console.log('[SDK Projects] List:', listData.projects?.length || 0);
      }

      if (currentResponse.ok) {
        const currentData = await currentResponse.json();
        setSdkCurrentProject(currentData.project || null);
        console.log('[SDK Projects] Current:', currentData.project);
      }
    } catch (err) {
      console.error('[SDK Projects] Error fetching:', err);
    } finally {
      setLoadingSdkProjects(false);
    }
  };

  const fetchChildrenSessions = async () => {
    if (!evaluation?.opencodeSessionId) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `/api/sessions/${evaluation.opencodeSessionId}/children`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        console.error('[Children] Failed to fetch children sessions:', response.status);
        return;
      }

      const data = await response.json();
      console.log('[Children] Received children sessions:', data.children?.length || 0, data.children);
      setChildrenSessions(data.children || []);
    } catch (err) {
      console.error('[Children] Error fetching:', err);
    }
  };

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content);
  };

  const handleMessageClick = async (message: any) => {
    if (selectedMessage?.id === message.id) {
      setSelectedMessage(null);
      setMessageDetail(null);
      return;
    }

    setSelectedMessage(message);
    setLoadingDetail(true);
    setMessageDetail(null);

    try {
      const token = localStorage.getItem('token');
      const sessionId = evaluation?.opencodeSessionId;
      const response = await fetch(
        `/api/messages/${message.id}?sessionId=${sessionId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        const data = await response.json();
        console.error('获取消息详情失败:', data.error);
        setMessageDetail({
          info: message,
          parts: message.content || [],
        });
        return;
      }

      const data = await response.json();
      setMessageDetail(data.message);
    } catch (err) {
      console.error('获取消息详情失败:', err);
      setMessageDetail({
        info: message,
        parts: message.content || [],
      });
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleStopEvaluation = async () => {
    if (!evaluationId || !confirm('确定要停止此评估会话吗？')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/evaluations/${evaluationId}/stop`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || '停止会话失败');
        return;
      }

      fetchEvaluation();
      fetchSessionDetail();
      alert('评估会话已停止');
    } catch (err) {
      console.error('Stop evaluation error:', err);
      alert('停止会话失败');
    }
  };

  const handleAskProgress = async () => {
    if (!evaluationId) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/evaluations/${evaluationId}/ask-progress`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || '询问进展失败');
        return;
      }

      alert('已发送询问进展消息');
      fetchMessages();
    } catch (err) {
      console.error('Ask progress error:', err);
      alert('询问进展失败');
    }
  };

  const handleDeleteEvaluation = async () => {
    if (!evaluationId || !confirm('确定要删除此评估会话吗？此操作不可恢复。')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/evaluations/${evaluationId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || '删除会话失败');
        return;
      }

      router.push('/dashboard/sessions');
      alert('评估会话已删除');
    } catch (err) {
      console.error('Delete evaluation error:', err);
      alert('删除会话失败');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <X className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">加载失败</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => router.push('/dashboard/sessions')}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            返回列表
          </button>
        </div>
      </div>
    );
  }

  if (!evaluation) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Info className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">未找到评估会话</h2>
          <button
            onClick={() => router.push('/dashboard/sessions')}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            返回列表
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.push('/dashboard/sessions')}
              className="text-gray-400 hover:text-gray-600"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">
                {evaluation.project?.name || '评估会话详情'}
              </h1>
              <p className="text-sm text-gray-500">
                ID: {evaluation.id}
              </p>
            </div>
            <div className="flex items-center space-x-2">
              {evaluation.status && (
                <span
                  className={`ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    evaluation.status === 'completed'
                      ? 'bg-green-100 text-green-800'
                      : evaluation.status === 'running'
                      ? 'bg-blue-100 text-blue-800'
                      : evaluation.status === 'failed'
                      ? 'bg-red-100 text-red-800'
                      : evaluation.status === 'cancelled'
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {evaluation.status === 'running'
                    ? '运行中'
                    : evaluation.status === 'completed'
                    ? '已完成'
                    : evaluation.status === 'failed'
                    ? '失败'
                    : evaluation.status === 'cancelled'
                    ? '已取消'
                    : evaluation.status}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              {evaluation.status === 'running' && (
                <>
                  <button
                    onClick={handleAskProgress}
                    className="flex items-center space-x-1 px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded border border-blue-200"
                  >
                    <MessageSquare size={16} />
                    <span>询问进展</span>
                  </button>
                  <button
                    onClick={handleStopEvaluation}
                    className="flex items-center space-x-1 px-3 py-1.5 text-sm font-medium text-orange-600 hover:text-orange-800 hover:bg-orange-50 rounded border border-orange-200"
                  >
                    <Square size={16} />
                    <span>停止</span>
                  </button>
                </>
              )}
              {evaluation.status !== 'running' && (
                <button
                  onClick={handleDeleteEvaluation}
                  className="flex items-center space-x-1 px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-800 hover:bg-red-50 rounded border border-red-200"
                >
                  <Trash2 size={16} />
                  <span>删除</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: TODOs + Children + Messages */}
        <div
          className={`${
            selectedMessage ? 'w-1/2' : 'flex-1'
          } bg-gray-50 overflow-y-auto transition-all duration-300`}
        >
          <div className="p-4">
            {/* TODO List */}
            <div className="mb-6">
              <button
                onClick={() => setIsTodosExpanded(!isTodosExpanded)}
                className="w-full flex items-center justify-between text-lg font-semibold text-gray-900 mb-3 hover:text-gray-700 transition-colors"
              >
                <div className="flex items-center">
                  <ListTodo size={18} className="mr-2 text-blue-600" />
                  任务列表 ({todos.length})
                </div>
                {isTodosExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>
              {isTodosExpanded && (
                todos.length === 0 ? (
                  <div className="text-center py-4 bg-gray-100 rounded-lg border border-gray-200">
                    <p className="text-sm text-gray-500">暂无任务</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {todos.map((todo) => (
                      <TodoItem key={todo.id} todo={todo} />
                    ))}
                  </div>
                )
              )}
            </div>

            {/* Children Sessions */}
            {childrenSessions.length > 0 && (
              <div className="mb-6">
                <button
                  onClick={() => setIsChildrenExpanded(!isChildrenExpanded)}
                  className="w-full flex items-center justify-between text-lg font-semibold text-gray-900 mb-3 hover:text-gray-700 transition-colors"
                >
                  <div className="flex items-center">
                    <GitBranch size={18} className="mr-2 text-purple-600" />
                    子会话 ({childrenSessions.length})
                  </div>
                  {isChildrenExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </button>
                {isChildrenExpanded && (
                  <div className="space-y-2">
                    {childrenSessions.map((child) => (
                      <div
                        key={child.id}
                        className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedChildSession === child.id
                            ? 'bg-purple-50 border-purple-300'
                            : 'bg-white border-gray-200 hover:border-purple-200'
                        }`}
                        onClick={() =>
                          setSelectedChildSession(
                            selectedChildSession === child.id ? null : child.id
                          )
                        }
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {child.title || '无标题'}
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                              ID: {child.id.substring(0, 20)}...
                            </p>
                          </div>
                          <div className="flex items-center space-x-2 ml-2">
                            {child.status && (
                              <span
                                className={`text-xs px-2 py-0.5 rounded ${
                                  child.status === 'active'
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-gray-100 text-gray-600'
                                }`}
                              >
                                {child.status}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Messages */}
            <div className="mb-6">
              <button
                onClick={() => setIsMessagesExpanded(!isMessagesExpanded)}
                className="w-full flex items-center justify-between text-lg font-semibold text-gray-900 mb-4 hover:text-gray-700 transition-colors"
              >
                <div className="flex items-center">
                  <MessageSquare size={18} className="mr-2 text-green-600" />
                  消息记录 ({messages.length})
                </div>
                {isMessagesExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>
              {isMessagesExpanded && (
                messages.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-500">暂无消息</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages
                      .filter((message) => {
                        let textContent = '';
                        if (typeof message.content === 'string') {
                          textContent = message.content;
                        } else if (Array.isArray(message.content)) {
                          textContent = message.content
                            .filter((part: any) => part.type === 'text')
                            .map((part: any) => part.text || '')
                            .join('\n');
                          if (!textContent.trim()) {
                            textContent = message.content
                              .filter((part: any) => part.type === 'reasoning')
                              .map((part: any) => part.reasoning || part.text || '')
                              .join('\n');
                          }
                        }
                        return textContent.trim().length > 0;
                      })
                      .map((message) => (
                        <MessageBubble
                          key={message.id}
                          message={message}
                          isSelected={selectedMessage?.id === message.id}
                          onClick={() => handleMessageClick(message)}
                          onCopy={() =>
                            handleCopy(
                              typeof message.content === 'string'
                                ? message.content
                                : JSON.stringify(message.content, null, 2)
                            )
                          }
                        />
                      ))}
                  </div>
                )
              )}
            </div>
          </div>
        </div>

        {/* Right Panel: Message Detail */}
        {selectedMessage && (
          <div className="w-1/2 bg-white border-l border-gray-200 overflow-y-auto">
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">消息详情</h2>
                <button
                  onClick={() => {
                    setSelectedMessage(null);
                    setMessageDetail(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                  title="关闭详情"
                >
                  <X size={20} />
                </button>
              </div>

              {loadingDetail ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                </div>
              ) : messageDetail ? (
                <MessageDetailPanel messageDetail={messageDetail} />
              ) : (
                <div className="text-center py-8">
                  <p className="text-gray-500">加载详情失败</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TodoItem({ todo }: { todo: any }) {
  const statusConfig = {
    pending: { icon: Circle, color: 'text-gray-400', bg: 'bg-gray-50', border: 'border-gray-200' },
    in_progress: { icon: Loader2, color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-200' },
    completed: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-50', border: 'border-green-200' },
    cancelled: { icon: X, color: 'text-red-400', bg: 'bg-red-50', border: 'border-red-200' },
  };

  const config = statusConfig[todo.status as keyof typeof statusConfig] || statusConfig.pending;
  const Icon = config.icon;

  const priorityConfig = {
    high: 'bg-red-100 text-red-700',
    medium: 'bg-yellow-100 text-yellow-700',
    low: 'bg-gray-100 text-gray-600',
  };

  const priorityLabel = {
    high: '高',
    medium: '中',
    low: '低',
  };

  return (
    <div className={`p-3 rounded-lg border ${config.bg} ${config.border}`}>
      <div className="flex items-start space-x-3">
        <div className={`flex-shrink-0 ${config.color}`}>
          {todo.status === 'in_progress' ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Icon size={16} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-900">{todo.content || todo.title || '无标题'}</p>
          {todo.priority && (
            <span
              className={`inline-block mt-1 px-2 py-0.5 text-xs rounded ${
                priorityConfig[todo.priority as keyof typeof priorityConfig]
              }`}
            >
              {priorityLabel[todo.priority as keyof typeof priorityLabel]}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onCopy,
  onClick,
  isSelected,
}: {
  message: any;
  onCopy: () => void;
  onClick: () => void;
  isSelected: boolean;
}) {
  const isUser = message.role === 'user';
  const [expanded, setExpanded] = useState(false);

  let textContent = '';
  if (typeof message.content === 'string') {
    textContent = message.content;
  } else if (Array.isArray(message.content)) {
    const textParts = message.content
      .filter((part: any) => part.type === 'text')
      .map((part: any) => part.text || '')
      .join('\n');
    textContent = textParts;
  } else {
    textContent = JSON.stringify(message.content, null, 2);
  }

  let reasoningContent = '';
  if (Array.isArray(message.content)) {
    const reasoningParts = message.content
      .filter((part: any) => part.type === 'reasoning')
      .map((part: any) => part.reasoning || part.text || '')
      .join('\n');
    reasoningContent = reasoningParts;
  }

  let subtasks: any[] = [];
  if (Array.isArray(message.content)) {
    const subtaskParts = message.content.filter(
      (part: any) => part.type === 'subtask' || part.type === 'todo'
    );
    subtasks = subtaskParts.map((part: any) => ({
      id: part.id || part.taskId,
      title: part.title || part.text || '无标题',
      status: part.status || 'pending',
      completed: part.completed || part.status === 'completed',
    }));
  }

  const content = textContent.trim() || reasoningContent || '（无内容）';
  const hasReasoning = reasoningContent.length > 0 && !textContent.trim();
  const hasSubtasks = subtasks.length > 0;
  const isEmpty = content === '（无内容）' && !hasSubtasks;

  if (isEmpty) {
    return null;
  }

  const shouldTruncate = content.length > 150;
  const displayContent = shouldTruncate && !expanded ? content.slice(0, 150) + '...' : content;

  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[90%] rounded-lg px-4 py-3 transition-all duration-200 ${
          isSelected
            ? isUser
              ? 'bg-blue-700 text-white ring-2 ring-blue-400'
              : 'bg-blue-50 border-2 border-blue-400 shadow-md'
            : isUser
            ? 'bg-blue-600 text-white hover:bg-blue-700'
            : 'bg-white border border-gray-200 shadow-sm hover:shadow-md'
        }`}
      >
        <div
          className="flex items-start justify-between mb-2 cursor-pointer"
          onClick={shouldTruncate ? toggleExpand : undefined}
        >
          <div className="flex items-center space-x-2">
            <span className="text-xs font-medium">{isUser ? '用户' : 'AI 助手'}</span>
            {hasReasoning && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                推理
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            {message.createdAt && (
              <span className="text-xs opacity-70">
                {new Date(message.createdAt).toLocaleTimeString('zh-CN')}
              </span>
            )}
            {shouldTruncate && (
              <button
                onClick={toggleExpand}
                className={`text-xs flex items-center ${
                  isUser ? 'text-blue-200 hover:text-white' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            )}
          </div>
        </div>

        <div
          className={`prose prose-sm max-w-none ${
            isUser ? 'prose-invert' : ''
          } ${!expanded && shouldTruncate ? 'line-clamp-3' : ''}`}
        >
          <ReactMarkdown>{displayContent}</ReactMarkdown>
        </div>

        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCopy();
              }}
              className={`text-xs flex items-center space-x-1 ${
                isUser ? 'text-blue-200 hover:text-white' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <Copy size={12} />
              <span>复制</span>
            </button>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
            className={`text-xs flex items-center space-x-1 ${
              isUser ? 'text-blue-200 hover:text-white' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <FileText size={12} />
            <span>详情</span>
          </button>
        </div>

        {/* Subtasks */}
        {hasSubtasks && (
          <div className="mt-3 pt-3 border-t border-gray-200">
            <div className="text-xs font-medium text-gray-700 mb-2">
              子任务 ({subtasks.length})
            </div>
            <div className="space-y-1.5">
              {subtasks.map((subtask, index) => (
                <div
                  key={subtask.id || index}
                  className={`flex items-center space-x-2 p-2 rounded border ${
                    subtask.completed
                      ? 'bg-green-50 border-green-200'
                      : 'bg-white border-gray-200'
                  }`}
                >
                  <div
                    className={`flex-shrink-0 ${
                      subtask.completed ? 'text-green-600' : 'text-gray-400'
                    }`}
                  >
                    {subtask.completed ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">{subtask.title}</p>
                    {subtask.status && subtask.status !== 'completed' && (
                      <p className="text-xs text-gray-500 mt-0.5">状态: {subtask.status}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MessageDetailPanel({ messageDetail }: { messageDetail: any }) {
  const [expandedParts, setExpandedParts] = useState<Record<number, boolean>>({});

  const info = messageDetail?.info || {};
  const parts = messageDetail?.parts || [];

  const togglePart = (index: number) => {
    setExpandedParts((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const getPartLabel = (part: any) => {
    switch (part.type) {
      case 'text':
        return '文本';
      case 'tool':
        return `工具: ${part.name || 'unknown'}`;
      case 'tool_result':
        return `工具结果: ${part.toolName || 'unknown'}`;
      case 'image':
        return '图片';
      case 'file':
        return `文件: ${part.filename || 'unknown'}`;
      case 'reasoning':
        return '推理';
      default:
        return part.type || '未知';
    }
  };

  return (
    <div className="space-y-4">
      {/* Metadata */}
      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center">
          <FileText size={14} className="mr-2" />
          消息元数据
        </h3>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-gray-500">ID</span>
            <span className="font-mono text-gray-700">{info.id || '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">角色</span>
            <span className="text-gray-700">{info.role || '-'}</span>
          </div>
          {info.time?.created && (
            <div className="flex justify-between">
              <span className="text-gray-500">创建时间</span>
              <span className="text-gray-700">
                {new Date(info.time.created).toLocaleString('zh-CN')}
              </span>
            </div>
          )}
          {info.time?.updated && (
            <div className="flex justify-between">
              <span className="text-gray-500">更新时间</span>
              <span className="text-gray-700">
                {new Date(info.time.updated).toLocaleString('zh-CN')}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Parts */}
      {parts.length > 0 && (
        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">消息部分 ({parts.length})</h3>
          <div className="space-y-2">
            {parts.map((part: any, index: number) => (
              <div key={index} className="border border-gray-200 rounded-lg bg-white">
                <button
                  onClick={() => togglePart(index)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-gray-50"
                >
                  <span className="font-medium text-gray-700">{getPartLabel(part)}</span>
                  {expandedParts[index] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                {expandedParts[index] && (
                  <div className="px-3 py-2 bg-gray-50 border-t border-gray-200">
                    {part.type === 'text' && (
                      <div className="prose prose-sm max-w-none text-sm">
                        <ReactMarkdown>{part.text || ''}</ReactMarkdown>
                      </div>
                    )}
                    {part.type === 'tool' && (
                      <pre className="text-xs bg-gray-800 text-green-400 p-3 rounded overflow-x-auto">
                        {JSON.stringify({ name: part.name, input: part.input }, null, 2)}
                      </pre>
                    )}
                    {part.type === 'tool_result' && (
                      <pre className="text-xs bg-gray-800 text-yellow-400 p-3 rounded overflow-x-auto">
                        {JSON.stringify(
                          { toolName: part.toolName, output: part.output, error: part.error },
                          null,
                          2
                        )}
                      </pre>
                    )}
                    {part.type === 'reasoning' && (
                      <div className="text-sm text-gray-600 italic p-2 bg-yellow-50 rounded">
                        {part.text || ''}
                      </div>
                    )}
                    {!['text', 'tool', 'tool_result', 'reasoning'].includes(part.type) && (
                      <pre className="text-xs bg-gray-800 text-gray-300 p-3 rounded overflow-x-auto">
                        {JSON.stringify(part, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
