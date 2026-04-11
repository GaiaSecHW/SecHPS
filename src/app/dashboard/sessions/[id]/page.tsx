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
  AlertTriangle,
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
  const [childSessionMessages, setChildSessionMessages] = useState<any[]>([]);
  const [loadingChildMessages, setLoadingChildMessages] = useState(false);
  const [isTodosExpanded, setIsTodosExpanded] = useState(true);
  const [isMessagesExpanded, setIsMessagesExpanded] = useState(false);
  const [isChildrenExpanded, setIsChildrenExpanded] = useState(true);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);
  const [vulnerabilitySummary, setVulnerabilitySummary] = useState<any>(null);
  const [progressQuestion, setProgressQuestion] = useState<string>('');
  const [showAllChildMessages, setShowAllChildMessages] = useState(false);
  const [expandedToolResults, setExpandedToolResults] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (evaluationId) {
      fetchEvaluation();
      fetchMessages();
      fetchProgressQuestion();
    }
  }, [evaluationId]);

  useEffect(() => {
    if (evaluation?.opencodeSessionId) {
      fetchSessionDetail();
      fetchTodos();
      fetchSdkProjects();
      fetchChildrenSessions();
      
      // 连接 SSE 实时事件流
      connectToEvaluationStream();
    }
    
    return () => {
      // 清理 SSE 连接
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [evaluation?.opencodeSessionId]);

  // 连接评估实时事件流
  const connectToEvaluationStream = () => {
    if (!evaluationId || !evaluation?.projectId) return;
    
    // 只有在评估运行中时才连接 SSE
    if (evaluation.status !== 'running') {
      console.log('[SSE] Evaluation not running, skip SSE connection');
      return;
    }
    
    const token = localStorage.getItem('token');
    const url = `/api/projects/${evaluation.projectId}/start?evaluationId=${evaluationId}&token=${encodeURIComponent(token || '')}`;
    
    try {
      const es = new EventSource(url);
      
      es.onopen = () => {
        console.log('[SSE] Connected to evaluation stream');
      };
      
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleStreamEvent(data);
        } catch (e) {
          // 忽略解析错误
        }
      };
      
      es.onerror = (error) => {
        console.warn('[SSE] Connection closed or failed');
        es.close();
        setEventSource(null);
      };
      
      setEventSource(es);
    } catch (error) {
      console.warn('[SSE] Failed to connect:', error);
    }
  };

  // 处理流式事件
  const handleStreamEvent = (data: any) => {
    switch (data.type) {
      case 'todo_update':
        // 实时更新 TODO 列表
        if (data.todos && Array.isArray(data.todos)) {
          setTodos(data.todos);
          console.log('[TODO] Real-time update:', data.todos.length, 'items');
        }
        break;
        
      case 'vulnerability_summary':
        // 接收漏洞总结
        setVulnerabilitySummary({
          summary: data.summary,
          vulnerabilities: data.vulnerabilities,
        });
        console.log('[Vuln] Received vulnerability summary:', data.summary);
        break;
        
      case 'done':
        // 审计完成
        console.log('[Evaluation] Audit completed:', data.message);
        fetchEvaluation(); // 刷新评估状态
        fetchMessages(); // 刷新消息列表
        if (eventSource) {
          eventSource.close();
        }
        break;
        
      case 'error':
        console.error('[Evaluation] Error:', data.error);
        break;
        
      case 'node_complete':
        // 节点完成（工作流相关）
        console.log('[Node] Completed:', data.nodeId);
        break;
        
      case 'message':
        // 消息块 - 实时添加到消息列表
        if (data.content) {
          setMessages(prev => {
            // 避免重复添加
            const exists = prev.some(m => m.id === data.id);
            if (exists) return prev;
            
            return [...prev, {
              id: data.id || `msg-${Date.now()}`,
              role: 'assistant',
              content: data.content,
              createdAt: new Date().toISOString(),
            }];
          });
          console.log('[Message] Real-time update received');
        }
        break;
        
      default:
        // 忽略其他事件
        break;
    }
  };

  useEffect(() => {
    if (!evaluation?.opencodeSessionId) return;

    // 如果评估已完成，不需要轮询
    if (evaluation.status === 'completed' || evaluation.status === 'failed') {
      return;
    }

    // 如果没有 SSE 连接，则使用轮询作为后备
    const interval = setInterval(() => {
      if (!eventSource) {
        fetchMessages(); // 添加消息轮询
        fetchTodos();
        fetchSessionDetail();
        fetchChildrenSessions();
      }
    }, 10000); // 10秒轮询一次

    return () => clearInterval(interval);
  }, [evaluation?.opencodeSessionId, evaluation?.status, eventSource]);

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
    if (!evaluationId) return;

    try {
      const token = localStorage.getItem('token');
      console.log('[fetchMessages] evaluationId:', evaluationId);
      console.log('[fetchMessages] Fetching from:', `/api/evaluations/${evaluationId}/messages`);

      const response = await fetch(`/api/evaluations/${evaluationId}/messages`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      console.log('[fetchMessages] Response status:', response.status, response.statusText);

      if (!response.ok) {
        const data = await response.json();
        console.error('[fetchMessages] Error response:', data);
        setError(data.error || '获取消息失败');
        setLoading(false);
        return;
      }

      const data = await response.json();
      console.log('[fetchMessages] Response data:', {
        messagesCount: data.messages?.length,
        total: data.total,
        firstMessage: data.messages?.[0],
        lastMessage: data.messages?.[data.messages?.length - 1],
      });
      
      setMessages(data.messages || []);
      setLoading(false);
    } catch (err) {
      console.error('[fetchMessages] Error:', err);
      setError('网络错误，请重试');
      setLoading(false);
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

  // 获取进展询问消息
  const fetchProgressQuestion = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/config', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        console.error('[Config] Failed to fetch config');
        setProgressQuestion('');
        return;
      }

      const data = await response.json();
      const activeConfig = data.configs?.find((c: any) => c.isActive);
      
      if (activeConfig?.progressQuestion && activeConfig.progressQuestion.trim()) {
        setProgressQuestion(activeConfig.progressQuestion);
      }
      // 如果没有配置，保持为空，不设置空字符串
      // 这样按钮会显示为"请先在系统配置中设置自定义进展询问消息"
    } catch (err) {
      console.error('[Config] Error fetching progress question:', err);
      setProgressQuestion('');
    }
  };

  // 获取子会话消息
  const fetchChildSessionMessages = async (childId: string) => {
    setLoadingChildMessages(true);
    try {
      const token = localStorage.getItem('token');
      
      // 调用 children API 并传入 childId 参数
      const response = await fetch(
        `/api/sessions/${evaluation?.opencodeSessionId}/children?childId=${childId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        console.error('[Child Messages] Failed to fetch:', response.status);
        setChildSessionMessages([]);
        return;
      }

      const data = await response.json();
      console.log('[Child Messages] Received:', data.messages?.length || 0);
      
      // 转换消息格式为前端期望的格式
      const formattedMessages = (data.messages || []).map((msg: any, index: number) => ({
        id: msg.uuid || msg.id || `child-msg-${index}`,
        role: msg.role || (msg.message?.role) || 'assistant',
        content: msg.content || msg.message?.content || '',
        createdAt: msg.timestamp || msg.createdAt || new Date().toISOString(),
      }));
      
      setChildSessionMessages(formattedMessages);
    } catch (err) {
      console.error('[Child Messages] Error fetching:', err);
      setChildSessionMessages([]);
    } finally {
      setLoadingChildMessages(false);
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
              {/* MCP 服务器管理入口 */}
              {evaluation.status === 'running' && (
                <>
                  <button
                    onClick={handleAskProgress}
                    disabled={!progressQuestion}
                    className={`flex items-center space-x-1 px-3 py-1.5 text-sm font-medium rounded border ${
                      progressQuestion
                        ? 'text-blue-600 hover:text-blue-800 hover:bg-blue-50 border-blue-200'
                        : 'text-gray-400 bg-gray-50 border-gray-200 cursor-not-allowed'
                    }`}
                    title={!progressQuestion ? '请先在系统配置中设置"进展询问消息"' : ''}
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
      
      {/* 评估信息面板 */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <h3 className="text-xs font-medium text-gray-500 mb-1">启动时间</h3>
            <p className="text-sm text-gray-900">
              {evaluation.startedAt ? new Date(evaluation.startedAt).toLocaleString('zh-CN') : '-'}
            </p>
          </div>
          <div>
            <h3 className="text-xs font-medium text-gray-500 mb-1">停止时间</h3>
            <p className="text-sm text-gray-900">
              {evaluation.completedAt ? new Date(evaluation.completedAt).toLocaleString('zh-CN') : '-'}
            </p>
          </div>
          <div>
            <h3 className="text-xs font-medium text-gray-500 mb-1">使用的模型</h3>
            <p className="text-sm text-gray-900">
              {evaluation.modelName || '-'}
            </p>
          </div>
          <div>
            <h3 className="text-xs font-medium text-gray-500 mb-1">模型提供商</h3>
            <p className="text-sm text-gray-900">
              {evaluation.providerType || '-'}
            </p>
          </div>
        </div>
      </div>
      
      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Vulnerability Summary + TODOs + Children + Messages */}
        <div
          className={`${
            selectedMessage ? 'w-1/2' : 'flex-1'
          } bg-gray-50 overflow-y-auto transition-all duration-300`}
        >
          <div className="p-4">
            {/* Vulnerability Summary */}
            {vulnerabilitySummary && (
              <div className="mb-6 bg-white rounded-lg border border-gray-200 p-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                  <AlertTriangle size={18} className="mr-2 text-orange-600" />
                  漏洞总结
                </h3>
                <div className="grid grid-cols-6 gap-3 mb-3">
                  {vulnerabilitySummary.summary && (
                    <>
                      <div className="text-center p-2 bg-red-50 rounded border border-red-200">
                        <div className="text-2xl font-bold text-red-600">
                          {vulnerabilitySummary.summary.critical || 0}
                        </div>
                        <div className="text-xs text-gray-600 mt-1">严重</div>
                      </div>
                      <div className="text-center p-2 bg-orange-50 rounded border border-orange-200">
                        <div className="text-2xl font-bold text-orange-600">
                          {vulnerabilitySummary.summary.high || 0}
                        </div>
                        <div className="text-xs text-gray-600 mt-1">高危</div>
                      </div>
                      <div className="text-center p-2 bg-yellow-50 rounded border border-yellow-200">
                        <div className="text-2xl font-bold text-yellow-600">
                          {vulnerabilitySummary.summary.medium || 0}
                        </div>
                        <div className="text-xs text-gray-600 mt-1">中危</div>
                      </div>
                      <div className="text-center p-2 bg-blue-50 rounded border border-blue-200">
                        <div className="text-2xl font-bold text-blue-600">
                          {vulnerabilitySummary.summary.low || 0}
                        </div>
                        <div className="text-xs text-gray-600 mt-1">低危</div>
                      </div>
                      <div className="text-center p-2 bg-gray-50 rounded border border-gray-200">
                        <div className="text-2xl font-bold text-gray-600">
                          {vulnerabilitySummary.summary.info || 0}
                        </div>
                        <div className="text-xs text-gray-600 mt-1">信息</div>
                      </div>
                      <div className="text-center p-2 bg-purple-50 rounded border border-purple-200">
                        <div className="text-2xl font-bold text-purple-600">
                          {vulnerabilitySummary.summary.total || 0}
                        </div>
                        <div className="text-xs text-gray-600 mt-1">总计</div>
                      </div>
                    </>
                  )}
                </div>
                {vulnerabilitySummary.vulnerabilities && vulnerabilitySummary.vulnerabilities.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-blue-600 hover:text-blue-800">
                      查看漏洞详情 ({vulnerabilitySummary.vulnerabilities.length} 个)
                    </summary>
                    <div className="mt-2 space-y-2 max-h-60 overflow-y-auto">
                      {vulnerabilitySummary.vulnerabilities.map((vuln: any, index: number) => (
                        <div key={index} className="p-2 bg-gray-50 rounded border border-gray-200">
                          <div className="font-medium text-gray-900">{vuln.title}</div>
                          <div className="text-xs text-gray-600 mt-1">
                            <span className="inline-block px-1.5 py-0.5 rounded bg-red-100 text-red-700 mr-2">
                              {vuln.severity}
                            </span>
                            {vuln.type && <span className="mr-2">类型: {vuln.type}</span>}
                            {vuln.location && <span>位置: {vuln.location}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
            
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
                    {todos.map((todo, index) => (
                      <div key={todo.id || `todo-${index}-${todo.content?.substring(0, 20)}`} className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200">
                        {todo.status === 'completed' ? (
                          <CheckCircle2 size={18} className="text-green-500 flex-shrink-0" />
                        ) : todo.status === 'in_progress' ? (
                          <Loader2 size={18} className="text-blue-500 flex-shrink-0 animate-spin" />
                        ) : (
                          <Circle size={18} className="text-gray-400 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900">
                            {todo.content}
                          </p>
                          {todo.priority && (
                            <span className={`inline-block mt-1 px-2 py-0.5 text-xs rounded-full ${
                              todo.priority === 'high' ? 'bg-red-100 text-red-700' :
                              todo.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>
                              {todo.priority === 'high' ? '高' : todo.priority === 'medium' ? '中' : '低'}
                            </span>
                          )}
                        </div>
                      </div>
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
                      <div key={child.id}>
                        <div
                          className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                            selectedChildSession === child.id
                              ? 'bg-purple-50 border-purple-300'
                              : 'bg-white border-gray-200 hover:border-purple-200'
                          }`}
                          onClick={() => {
                            if (selectedChildSession === child.id) {
                              setSelectedChildSession(null);
                              setChildSessionMessages([]);
                            } else {
                              setSelectedChildSession(child.id);
                              fetchChildSessionMessages(child.id);
                            }
                            // 如果有关联消息索引，滚动到该消息
                            if (child.messageIndex !== undefined && selectedChildSession !== child.id) {
                              const messageElement = document.getElementById(`message-${child.messageIndex}`);
                              if (messageElement) {
                                messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                messageElement.classList.add('ring-2', 'ring-purple-400');
                                setTimeout(() => {
                                  messageElement.classList.remove('ring-2', 'ring-purple-400');
                                }, 2000);
                              }
                            }
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {child.title || '无标题'}
                              </p>
                              <div className="flex items-center space-x-2 mt-1">
                                <p className="text-xs text-gray-500">
                                  ID: {child.id.substring(0, 20)}...
                                </p>
                                {child.messageIndex !== undefined && (
                                  <span className="text-xs text-blue-600">
                                    (消息 #{child.messageIndex + 1})
                                  </span>
                                )}
                              </div>
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
                              <ChevronRight
                                size={16}
                                className={`text-gray-400 transition-transform ${
                                  selectedChildSession === child.id ? 'rotate-90' : ''
                                }`}
                              />
                            </div>
                          </div>
                        </div>
                        
                        {/* 子会话消息详情 */}
                        {selectedChildSession === child.id && (
                          <div className="mt-2 ml-4 pl-4 border-l-2 border-purple-200">
                            {loadingChildMessages ? (
                              <div className="flex items-center justify-center py-4">
                                <Loader2 className="h-5 w-5 animate-spin text-purple-600" />
                                <span className="ml-2 text-sm text-gray-500">加载子会话消息...</span>
                              </div>
                            ) : childSessionMessages.length > 0 ? (
                              <div className="space-y-2 max-h-96 overflow-y-auto">
                                <p className="text-xs font-medium text-purple-700 mb-2">
                                  子会话消息 ({childSessionMessages.length})
                                </p>
                                {(showAllChildMessages ? childSessionMessages : childSessionMessages.slice(0, 10)).map((msg, idx) => (
                                  <div
                                    key={msg.id || idx}
                                    className={`p-2 rounded text-sm ${
                                      msg.role === 'user'
                                        ? 'bg-blue-50 text-blue-900'
                                        : 'bg-gray-50 text-gray-900'
                                    }`}
                                  >
                                    <div className="flex items-center space-x-2 mb-1">
                                      <span className="text-xs font-medium">
                                        {msg.role === 'user' ? '用户' : 'AI'}
                                      </span>
                                      {msg.createdAt && (
                                        <span className="text-xs text-gray-400">
                                          {new Date(msg.createdAt).toLocaleTimeString('zh-CN')}
                                        </span>
                                      )}
                                    </div>
                                    {/* 显示消息内容的详细信息 */}
                                    {Array.isArray(msg.content) ? (
                                      <div className="space-y-1">
                                        {msg.content.map((part: any, partIdx: number) => (
                                          <div key={partIdx} className="text-xs">
                                            {part.type === 'text' && part.text && (
                                              <p className="text-xs line-clamp-3">{part.text}</p>
                                            )}
                                            {(part.type === 'tool' || part.type === 'tool_use') && (
                                              <div className="bg-gray-800 text-green-400 p-2 rounded overflow-x-auto">
                                                <div className="font-medium text-green-300">🔧 工具调用</div>
                                                <div className="mt-1">名称: {part.name}</div>
                                                {(part.input || part.parameters) && (
                                                  <>
                                                    <div className="mt-1 text-gray-300">参数:</div>
                                                    <pre className="text-xs text-gray-400 overflow-x-auto whitespace-pre-wrap break-all">
                                                      {JSON.stringify(part.input ?? part.parameters, null, 2).substring(0, 500)}
                                                    </pre>
                                                  </>
                                                )}
                                              </div>
                                            )}
                                            {part.type === 'tool_result' && (() => {
                                              const key = `${idx}-${partIdx}`;
                                              const isExpanded = expandedToolResults.has(key);
                                              const raw = part.content ?? part.output ?? part.result;
                                              let text = '';
                                              if (raw !== null && raw !== undefined) {
                                                if (typeof raw === 'string') {
                                                  text = raw;
                                                } else if (Array.isArray(raw)) {
                                                  text = raw.map((item: any) =>
                                                    typeof item === 'string' ? item :
                                                    item.text ?? item.content ?? JSON.stringify(item)
                                                  ).join('\n');
                                                } else {
                                                  text = JSON.stringify(raw, null, 2);
                                                }
                                              }
                                              const label = part.toolName || part.name || part.tool_use_id || '';
                                              return (
                                                <div className="bg-gray-800 text-yellow-400 rounded overflow-hidden">
                                                  {/* 可点击的标题行（默认收起）*/}
                                                  <button
                                                    className="w-full flex items-center justify-between px-2 py-1.5 text-left hover:bg-gray-700 transition-colors"
                                                    onClick={() => {
                                                      setExpandedToolResults(prev => {
                                                        const next = new Set(prev);
                                                        next.has(key) ? next.delete(key) : next.add(key);
                                                        return next;
                                                      });
                                                    }}
                                                  >
                                                    <span className="font-medium text-yellow-300 text-xs flex items-center gap-1">
                                                      📤 工具结果{label ? ` · ${label.length > 30 ? label.slice(0, 30) + '…' : label}` : ''}
                                                      {part.is_error && <span className="text-red-400 ml-1">⚠️</span>}
                                                    </span>
                                                    <span className="text-gray-500 text-xs">{isExpanded ? '▲ 收起' : '▼ 展开'}</span>
                                                  </button>
                                                  {/* 展开内容 */}
                                                  {isExpanded && (
                                                    <div className="px-2 pb-2">
                                                      {text ? (
                                                        <pre className="text-xs text-gray-400 overflow-x-auto whitespace-pre-wrap break-all">
                                                          {text.length > 2000 ? text.substring(0, 2000) + '\n...(内容已截断)' : text}
                                                        </pre>
                                                      ) : (
                                                        <span className="text-xs text-gray-500">（无内容）</span>
                                                      )}
                                                      {part.is_error && <div className="text-red-400 mt-1 text-xs">⚠️ 工具返回错误</div>}
                                                      {part.error && <div className="text-red-400 mt-1 text-xs">错误: {part.error}</div>}
                                                    </div>
                                                  )}
                                                </div>
                                              );
                                            })()}
                                            {part.type === 'reasoning' && part.text && (
                                              <div className="bg-yellow-50 text-yellow-800 p-1 rounded text-xs italic">
                                                💭 {part.text}
                                              </div>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    ) : typeof msg.content === 'string' ? (
                                      <p className="text-xs line-clamp-3">{msg.content}</p>
                                    ) : (
                                      <pre className="text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                                        {JSON.stringify(msg.content, null, 2).substring(0, 200)}
                                      </pre>
                                    )}
                                  </div>
                                ))}
                                {childSessionMessages.length > 10 && (
                                  <button
                                    onClick={() => setShowAllChildMessages(!showAllChildMessages)}
                                    className="w-full text-xs text-purple-600 hover:text-purple-800 text-center py-2 bg-purple-50 hover:bg-purple-100 rounded transition-colors"
                                  >
                                    {showAllChildMessages 
                                      ? `收起 (显示前 10 条)` 
                                      : `显示全部 ${childSessionMessages.length} 条消息`}
                                  </button>
                                )}
                              </div>
                            ) : (
                              <p className="text-sm text-gray-500 py-2">暂无消息</p>
                            )}
                          </div>
                        )}
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
                    {messages.map((message, index) => (
                      <div key={message.id} id={`message-${index}`}>
                        <MessageBubble
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
                      </div>
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
  const [expandedTools, setExpandedTools] = useState<Record<number, boolean>>({});
  const [expandedThinking, setExpandedThinking] = useState(false);
  const [expandedReasoning, setExpandedReasoning] = useState(false);
  const [expandedToolSection, setExpandedToolSection] = useState(false);
  const [expandedResultSection, setExpandedResultSection] = useState(false);

  // 解析所有内容部分
  const parseContent = () => {
    if (typeof message.content === 'string') {
      return [{ type: 'text', text: message.content }];
    }
    if (Array.isArray(message.content)) {
      return message.content;
    }
    return [{ type: 'text', text: JSON.stringify(message.content, null, 2) }];
  };

  const parts = parseContent();

  // 按类型分组
  const textParts = parts.filter((p: any) => p.type === 'text');
  const reasoningParts = parts.filter((p: any) => p.type === 'reasoning');
  const toolUseParts = parts.filter((p: any) => p.type === 'tool_use');
  const toolResultParts = parts.filter((p: any) => p.type === 'tool_result');
  const subtaskParts = parts.filter((p: any) => p.type === 'subtask' || p.type === 'todo');
  const thinkingParts = parts.filter((p: any) => p.type === 'thinking');

  // 合并文本内容用于复制
  const textContent = textParts.map((p: any) => p.text || '').join('\n');

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[90%] rounded-lg px-4 py-3 transition-all duration-200 ${
          isSelected
            ? isUser
              ? 'bg-blue-600 text-white ring-2 ring-blue-400'
              : 'bg-blue-50 border-2 border-blue-400 shadow-md'
            : isUser
            ? 'bg-blue-500 text-white hover:bg-blue-600'
            : 'bg-white border border-gray-200 shadow-sm hover:shadow-md'
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-medium">{isUser ? '用户' : 'AI 助手'}</span>
            {reasoningParts.length > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                推理
              </span>
            )}
            {thinkingParts.length > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">
                思考
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            {message.createdAt && (
              <span className="text-xs opacity-70">
                {new Date(message.createdAt).toLocaleTimeString('zh-CN')}
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCopy();
              }}
              className={`text-xs flex items-center space-x-1 ${
                isUser ? 'text-blue-200 hover:text-white' : 'text-gray-400 hover:text-gray-600'
              }`}
              title="复制内容"
            >
              <Copy size={14} />
            </button>
          </div>
        </div>

        {/* 文本内容 */}
        {textParts.length > 0 && (
          <div className="prose prose-sm max-w-none">
            {textParts.map((part: any, idx: number) => (
              <ReactMarkdown key={idx}>{part.text || ''}</ReactMarkdown>
            ))}
          </div>
        )}

        {/* 思考内容 */}
        {thinkingParts.length > 0 && (
          <div className="mt-3 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
            <div 
              className="text-xs font-medium text-yellow-800 mb-2 flex items-center justify-between cursor-pointer"
              onClick={() => setExpandedThinking(!expandedThinking)}
            >
              <div className="flex items-center">
                <Info size={14} className="mr-1" />
                思考过程 ({thinkingParts.length})
              </div>
              {expandedThinking ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </div>
            {expandedThinking && (
              <div className="text-sm text-yellow-900 whitespace-pre-wrap">
                {thinkingParts.map((p: any, idx: number) => (
                  <div key={idx}>{p.thinking || p.text || ''}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 推理内容 */}
        {reasoningParts.length > 0 && (
          <div className="mt-3 p-3 bg-purple-50 rounded-lg border border-purple-200">
            <div 
              className="text-xs font-medium text-purple-800 mb-2 flex items-center justify-between cursor-pointer"
              onClick={() => setExpandedReasoning(!expandedReasoning)}
            >
              <div className="flex items-center">
                <GitBranch size={14} className="mr-1" />
                推理过程 ({reasoningParts.length})
              </div>
              {expandedReasoning ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </div>
            {expandedReasoning && (
              <div className="text-sm text-purple-900 whitespace-pre-wrap">
                {reasoningParts.map((p: any, idx: number) => (
                  <div key={idx}>{p.reasoning || p.text || ''}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 子任务 */}
        {subtaskParts.length > 0 && (
          <div className="mt-3 p-3 bg-green-50 rounded-lg border border-green-200">
            <div className="text-xs font-medium text-green-800 mb-2 flex items-center">
              <ListTodo size={14} className="mr-1" />
              子任务 ({subtaskParts.length})
            </div>
            <div className="space-y-2">
              {subtaskParts.map((subtask: any, idx: number) => (
                <div key={subtask.id || idx} className="bg-white p-2 rounded border border-green-200">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {subtask.title || subtask.text || '无标题'}
                      </p>
                      {subtask.description && (
                        <p className="text-xs text-gray-600 mt-1">{subtask.description}</p>
                      )}
                      {subtask.content && (
                        <p className="text-xs text-gray-600 mt-1">{subtask.content}</p>
                      )}
                    </div>
                    <div className="flex items-center space-x-2 ml-2">
                      {subtask.status && (
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          subtask.status === 'completed' || subtask.status === 'done'
                            ? 'bg-green-100 text-green-700'
                            : subtask.status === 'in_progress'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {subtask.status}
                        </span>
                      )}
                      {subtask.completed && (
                        <CheckCircle2 size={16} className="text-green-600" />
                      )}
                    </div>
                  </div>
                  {/* 子任务的子任务 */}
                  {subtask.subtasks && subtask.subtasks.length > 0 && (
                    <div className="mt-2 pl-4 border-l-2 border-green-300 space-y-1">
                      {subtask.subtasks.map((child: any, childIdx: number) => (
                        <div key={child.id || childIdx} className="flex items-center space-x-2 text-xs">
                          {child.completed ? (
                            <CheckCircle2 size={12} className="text-green-600" />
                          ) : (
                            <Circle size={12} className="text-gray-400" />
                          )}
                          <span className={child.completed ? 'text-gray-500 line-through' : 'text-gray-700'}>
                            {child.title || child.content || child.text || '未命名'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 工具调用 */}
        {toolUseParts.length > 0 && (
          <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <div 
              className="text-xs font-medium text-blue-800 mb-2 flex items-center justify-between cursor-pointer"
              onClick={() => setExpandedToolSection(!expandedToolSection)}
            >
              <div className="flex items-center">
                <Code size={14} className="mr-1" />
                工具调用 ({toolUseParts.length})
              </div>
              {expandedToolSection ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </div>
            {expandedToolSection && (
              <div className="space-y-2">
                {toolUseParts.map((tool: any, idx: number) => {
                  const isExpanded = expandedTools[`tool-${idx}`];
                  return (
                    <div key={idx} className="bg-white p-2 rounded border border-blue-200">
                      <div 
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() => setExpandedTools(prev => ({ ...prev, [`tool-${idx}`]: !prev[`tool-${idx}`] }))}
                      >
                        <span className="text-sm font-medium text-blue-700">{tool.name || 'unknown'}</span>
                        <div className="flex items-center space-x-2">
                          {tool.input && (
                            <span className="text-xs text-gray-500">
                              {Object.keys(tool.input).length} 个参数
                            </span>
                          )}
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </div>
                      </div>
                      {isExpanded && tool.input && (
                        <pre className="mt-2 text-xs overflow-auto max-h-64 text-gray-800 bg-gray-50 p-2 rounded">
                          {JSON.stringify(tool.input, null, 2)}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 工具结果 */}
        {toolResultParts.length > 0 && (
          <div className="mt-3 p-3 bg-gray-100 rounded-lg border border-gray-300">
            <div 
              className="text-xs font-medium text-gray-700 mb-2 flex items-center justify-between cursor-pointer"
              onClick={() => setExpandedResultSection(!expandedResultSection)}
            >
              <div className="flex items-center">
                <FileText size={14} className="mr-1" />
                工具结果 ({toolResultParts.length})
              </div>
              {expandedResultSection ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </div>
            {expandedResultSection && (
              <div className="space-y-2">
                {toolResultParts.map((result: any, idx: number) => {
                  const isExpanded = expandedTools[`result-${idx}`];
                  const isError = result.is_error || result.error;

                  // 兼容多种 content 格式
                  const raw = result.content ?? result.output ?? result.result;
                  let content = '';
                  if (raw === null || raw === undefined) {
                    content = '';
                  } else if (typeof raw === 'string') {
                    content = raw;
                  } else if (Array.isArray(raw)) {
                    // Claude SDK 标准格式: [{type:'text', text:'...'}]
                    content = raw.map((item: any) =>
                      typeof item === 'string' ? item :
                      item.text ?? item.content ?? JSON.stringify(item)
                    ).join('\n');
                  } else {
                    content = JSON.stringify(raw, null, 2);
                  }

                  // 尝试从 toolUseParts 里找对应工具名
                  const toolName = result.toolName || result.name ||
                    toolUseParts.find((t: any) => t.id === result.tool_use_id)?.name ||
                    (result.tool_use_id ? `#${idx + 1}` : '工具结果');
                  
                  return (
                    <div key={idx} className={`bg-white p-2 rounded border ${isError ? 'border-red-300' : 'border-gray-200'}`}>
                      <div
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() => setExpandedTools(prev => ({ ...prev, [`result-${idx}`]: !prev[`result-${idx}`] }))}
                      >
                        <span className={`text-sm font-medium ${isError ? 'text-red-700' : 'text-gray-700'}`}>
                          {toolName}{isError && ' ⚠️'}
                        </span>
                        <div className="flex items-center space-x-2">
                          <span className="text-xs text-gray-500">
                            {content.length > 100 ? `${content.length} 字符` : ''}
                          </span>
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </div>
                      </div>
                      {isExpanded && (
                        <pre className={`mt-2 text-xs overflow-auto max-h-64 p-2 rounded whitespace-pre-wrap break-all ${isError ? 'bg-red-50 text-red-800' : 'bg-gray-50 text-gray-800'}`}>
                          {content ? (content.length > 5000 ? content.substring(0, 5000) + '\n...(内容已截断)' : content) : '（无内容）'}
                        </pre>
                      )}
                      {isExpanded && result.error && (
                        <div className="mt-1 text-xs text-red-600">错误: {result.error}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 其他未知类型 */}
        {parts.filter((p: any) => 
          !['text', 'reasoning', 'thinking', 'tool_use', 'tool_result', 'subtask', 'todo'].includes(p.type)
        ).length > 0 && (
          <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
            <div className="text-xs font-medium text-gray-600 mb-2">其他内容</div>
            <pre className="text-xs overflow-auto max-h-32 text-gray-700">
              {JSON.stringify(
                parts.filter((p: any) => 
                  !['text', 'reasoning', 'thinking', 'tool_use', 'tool_result', 'subtask', 'todo'].includes(p.type)
                ),
                null,
                2
              )}
            </pre>
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
