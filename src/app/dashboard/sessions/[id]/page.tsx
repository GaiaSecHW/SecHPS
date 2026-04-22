'use client';

import { Suspense, useEffect, useState, useRef, use } from 'react';
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
  FileSearch,
  User,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

// 辅助函数：获取消息内容预览
function getContentPreview(content: any): string {
  if (!content) return '（空）';
  
  if (typeof content === 'string') {
    return content.substring(0, 50) + (content.length > 50 ? '...' : '');
  }
  
  if (Array.isArray(content)) {
    const textPart = content.find((p: any) => p.type === 'text' && p.text);
    if (textPart) {
      return textPart.text.substring(0, 50) + (textPart.text.length > 50 ? '...' : '');
    }
    const toolPart = content.find((p: any) => p.type === 'tool_use' || p.type === 'tool');
    if (toolPart) {
      return `🔧 工具: ${toolPart.name || 'unknown'}`;
    }
    const resultPart = content.find((p: any) => p.type === 'tool_result');
    if (resultPart) {
      const toolName = resultPart.toolName || resultPart.name || '工具结果';
      return `📤 ${toolName}`;
    }
    // 如果没有文本、工具调用、工具结果，才显示"X个部分"
    const hasOtherContent = content.some((p: any) => 
      p.type === 'reasoning' || p.type === 'thinking' || p.type === 'subtask'
    );
    if (hasOtherContent) {
      return `${content.length} 个部分`;
    }
    return '（无预览）';
  }
  
  return JSON.stringify(content).substring(0, 50) + '...';
}

// 辅助函数：格式化 Token 数量
function formatTokenNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(2)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

export default function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <SessionDetailContent params={params} />
    </Suspense>
  );
}

function SessionDetailContent({
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
  const [selectedSessionVuln, setSelectedSessionVuln] = useState<any>(null);
  const [isMessagesExpanded, setIsMessagesExpanded] = useState(false);
  const [isNodeMessagesExpanded, setIsNodeMessagesExpanded] = useState(false); // 节点消息区域默认收缩
  const [isChildrenExpanded, setIsChildrenExpanded] = useState(false);
  const [isRalphLoopExpanded, setIsRalphLoopExpanded] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [vulnerabilitySummary, setVulnerabilitySummary] = useState<any>(null);
  const [progressQuestion, setProgressQuestion] = useState<string>('');
  const [showAllChildMessages, setShowAllChildMessages] = useState(false);
  const [expandedToolResults, setExpandedToolResults] = useState<Set<string>>(new Set());
  const [expandedChildMessages, setExpandedChildMessages] = useState<Set<string>>(new Set());
  const [injectedExperiences, setInjectedExperiences] = useState<{ id: string; title: string; errorCategory: string; hitCount: number }[]>([]);
  const [experienceInjectionChecked, setExperienceInjectionChecked] = useState(false);
  
  // 实时 token 使用量和模型信息
  const [realtimeTokenUsage, setRealtimeTokenUsage] = useState<{
    phase: number;
    phaseName: string;
    modelName: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cumulativeInputTokens: number;
    cumulativeOutputTokens: number;
    cumulativeTotalTokens: number;
  } | null>(null);
  
  // FSM 阶段进度
  const [fsmPhaseProgress, setFsmPhaseProgress] = useState<{
    currentPhase: number;
    phaseName: string;
    status: string;
    totalPhases: number;
    completedPhases: number[];
  } | null>(null);
  
  // 工作流节点列表（合并配置和执行状态）
  const [workflowNodes, setWorkflowNodes] = useState<any[]>([]);
  const [nodeProgress, setNodeProgress] = useState<{
    total: number;
    completed: number;
    running: number;
    pending: number;
    failed: number;
    currentRunningNode: { id: string; label: string; modelName: string } | null;
  } | null>(null);
  const [isNodesExpanded, setIsNodesExpanded] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodeMessages, setNodeMessages] = useState<any[]>([]);
  const [loadingNodeMessages, setLoadingNodeMessages] = useState(false);

  // 用 ref 持久保存子任务的 startedAt，防止轮询覆盖
  const childStartedAtRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (evaluationId) {
      fetchEvaluation();
      fetchMessages();
      fetchProgressQuestion();
      fetchWorkflowNodes();
    }
  }, [evaluationId]);

  useEffect(() => {
    // SSE 连接不再依赖 opencodeSessionId（多 Agent 模式下 session_id 保存在 NodeExecution）
    if (evaluationId && evaluation?.projectId) {
      fetchSessionDetail();
      fetchTodos();
      fetchSdkProjects();
      fetchChildrenSessions();
      
      // 连接 SSE 实时事件流
      connectToEvaluationStream();
    }
    
    return () => {
      // 清理 SSE 连接
      if (abortController) {
        abortController.abort();
      }
    };
  }, [evaluationId, evaluation?.projectId]);

  // 连接评估实时事件流（使用 fetch 替代 EventSource，支持 Authorization header）
  const connectToEvaluationStream = async () => {
    if (!evaluationId || !evaluation?.projectId) return;
    
    // 只有在评估运行中时才连接 SSE
    if (evaluation.status !== 'running') {
      console.log('[SSE] Evaluation not running, skip SSE connection');
      return;
    }
    
    const token = localStorage.getItem('token');
    const controller = new AbortController();
    setAbortController(controller);
    
    try {
      const response = await fetch(`/api/projects/${evaluation.projectId}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ evaluationId }),
        signal: controller.signal,
      });
      
      if (!response.ok) {
        console.warn('[SSE] Connection failed:', response.status);
        return;
      }
      
      console.log('[SSE] Connected to evaluation stream');
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      
      if (!reader) {
        console.warn('[SSE] No response body');
        return;
      }
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const event = JSON.parse(data);
              handleStreamEvent(event);
            } catch {
              // 忽略解析错误
            }
          }
        }
      }
        
      console.log('[SSE] Stream ended');
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[SSE] Connection aborted');
      } else {
        console.warn('[SSE] Connection error:', error);
      }
    } finally {
      setAbortController(null);
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
        
      case 'token_usage':
      case 'phase_token_usage':
        // 实时 token 使用量和模型信息
        setRealtimeTokenUsage({
          phase: data.phase || data.nodeIndex,
          phaseName: data.phaseName || '',
          modelName: data.modelName,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          totalTokens: data.totalTokens || (data.inputTokens + data.outputTokens),
          cumulativeInputTokens: data.cumulativeInputTokens,
          cumulativeOutputTokens: data.cumulativeOutputTokens,
          cumulativeTotalTokens: data.cumulativeTotalTokens || (data.cumulativeInputTokens + data.cumulativeOutputTokens),
        });
        console.log(`[Token] Phase ${data.phase || data.nodeIndex}: ${data.modelName} - 输入 ${data.inputTokens}, 输出 ${data.outputTokens}, 累计 ${data.cumulativeInputTokens + data.cumulativeOutputTokens} tokens`);
        break;

      case 'phase_start':
        // DAG 节点开始
        setFsmPhaseProgress(prev => ({
          currentPhase: data.nodeIndex,
          phaseName: data.nodeName,
          status: 'running',
          totalPhases: data.totalNodes,
          completedPhases: prev?.completedPhases || [],
        }));
        setRealtimeTokenUsage(prev => prev ? {
          ...prev,
          phase: data.nodeIndex,
          phaseName: data.nodeName,
          modelName: data.modelName,
        } : null);
        // 更新节点状态为 running
        setWorkflowNodes(prev => {
          const nodeIndex = data.nodeIndex - 1; // nodeIndex 是 1-based
          if (nodeIndex >= 0 && nodeIndex < prev.length) {
            const updated = [...prev];
            updated[nodeIndex] = {
              ...updated[nodeIndex],
              status: 'running',
              modelName: data.modelName || updated[nodeIndex].modelName,
              startedAt: new Date().toISOString(),
            };
            return updated;
          }
          return prev;
        });
        // 更新进度
        setNodeProgress(prev => {
          if (!prev) return null;
          const nodeIndex = data.nodeIndex - 1;
          return {
            ...prev,
            running: prev.running + 1,
            pending: prev.pending - 1,
            currentRunningNode: {
              id: workflowNodes[nodeIndex]?.id || '',
              label: data.nodeName,
              modelName: data.modelName,
            },
          };
        });
        console.log(`[Phase] Node ${data.nodeIndex}/${data.totalNodes} started: ${data.nodeName} (Model: ${data.modelName})`);
        break;

      case 'started':
        // 评估启动，记录信息
        console.log(`[Evaluation] Started: ${data.evaluationId}, type: ${data.workflowType}, nodes: ${data.totalNodes}`);
        // 刷新评估信息
        fetchEvaluation();
        break;

      case 'phase_complete':
        // FSM 阶段完成
        setFsmPhaseProgress(prev => {
          const completedPhases = prev?.completedPhases || [];
          return {
            currentPhase: data.phase,
            phaseName: data.phaseName,
            status: data.status,
            totalPhases: 6, // FSM 固定 6 个阶段
            completedPhases: data.status === 'completed' 
              ? [...completedPhases, data.phase] 
              : completedPhases,
          };
        });
        // 更新节点状态为 completed 或 failed
        setWorkflowNodes(prev => {
          const nodeIndex = data.phase - 1; // phase 是 1-based
          if (nodeIndex >= 0 && nodeIndex < prev.length) {
            const updated = [...prev];
            updated[nodeIndex] = {
              ...updated[nodeIndex],
              status: data.status === 'completed' ? 'completed' : 'failed',
              completedAt: new Date().toISOString(),
            };
            return updated;
          }
          return prev;
        });
        // 更新进度
        setNodeProgress(prev => {
          if (!prev) return null;
          const newCompleted = data.status === 'completed' ? prev.completed + 1 : prev.completed;
          const newFailed = data.status === 'failed' ? prev.failed + 1 : prev.failed;
          return {
            ...prev,
            completed: newCompleted,
            running: prev.running - 1,
            failed: newFailed,
            currentRunningNode: null,
          };
        });
        console.log(`[Phase] Phase ${data.phase} (${data.phaseName}) ${data.status}`);
        break;
        
      case 'done':
        // 审计完成
        console.log('[Evaluation] Audit completed:', data.message);
        fetchEvaluation(); // 刷新评估状态
        fetchMessages(); // 刷新消息列表
        if (abortController) {
          abortController.abort();
        }
        break;
        
      case 'error':
        console.error('[Evaluation] Error:', data.error);
        break;
        
      case 'node_complete':
        // 节点完成（工作流相关）
        console.log('[Node] Completed:', data.nodeId);
        // 更新节点状态
        setWorkflowNodes(prev => {
          const nodeIdx = prev.findIndex(n => n.id === data.nodeId || n.workflowNodeId === data.nodeId);
          if (nodeIdx >= 0) {
            const updated = [...prev];
            updated[nodeIdx] = {
              ...updated[nodeIdx],
              status: 'completed',
              completedAt: new Date().toISOString(),
            };
            return updated;
          }
          return prev;
        });
        // 更新进度
        setNodeProgress(prev => {
          if (!prev) return null;
          return {
            ...prev,
            completed: prev.completed + 1,
            running: Math.max(0, prev.running - 1),
            currentRunningNode: null,
          };
        });
        break;

      case 'experience_injected':
        // 自主进化经验注入信息
        setInjectedExperiences(data.experiences || []);
        setExperienceInjectionChecked(true);
        console.log(`[Experience] Injected ${data.count} experiences`);
        break;
        
      case 'message':
        // 消息块 - 实时添加到节点消息列表
        if (data.content) {
          const nodeId = data.nodeId;
          console.log('[Message] Real-time update, nodeId:', nodeId, 'content length:', data.content.length);
          
          // 如果当前选中的节点就是消息所属的节点，实时更新 nodeMessages
          if (nodeId && selectedNodeId === nodeId) {
            setNodeMessages(prev => {
              // 避免重复添加
              const exists = prev.some(m => m.id === data.id);
              if (exists) return prev;
              
              return [...prev, {
                id: data.id || `msg-${Date.now()}`,
                role: 'assistant',
                content: data.content,
                createdAt: new Date().toISOString(),
                workflowNodeId: nodeId,
              }];
            });
          }
          
          // 同时更新全局 messages（用于轮询刷新时合并）
          setMessages(prev => {
            const exists = prev.some(m => m.id === data.id);
            if (exists) return prev;
            
            return [...prev, {
              id: data.id || `msg-${Date.now()}`,
              role: 'assistant',
              content: data.content,
              createdAt: new Date().toISOString(),
              workflowNodeId: nodeId,
            }];
          });
        }
        break;
        
      default:
        // 忽略其他事件
        break;
    }
  };

  useEffect(() => {
    // 多 Agent 模式使用 evaluationId，旧模式使用 opencodeSessionId
    if (!evaluationId && !evaluation?.opencodeSessionId) return;

    // 如果评估已完成，不需要轮询
    if (evaluation?.status === 'completed' || evaluation?.status === 'failed') {
      return;
    }

    // 如果没有 SSE 连接，则使用轮询作为后备
    const interval = setInterval(() => {
      if (!abortController) {
        fetchMessages(); // 添加消息轮询
        fetchTodos();
        fetchSessionDetail();
        fetchChildrenSessions();
        fetchWorkflowNodes(); // 添加节点轮询
        fetchEvaluation(); // 刷新评估状态
      }
    }, 5000); // 5秒轮询一次，提高实时性

    return () => clearInterval(interval);
  }, [evaluationId, evaluation?.opencodeSessionId, evaluation?.status, abortController]);

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
        // 先获取文本，再尝试解析 JSON
        const text = await response.text();
        console.error('[fetchEvaluation] Error response text:', text.substring(0, 500));
        try {
          const data = JSON.parse(text);
          setError(data.error || '获取评估会话失败');
        } catch {
          setError(`服务器错误 (${response.status})`);
        }
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
        // 先获取文本，再尝试解析 JSON
        const text = await response.text();
        console.error('[fetchMessages] Error response text:', text.substring(0, 500));
        try {
          const data = JSON.parse(text);
          setError(data.error || '获取消息失败');
        } catch {
          setError(`服务器错误 (${response.status})`);
        }
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

  // 获取节点消息（按 nodeId 过滤）
  const fetchNodeMessages = async (nodeId: string) => {
    if (!evaluationId) return;

    setLoadingNodeMessages(true);
    try {
      const token = localStorage.getItem('token');
      console.log('[fetchNodeMessages] Fetching messages for nodeId:', nodeId);

      const response = await fetch(`/api/evaluations/${evaluationId}/messages?nodeId=${nodeId}&source=db`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        console.error('[fetchNodeMessages] Failed:', response.status);
        setNodeMessages([]);
        return;
      }

      const data = await response.json();
      console.log('[fetchNodeMessages] Received:', data.messages?.length || 0, 'messages');
      
      setNodeMessages(data.messages || []);
    } catch (err) {
      console.error('[fetchNodeMessages] Error:', err);
      setNodeMessages([]);
    } finally {
      setLoadingNodeMessages(false);
    }
  };

  // 处理节点点击
  const handleNodeClick = (nodeId: string) => {
    if (selectedNodeId === nodeId) {
      // 取消选择
      setSelectedNodeId(null);
      setNodeMessages([]);
    } else {
      // 选择节点
      setSelectedNodeId(nodeId);
      fetchNodeMessages(nodeId);
    }
  };

  // 获取工作流节点列表（合并配置和执行状态）
  const fetchWorkflowNodes = async () => {
    if (!evaluationId) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/evaluations/${evaluationId}/nodes`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        console.error('[Nodes] Failed to fetch nodes:', response.status);
        return;
      }

      const data = await response.json();
      console.log('[Nodes] Received:', data.nodes?.length || 0, 'nodes, progress:', data.progress);
      
      setWorkflowNodes(data.nodes || []);
      setNodeProgress(data.progress || null);
    } catch (err) {
      console.error('[Nodes] Error fetching:', err);
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
    // 优先使用 evaluationId 获取 todos
    if (evaluationId) {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(
          `/api/evaluations/${evaluationId}/todos`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          setTodos(data.todos || []);
          console.log('[TODO] Fetched from evaluation API:', data.todos?.length || 0, 'todos');
          return;
        }
      } catch (err) {
        console.error('[TODO] Error fetching from evaluation API:', err);
      }
    }

    // 兼容旧的 opencodeSessionId 方式
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
    // 多Agent模式：使用 evaluationId 获取子Agent列表
    // 子Agent信息从 NodeExecution 表获取
    if (!evaluationId) return;

    try {
      const token = localStorage.getItem('token');
      
      // 使用 evaluationId 获取子Agent列表（从 NodeExecution 表）
      const response = await fetch(
        `/api/evaluations/${evaluationId}/children`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        console.error('[Children] Failed to fetch children sessions:', response.status);
        // 如果新API失败，尝试旧的方式（兼容）
        if (evaluation?.opencodeSessionId) {
          const fallbackResponse = await fetch(
            `/api/sessions/${evaluation.opencodeSessionId}/children`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );
          if (fallbackResponse.ok) {
            const fallbackData = await fallbackResponse.json();
            console.log('[Children] Fallback received children sessions:', fallbackData.children?.length || 0);
            setChildrenSessions(prev => {
              const newChildren = fallbackData.children || [];
              return newChildren.map((newChild: any) => {
                const savedStartedAt = childStartedAtRef.current[newChild.id];
                const existingChild = prev.find(c => c.id === newChild.id);
                if (savedStartedAt) {
                  return { ...newChild, startedAt: savedStartedAt };
                }
                if (existingChild?.startedAt && !newChild.startedAt) {
                  return { ...newChild, startedAt: existingChild.startedAt };
                }
                return newChild;
              });
            });
          }
        }
        return;
      }

      const data = await response.json();
      console.log('[Children] Received children sessions:', data.children?.length || 0, data.children);
      
      // 合并新旧数据，保留已有的 startedAt（防止轮询覆盖）
      setChildrenSessions(prev => {
        const newChildren = data.children || [];
        return newChildren.map((newChild: any) => {
          // 优先使用 ref 中保存的 startedAt，然后是旧 state，最后是新数据
          const savedStartedAt = childStartedAtRef.current[newChild.id];
          const existingChild = prev.find(c => c.id === newChild.id);
          
          if (savedStartedAt) {
            return { ...newChild, startedAt: savedStartedAt };
          }
          if (existingChild?.startedAt && !newChild.startedAt) {
            return { ...newChild, startedAt: existingChild.startedAt };
          }
          return newChild;
        });
      });
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
        console.error('[Config] Failed to fetch config, status:', response.status);
        return;
      }

      const data = await response.json();
      console.log('[Config] Fetched configs:', data.configs?.length || 0);
      
      const activeConfig = data.configs?.find((c: any) => c.isActive);
      console.log('[Config] Active config:', activeConfig ? { 
        id: activeConfig.id, 
        name: activeConfig.name,
        isActive: activeConfig.isActive,
        hasProgressQuestion: !!activeConfig.progressQuestion,
        progressQuestionLength: activeConfig.progressQuestion?.length || 0
      } : 'not found');
      
      if (activeConfig?.progressQuestion && activeConfig.progressQuestion.trim()) {
        console.log('[Config] Setting progressQuestion:', activeConfig.progressQuestion.substring(0, 50) + '...');
        setProgressQuestion(activeConfig.progressQuestion);
      } else {
        console.log('[Config] No progressQuestion found in active config');
      }
    } catch (err) {
      console.error('[Config] Error fetching progress question:', err);
    }
  };

  // 获取子会话消息
  const fetchChildSessionMessages = async (childId: string) => {
    setLoadingChildMessages(true);
    try {
      const token = localStorage.getItem('token');
      
      // 多Agent模式：使用 evaluationId 获取子会话消息
      // 从 NodeExecution 表获取 session_id，然后获取消息
      if (evaluationId) {
        // 先获取子会话的 session_id（从 NodeExecution 表）
        const nodeExecResponse = await fetch(
          `/api/evaluations/${evaluationId}/nodes`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
        
        if (nodeExecResponse.ok) {
          const nodeExecData = await nodeExecResponse.json();
          // 找到对应的节点执行记录
          const nodeExec = nodeExecData.nodes?.find((n: any) => n.id === childId || n.workflowNodeId === childId);
          
          if (nodeExec?.opencodeSessionId) {
            // 使用 opencodeSessionId 获取消息
            const response = await fetch(
              `/api/sessions/${nodeExec.opencodeSessionId}/messages`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              }
            );
            
            if (response.ok) {
              const data = await response.json();
              console.log('[Child Messages] Received from node execution:', data.messages?.length || 0);
              
              const formattedMessages = (data.messages || []).map((msg: any, index: number) => ({
                id: msg.uuid || msg.id || `child-msg-${index}`,
                role: msg.role || (msg.message?.role) || 'assistant',
                content: msg.content || msg.message?.content || '',
                createdAt: msg.timestamp || msg.createdAt || msg.message?.timestamp || new Date().toISOString(),
              }));
              
              setChildSessionMessages(formattedMessages);
              
              if (formattedMessages.length > 0 && formattedMessages[0].createdAt) {
                const firstMsgTime = formattedMessages[0].createdAt;
                childStartedAtRef.current[childId] = firstMsgTime;
                setChildrenSessions(prev => prev.map(child => 
                  child.id === childId && !child.startedAt 
                    ? { ...child, startedAt: firstMsgTime }
                    : child
                ));
              }
              return;
            }
          }
        }
      }
      
      // 兼容旧模式：使用 opencodeSessionId
      if (evaluation?.opencodeSessionId) {
        const response = await fetch(
          `/api/sessions/${evaluation.opencodeSessionId}/children?childId=${childId}`,
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
        
        const formattedMessages = (data.messages || []).map((msg: any, index: number) => ({
          id: msg.uuid || msg.id || `child-msg-${index}`,
          role: msg.role || (msg.message?.role) || 'assistant',
          content: msg.content || msg.message?.content || '',
          createdAt: msg.timestamp || msg.createdAt || msg.message?.timestamp || new Date().toISOString(),
        }));
        
        setChildSessionMessages(formattedMessages);
        
        if (formattedMessages.length > 0 && formattedMessages[0].createdAt) {
          const firstMsgTime = formattedMessages[0].createdAt;
          childStartedAtRef.current[childId] = firstMsgTime;
          setChildrenSessions(prev => prev.map(child => 
            child.id === childId && !child.startedAt 
              ? { ...child, startedAt: firstMsgTime }
              : child
          ));
        }
      } else {
        console.log('[Child Messages] No opencodeSessionId available');
        setChildSessionMessages([]);
      }
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
      // 使用 evaluationId 而不是 opencodeSessionId（多 Agent 模式下 opencodeSessionId 保存在 NodeExecution）
      const sessionId = evaluationId || evaluation?.opencodeSessionId;
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
        // 使用本地消息数据构建详情
        const content = message.content || '';
        const parts = typeof content === 'string' 
          ? [{ type: 'text', text: content }]
          : Array.isArray(content) 
            ? content 
            : [{ type: 'text', text: String(content) }];
        setMessageDetail({
          info: message,
          parts,
        });
        return;
      }

      const data = await response.json();
      // API 返回 { message: { content, role, ... } }，需要转换为 { info, parts } 格式
      const apiMessage = data.message;
      const parts = Array.isArray(apiMessage.content) 
        ? apiMessage.content 
        : [{ type: 'text', text: String(apiMessage.content || '') }];
      setMessageDetail({
        info: apiMessage,
        parts,
      });
    } catch (err) {
      console.error('获取消息详情失败:', err);
      // 使用本地消息数据构建详情
      const content = message.content || '';
      const parts = typeof content === 'string' 
        ? [{ type: 'text', text: content }]
        : Array.isArray(content) 
          ? content 
          : [{ type: 'text', text: String(content) }];
      setMessageDetail({
        info: message,
        parts,
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
                {evaluation.Project?.name || '评估会话详情'}
              </h1>
              <div className="flex items-center space-x-4 text-sm text-gray-500">
                <span>ID: {evaluation.id}</span>
                {evaluation.Project?.User && (
                  <span className="flex items-center space-x-1">
                    <User size={12} />
                    <span>创建者: {evaluation.Project.User.name || evaluation.Project.User.username || '未知'}</span>
                  </span>
                )}
              </div>
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
              {/* 显示结束原因 */}
              {evaluation.endReason && evaluation.status !== 'running' && (
                <span className="text-xs text-gray-500" title={evaluation.endMessage || ''}>
                  ({evaluation.endReason === 'stopped' ? '用户中止' :
                    evaluation.endReason === 'error' ? '执行错误' :
                    evaluation.endReason === 'idle_timeout' ? '空闲超时' :
                    evaluation.endReason === 'max_runtime' ? '超过最大运行时间' :
                    evaluation.endReason === 'completed' ? '正常完成' :
                    evaluation.endReason === 'manual_abort' ? '手动中止' :
                    evaluation.endReason})
                </span>
              )}
            </div>
            
            {/* 实时 Token 使用量和模型信息 - 仅运行中显示 */}
            {evaluation.status === 'running' && realtimeTokenUsage && (
              <div className="flex items-center space-x-4 ml-4 pl-4 border-l border-gray-200">
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-gray-500">模型:</span>
                  <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                    {realtimeTokenUsage.modelName}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-gray-500">Token:</span>
                  <span className="text-xs font-medium text-gray-700">
                    输入 {formatTokenNumber(realtimeTokenUsage.cumulativeInputTokens)} / 
                    输出 {formatTokenNumber(realtimeTokenUsage.cumulativeOutputTokens)}
                  </span>
                </div>
                {fsmPhaseProgress && (
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-gray-500">阶段:</span>
                    <span className="text-xs font-medium text-gray-700">
                      {fsmPhaseProgress.phaseName} ({fsmPhaseProgress.currentPhase}/{fsmPhaseProgress.totalPhases})
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              {/* 查看报告按钮 - 评估完成后显示 */}
              {evaluation.status === 'completed' && (
                <button
                  onClick={() => router.push(`/dashboard/evaluations/${evaluationId}/report`)}
                  className="flex items-center space-x-1 px-3 py-1.5 text-sm font-medium text-green-600 hover:text-green-800 hover:bg-green-50 rounded border border-green-200"
                >
                  <FileSearch size={16} />
                  <span>查看报告</span>
                </button>
              )}
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
                    title={!progressQuestion ? '请先在"系统配置"中设置"进展询问消息"' : '询问当前评估进展'}
                  >
                    <MessageSquare size={16} />
                    <span>询问进展</span>
                    {!progressQuestion && (
                      <span className="text-xs text-gray-400 ml-1">(未配置)</span>
                    )}
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
              {evaluation.modelName || evaluation.modelConfigName || '-'}
            </p>
          </div>
          <div>
            <h3 className="text-xs font-medium text-gray-500 mb-1">模型提供商</h3>
            <p className="text-sm text-gray-900">
              {evaluation.providerType || evaluation.modelConfigProviderType || '-'}
            </p>
          </div>
          <div>
            <h3 className="text-xs font-medium text-gray-500 mb-1">模型提供者</h3>
            <p className="text-sm text-gray-900">
              {evaluation.modelCreatorId === null ? (
                <span className="text-purple-600">系统模型</span>
              ) : (
                evaluation.modelCreatorName || evaluation.modelCreatorUsername || '未知用户'
              )}
            </p>
          </div>
          {/* Token 消耗信息 */}
          <div>
            <h3 className="text-xs font-medium text-gray-500 mb-1">输入 Token</h3>
            <p className="text-sm text-gray-900">
              {evaluation.totalInputTokens != null ? formatTokenNumber(evaluation.totalInputTokens) : '-'}
            </p>
          </div>
          <div>
            <h3 className="text-xs font-medium text-gray-500 mb-1">输出 Token</h3>
            <p className="text-sm text-gray-900">
              {evaluation.totalOutputTokens != null ? formatTokenNumber(evaluation.totalOutputTokens) : '-'}
            </p>
          </div>
          <div>
            <h3 className="text-xs font-medium text-gray-500 mb-1">总 Token</h3>
            <p className="text-sm text-gray-900">
              {evaluation.totalTokens != null ? formatTokenNumber(evaluation.totalTokens) : '-'}
            </p>
          </div>
          <div>
            <h3 className="text-xs font-medium text-gray-500 mb-1 flex items-center">
              预估费用
              <span className="ml-1 cursor-help relative group">
                <Info size={12} className="text-orange-400 hover:text-orange-600" />
                <span className="absolute left-0 bottom-full mb-2 hidden group-hover:block bg-gray-800 text-white text-xs rounded p-2 whitespace-nowrap z-10 shadow-lg">
                  ¥6/百万输入 + ¥22/百万输出
                </span>
              </span>
            </h3>
            <p className="text-sm text-orange-600 font-medium">
              {evaluation.estimatedCost ? `¥${evaluation.estimatedCost.toFixed(4)}` : '-'}
            </p>
          </div>
        </div>
        {/* 结束详情（失败或取消时显示详细信息） */}
        {evaluation.endMessage && evaluation.status !== 'running' && (
          <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="text-xs font-medium text-gray-500 mb-1">结束详情</h3>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              {evaluation.endMessage}
            </p>
          </div>
        )}
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
            {/* 自主进化经验注入信息 */}
            {experienceInjectionChecked && (
              <div className={`mb-4 rounded-lg border px-4 py-3 text-sm flex items-start gap-2 ${
                injectedExperiences.length > 0
                  ? 'bg-purple-50 border-purple-200 text-purple-800'
                  : 'bg-gray-50 border-gray-200 text-gray-500'
              }`}>
                <span className="mt-0.5 flex-shrink-0">{injectedExperiences.length > 0 ? '🧠' : '○'}</span>
                <div>
                  {injectedExperiences.length > 0 ? (
                    <>
                      <span className="font-medium">已注入 {injectedExperiences.length} 条自主进化经验</span>
                      <ul className="mt-1 space-y-0.5">
                        {injectedExperiences.map(e => (
                          <li key={e.id} className="text-xs text-purple-700">
                            · [{e.errorCategory}] {e.title}（命中 {e.hitCount} 次）
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <span>无自主进化经验注入（暂无 isInjected=true 的记录）</span>
                  )}
                </div>
              </div>
            )}

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
                        <div
                          key={index}
                          className="p-2 bg-gray-50 rounded border border-gray-200 cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-colors"
                          onClick={() => setSelectedSessionVuln(vuln)}
                        >
                          <div className="font-medium text-gray-900">{vuln.title}</div>
                          <div className="text-xs text-gray-600 mt-1">
                            {vuln.type && <span className="mr-2">类型: {vuln.type}</span>}
                            {vuln.cwe_id && <span className="mr-2">CWE: {vuln.cwe_id}</span>}
                            {vuln.skill && <span className="mr-2">工具: {vuln.skill}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
            
            {/* TODO List - 任务列表 */}
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
                      <TodoItem key={todo.id || `todo-${index}-${todo.content?.substring(0, 20)}`} todo={todo} />
                    ))}
                  </div>
                )
              )}
            </div>

            {/* Ralph Loop 迭代记录 */}
            {evaluation?.EvaluationIteration && evaluation.EvaluationIteration.length > 0 && (
              <div className="mb-6">
                <button
                  onClick={() => setIsRalphLoopExpanded(!isRalphLoopExpanded)}
                  className="w-full flex items-center justify-between text-lg font-semibold text-gray-900 mb-3 hover:text-gray-700 transition-colors"
                >
                  <div className="flex items-center">
                    <Code size={18} className="mr-2 text-green-600" />
                    Ralph Loop 记录 ({evaluation.EvaluationIteration.length})
                  </div>
                  {isRalphLoopExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </button>
                {isRalphLoopExpanded && (
                  <div className="space-y-3">
                    {evaluation.EvaluationIteration.map((iteration: any) => (
                      <div key={iteration.id} className="p-4 bg-white rounded-lg border border-gray-200">
                        {/* 第一行：迭代编号 + 状态 + 时间 */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-900">
                              迭代 #{iteration.iterationNumber}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              iteration.status === 'completed' ? 'bg-green-100 text-green-700' :
                              iteration.status === 'running' ? 'bg-blue-100 text-blue-700' :
                              iteration.status === 'failed' ? 'bg-red-100 text-red-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>
                              {iteration.status === 'completed' ? '已完成' :
                               iteration.status === 'running' ? '运行中' :
                               iteration.status === 'failed' ? '失败' : iteration.status}
                            </span>
                            {iteration.verificationComplete !== null && iteration.verificationComplete !== undefined && (
                              <span className={`text-xs px-2 py-0.5 rounded ${
                                iteration.verificationComplete ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                              }`}>
                                {iteration.verificationComplete ? '验证通过' : '验证失败'}
                              </span>
                            )}
                          </div>
                          {iteration.startedAt && (
                            <span className="text-xs text-gray-400">
                              {new Date(iteration.startedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                        
                        {/* 第二行：验证原因或错误信息 */}
                        {(iteration.verificationReason || iteration.errorMessage) && (
                          <div className={`text-sm p-2 rounded mb-2 ${
                            iteration.errorMessage ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-blue-50 text-blue-700 border border-blue-200'
                          }`}>
                            <span className="font-medium">{iteration.errorMessage ? '错误: ' : '验证结果: '}</span>
                            {iteration.errorMessage || iteration.verificationReason}
                          </div>
                        )}
                        
                        {/* 第三行：详细统计 */}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                          {iteration.modelName && (
                            <span className="flex items-center gap-1">
                              <span className="font-medium text-blue-600">模型:</span>
                              {iteration.modelName}
                            </span>
                          )}
                          {iteration.roleId && (
                            <span className="flex items-center gap-1">
                              <span className="font-medium text-purple-600">角色:</span>
                              {iteration.roleId}
                            </span>
                          )}
                          {iteration.toolCallCount > 0 && (
                            <span className="flex items-center gap-1">
                              <span className="font-medium text-orange-600">工具调用:</span>
                              {iteration.toolCallCount} 次
                            </span>
                          )}
                          {iteration.duration && (
                            <span className="flex items-center gap-1">
                              <Clock size={10} />
                              {Math.round(iteration.duration / 1000)}s
                            </span>
                          )}
                          {iteration.inputTokens !== null && iteration.inputTokens !== undefined && (
                            <span>输入: {formatTokenNumber(iteration.inputTokens)}</span>
                          )}
                          {iteration.outputTokens !== null && iteration.outputTokens !== undefined && (
                            <span>输出: {formatTokenNumber(iteration.outputTokens)}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Workflow Nodes - 显示所有节点（从工作流配置）合并执行状态 */}
            {workflowNodes.length > 0 && (
              <div className="mb-6">
                <button
                  onClick={() => setIsNodesExpanded(!isNodesExpanded)}
                  className="w-full flex items-center justify-between text-lg font-semibold text-gray-900 mb-3 hover:text-gray-700 transition-colors"
                >
                  <div className="flex items-center">
                    <GitBranch size={18} className="mr-2 text-orange-600" />
                    节点列表 ({workflowNodes.length})
                    <span className="ml-2 text-xs text-gray-400 font-normal">点击节点查看消息</span>
                  </div>
                  {isNodesExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </button>
                
                {/* 执行进度 */}
                {nodeProgress && (
                  <div className="mb-3 p-3 bg-gradient-to-r from-orange-50 to-blue-50 rounded-lg border border-orange-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <span className="text-sm font-medium text-gray-700">
                          执行进度: 
                          <span className="text-orange-600 ml-1">{nodeProgress.completed}</span>
                          <span className="text-gray-400"> / </span>
                          <span className="text-gray-900">{nodeProgress.total}</span>
                          <span className="text-gray-500 ml-1">节点</span>
                        </span>
                        {/* 进度条 */}
                        <div className="flex-1 max-w-xs">
                          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full transition-all duration-300"
                              style={{ width: `${(nodeProgress.completed / nodeProgress.total) * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>
                      {/* 当前运行节点 */}
                      {nodeProgress.currentRunningNode && (
                        <div className="flex items-center gap-2 text-sm">
                          <Loader2 size={14} className="text-blue-500 animate-spin" />
                          <span className="text-gray-600">当前:</span>
                          <span className="font-medium text-blue-700">{nodeProgress.currentRunningNode.label}</span>
                          {nodeProgress.currentRunningNode.modelName && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                              {nodeProgress.currentRunningNode.modelName}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {/* 统计信息 */}
                    <div className="flex items-center gap-3 mt-2 text-xs">
                      <span className="flex items-center gap-1">
                        <CheckCircle2 size={12} className="text-green-500" />
                        <span className="text-green-700">{nodeProgress.completed} 完成</span>
                      </span>
                      {nodeProgress.running > 0 && (
                        <span className="flex items-center gap-1">
                          <Loader2 size={12} className="text-blue-500 animate-spin" />
                          <span className="text-blue-700">{nodeProgress.running} 运行中</span>
                        </span>
                      )}
                      {nodeProgress.pending > 0 && (
                        <span className="flex items-center gap-1">
                          <Circle size={12} className="text-gray-400" />
                          <span className="text-gray-500">{nodeProgress.pending} 等待</span>
                        </span>
                      )}
                      {nodeProgress.failed > 0 && (
                        <span className="flex items-center gap-1">
                          <X size={12} className="text-red-500" />
                          <span className="text-red-700">{nodeProgress.failed} 失败</span>
                        </span>
                      )}
                    </div>
                  </div>
                )}
                
                {isNodesExpanded && (
                  <div className="space-y-2">
                    {workflowNodes.map((node: any, index: number) => {
                      // 计算执行时长
                      const duration = node.startedAt && node.completedAt
                        ? new Date(node.completedAt).getTime() - new Date(node.startedAt).getTime()
                        : null;
                      
                      // 状态图标和颜色
                      const statusConfig = {
                        completed: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-50', border: 'border-green-200' },
                        running: { icon: Loader2, color: 'text-blue-500 animate-spin', bg: 'bg-blue-50', border: 'border-blue-200' },
                        pending: { icon: Circle, color: 'text-gray-400', bg: 'bg-gray-50', border: 'border-gray-200' },
                        failed: { icon: X, color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-200' },
                      };
                      const config = statusConfig[node.status as keyof typeof statusConfig] || statusConfig.pending;
                      const StatusIcon = config.icon;
                      
                      return (
                        <div 
                          key={node.id || `node-${index}`} 
                          className={`p-3 rounded-lg border transition-all duration-200 cursor-pointer ${
                            selectedNodeId === node.id 
                              ? 'bg-blue-100 border-blue-400 ring-2 ring-blue-300' 
                              : `${config.bg} ${config.border}`
                          }`}
                          onClick={() => handleNodeClick(node.id)}
                          title="点击查看该节点的消息"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {/* 状态图标 */}
                              <StatusIcon size={18} className={config.color} />
                              
                              {/* 节点信息 */}
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-gray-900">
                                    {node.label || `节点 ${index + 1}`}
                                  </span>
                                  {/* FSM 阶段编号 */}
                                  {node.fsmPhase && (
                                    <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                                      Phase {node.fsmPhase}
                                    </span>
                                  )}
                                  {/* 角色标签 */}
                                  {node.roleName && (
                                    <span 
                                      className="text-xs px-2 py-0.5 rounded"
                                      style={{ 
                                        backgroundColor: node.roleColor ? `${node.roleColor}20` : '#f3f4f6',
                                        color: node.roleColor || '#6b7280',
                                        borderColor: node.roleColor || '#d1d5db',
                                      }}
                                    >
                                      {node.roleName}
                                    </span>
                                  )}
                                </div>
                                
                                {/* 详细信息 */}
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-gray-500">
                                  {/* 模型 */}
                                  {node.modelName && (
                                    <span className="flex items-center gap-1 bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                                      {node.modelName}
                                    </span>
                                  )}
                                  {/* Skills */}
                                  {node.skills && node.skills.length > 0 && (
                                    <span className="text-gray-400">
                                      Skills: {node.skills.length}
                                    </span>
                                  )}
                                  {/* 执行时长 */}
                                  {duration && (
                                    <span className="flex items-center gap-1">
                                      <Clock size={10} />
                                      {Math.round(duration / 1000)}s
                                    </span>
                                  )}
                                  {/* Token 信息 */}
                                  {node.inputTokens != null && (
                                    <span>输入: {formatTokenNumber(node.inputTokens)}</span>
                                  )}
                                  {node.outputTokens != null && (
                                    <span>输出: {formatTokenNumber(node.outputTokens)}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            
                            {/* 时间信息 */}
                            <div className="flex items-center gap-2 text-xs text-gray-400">
                              {node.startedAt && (
                                <span>
                                  {new Date(node.startedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              )}
                              {node.completedAt && (
                                <span className="text-green-500">
                                  → {new Date(node.completedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              )}
                            </div>
                           </div>
                         </div>
                       );
                     })}
                   </div>
                 )}
               </div>
             )}

            {/* Node Messages - 当选中节点时显示 */}
            {selectedNodeId && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center">
                    <MessageSquare size={18} className="mr-2 text-blue-600" />
                    <span className="text-lg font-semibold text-gray-900">
                      节点消息: {workflowNodes.find((n: any) => n.id === selectedNodeId)?.label || '未知节点'}
                    </span>
                    <span className="ml-2 text-sm text-gray-500">
                      ({nodeMessages.length} 条)
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedNodeId(null);
                      setNodeMessages([]);
                    }}
                    className="flex items-center space-x-1 px-2 py-1 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                    title="取消选择"
                  >
                    <X size={14} />
                    <span>取消选择</span>
                  </button>
                </div>
                
                {loadingNodeMessages ? (
                  <div className="flex items-center justify-center py-8 bg-white rounded-lg border border-gray-200">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                    <span className="ml-2 text-sm text-gray-500">加载节点消息...</span>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* 所有消息 - 不过滤 */}
                    <div className="bg-white rounded-lg border border-gray-200 p-4">
                      <button
                        className="w-full flex items-center justify-between text-sm font-semibold text-gray-700 mb-3"
                        onClick={() => setIsNodeMessagesExpanded(!isNodeMessagesExpanded)}
                      >
                        <div className="flex items-center">
                          <MessageSquare size={14} className="mr-2 text-blue-600" />
                          节点消息 ({nodeMessages.length} 条)
                        </div>
                        {isNodeMessagesExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                      {isNodeMessagesExpanded && (
                        <div className="space-y-3 max-h-96 overflow-y-auto">
                          {nodeMessages.map((message: any, index: number) => (
                            <MessageBubble
                              key={`${message.id}-${index}`}
                              message={message}
                              onCopy={() => {
                                navigator.clipboard.writeText(
                                  typeof message.content === 'string' 
                                    ? message.content 
                                    : JSON.stringify(message.content, null, 2)
                                );
                              }}
                              onClick={() => {
                                setSelectedMessage(message);
                                // 转换消息内容为 MessageDetailPanel 需要的格式
                                let parts: any[] = [];
                                const content = message.content;
                                
                                if (typeof content === 'string') {
                                  // 尝试解析 JSON
                                  try {
                                    const parsed = JSON.parse(content);
                                    if (Array.isArray(parsed)) {
                                      parts = parsed;
                                    } else {
                                      parts = [{ type: 'text', text: content }];
                                    }
                                  } catch {
                                    parts = [{ type: 'text', text: content }];
                                  }
                                } else if (Array.isArray(content)) {
                                  parts = content;
                                } else if (content) {
                                  parts = [{ type: 'text', text: JSON.stringify(content, null, 2) }];
                                }
                                
                                setMessageDetail({
                                  id: message.id,
                                  role: message.role,
                                  content: message.content,
                                  createdAt: message.createdAt,
                                  workflowNodeId: message.workflowNodeId,
                                  // MessageDetailPanel 需要的格式
                                  parts: parts,
                                  info: {
                                    id: message.id,
                                    role: message.role,
                                    time: {
                                      created: message.createdAt,
                                    },
                                  },
                                });
                              }}
                              isSelected={selectedMessage?.id === message.id}
                            />
                          ))}
                        </div>
                      )}
                      {isNodeMessagesExpanded && nodeMessages.length === 0 && (
                        <p className="text-sm text-gray-500">暂无消息</p>
                      )}
                    </div>
                    
                    {/* 子 Agent 明细 */}
                    <div className="bg-white rounded-lg border border-purple-200 p-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center">
                        <GitBranch size={14} className="mr-2 text-purple-600" />
                        子 Agent 明细 ({childrenSessions.length} 个)
                      </h4>
                      {childrenSessions.length > 0 ? (
                        <div className="space-y-2">
                          {childrenSessions.map((child: any) => (
                            <div 
                              key={child.id}
                              className="p-2 rounded border border-purple-200 bg-purple-50 cursor-pointer hover:bg-purple-100"
                              onClick={() => {
                                setSelectedChildSession(child.id);
                                fetchChildSessionMessages(child.id);
                              }}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-gray-700">
                                  {child.title || `子 Agent ${child.id.substring(0, 8)}`}
                                </span>
                                <span className={`text-xs px-2 py-0.5 rounded ${
                                  child.status === 'active' || child.status === 'running' ? 'bg-green-100 text-green-700' :
                                  child.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                                  'bg-gray-100 text-gray-600'
                                }`}>
                                  {child.status || 'unknown'}
                                </span>
                              </div>
                              {child.startedAt && (
                                <div className="text-xs text-gray-500 mt-1">
                                  {new Date(child.startedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                </div>
                              )}
                              {child.modelName && (
                                <div className="text-xs text-blue-600 mt-1">
                                  模型: {child.modelName}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">暂无子 Agent</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Children Sessions - 已移除，保留"子 Agent 明细"栏目 */}
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

      {/* 漏洞全屏详情 */}
      {selectedSessionVuln && (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white shrink-0">
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setSelectedSessionVuln(null)}
                className="flex items-center text-gray-500 hover:text-gray-800 transition-colors"
              >
                <ArrowLeft size={18} className="mr-1" />
                返回
              </button>
              <span className="text-gray-300">|</span>
              <h2 className="text-lg font-bold text-gray-900">{selectedSessionVuln.title}</h2>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-5xl mx-auto p-6 space-y-4">
              <div className="bg-gray-50 rounded-lg p-4 grid grid-cols-2 gap-3">
                <div><span className="text-xs text-gray-500">漏洞类型</span><p className="text-sm font-medium text-gray-900">{selectedSessionVuln.type || '未知'}</p></div>
                <div><span className="text-xs text-gray-500">CWE 编号</span><p className="text-sm font-medium text-gray-900">{selectedSessionVuln.cwe_id || '无'}</p></div>
                <div><span className="text-xs text-gray-500">发现工具</span><p className="text-sm font-medium text-gray-900">{selectedSessionVuln.skill || '未知'}</p></div>
              </div>
              {selectedSessionVuln.description && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">漏洞描述</h4>
                  <p className="text-sm text-gray-600 bg-white border border-gray-200 rounded-lg p-3">{selectedSessionVuln.description}</p>
                </div>
              )}
              {selectedSessionVuln.location && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">问题代码</h4>
                  <pre className="text-xs bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto max-h-96 whitespace-pre-wrap">{selectedSessionVuln.location}</pre>
                </div>
              )}
              {selectedSessionVuln.POC && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">POC</h4>
                  <pre className="text-xs bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto max-h-96 whitespace-pre-wrap">{selectedSessionVuln.POC}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
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
  const [isCollapsed, setIsCollapsed] = useState(true); // 默认收缩
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
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

  // 合并文本内容用于复制和预览
  const textContent = textParts.map((p: any) => p.text || '').join('\n');
  
  // 获取文本预览（前30字符）
  const textPreview = textContent.substring(0, 30) + (textContent.length > 30 ? '...' : '');

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[90%] rounded-lg transition-all duration-200 ${
          isSelected
            ? isUser
              ? 'bg-blue-600 text-white ring-2 ring-blue-400'
              : 'bg-blue-50 border-2 border-blue-400 shadow-md'
            : isUser
            ? 'bg-blue-500 text-white hover:bg-blue-600'
            : 'bg-white border border-gray-200 shadow-sm hover:shadow-md'
        }`}
      >
        {/* 可点击的标题行（摘要） - 点击展开/收缩 */}
        <button
          className={`w-full flex items-center justify-between px-4 py-2 text-left transition-colors ${
            isCollapsed ? (isUser ? 'hover:bg-blue-600' : 'hover:bg-gray-50') : ''
          } ${isUser && !isCollapsed ? 'rounded-t-lg' : ''} ${isUser && isCollapsed ? 'rounded-lg' : ''}`}
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <div className="flex items-center space-x-2 min-w-0 flex-1 flex-wrap">
            {/* 角色图标 */}
            <span className={`text-xs font-medium flex-shrink-0 ${
              isUser ? 'text-white' : 'text-gray-700'
            }`}>
              {isUser ? '👤 用户' : '🤖 AI'}
            </span>
            
            {/* 文本预览 - 仅收缩时显示 */}
            {isCollapsed && textPreview && (
              <span className={`text-xs truncate ${
                isUser ? 'text-blue-100' : 'text-gray-500'
              }`}>
                {textPreview}
              </span>
            )}
            
            {/* 工具调用标签 */}
            {toolUseParts.length > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                isUser ? 'bg-blue-400 text-white' : 'bg-blue-100 text-blue-700'
              }`}>
                🔧 {toolUseParts.length}
              </span>
            )}
            
            {/* 工具结果标签 */}
            {toolResultParts.length > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                isUser ? 'bg-blue-300 text-white' : 'bg-gray-200 text-gray-700'
              }`}>
                📤 {toolResultParts.length}
              </span>
            )}
            
            {/* 推理标签 */}
            {reasoningParts.length > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                isUser ? 'bg-purple-400 text-white' : 'bg-purple-100 text-purple-700'
              }`}>
                推理
              </span>
            )}
            
            {/* 思考标签 */}
            {thinkingParts.length > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                isUser ? 'bg-yellow-400 text-white' : 'bg-yellow-100 text-yellow-700'
              }`}>
                思考
              </span>
            )}
            
            {/* 子任务标签 */}
            {subtaskParts.length > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                isUser ? 'bg-green-400 text-white' : 'bg-green-100 text-green-700'
              }`}>
                📋 {subtaskParts.length}
              </span>
            )}
          </div>
          
          <div className="flex items-center space-x-2 flex-shrink-0 ml-2">
            {/* 时间戳 */}
            {message.createdAt && (
              <span className={`text-xs ${
                isUser ? 'text-blue-200' : 'text-gray-400'
              }`}>
                {new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            
            {/* 展开/收缩指示器 */}
            <span className={`text-xs ${
              isUser ? 'text-blue-200' : 'text-gray-400'
            }`}>
              {isCollapsed ? '▼' : '▲'}
            </span>
          </div>
        </button>

        {/* 展开的详细内容 */}
        {!isCollapsed && (
          <div className="px-4 pb-3 border-t border-gray-100">
            {/* 工具栏：复制 + 查看详情 */}
            <div className="flex items-center justify-end space-x-2 mt-2 mb-2">
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
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClick();
                }}
                className={`text-xs flex items-center space-x-1 ${
                  isUser ? 'text-blue-200 hover:text-white' : 'text-gray-400 hover:text-gray-600'
                }`}
                title="查看详情"
              >
                <Info size={14} />
              </button>
            </div>

            {/* 文本内容 - 只显示三行，超出显示省略号 */}
            {textParts.length > 0 && (
              <div className={`prose prose-sm max-w-none ${isUser ? 'prose-invert text-white' : ''}`}>
                {textParts.map((part: any, idx: number) => {
                  const text = part.text || '';
                  // 限制显示三行（约 300 字符）
                  const maxChars = 300;
                  const displayText = text.length > maxChars ? text.substring(0, maxChars) + '...' : text;
                  return (
                    <div key={idx} className="line-clamp-3">
                      <ReactMarkdown>{displayText}</ReactMarkdown>
                    </div>
                  );
                })}
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
                          {/* 时间信息 */}
                          <div className="flex items-center space-x-3 mt-1 flex-wrap gap-y-0.5">
                            {(subtask.startedAt || subtask.createdAt || subtask.timestamp) && (
                              <span className="text-xs text-green-600 flex items-center">
                                <Clock size={10} className="mr-1" />
                                启动: {new Date(subtask.startedAt || subtask.createdAt || subtask.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </span>
                            )}
                            {subtask.completedAt && (
                              <span className="text-xs text-gray-500 flex items-center">
                                <CheckCircle2 size={10} className="mr-1" />
                                结束: {new Date(subtask.completedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </span>
                            )}
                            {(subtask.startedAt || subtask.createdAt || subtask.timestamp) && subtask.completedAt && (
                              <span className="text-xs text-purple-600">
                                耗时: {Math.round((new Date(subtask.completedAt).getTime() - new Date(subtask.startedAt || subtask.createdAt || subtask.timestamp).getTime()) / 1000)}s
                              </span>
                            )}
                          </div>
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
              <div className="mt-2">
                <button
                  className="w-full flex items-center justify-between px-2 py-1.5 text-left bg-blue-50 rounded border border-blue-200 hover:bg-blue-100 transition-colors"
                  onClick={() => setExpandedToolSection(!expandedToolSection)}
                >
                  <span className="text-xs font-medium text-blue-700">
                    🔧 工具调用 ({toolUseParts.length})
                  </span>
                  <span className="text-xs text-gray-400">{expandedToolSection ? '▲' : '▼'}</span>
                </button>
                {expandedToolSection && (
                  <div className="mt-1 space-y-1">
                    {toolUseParts.map((tool: any, idx: number) => {
                      const isExpanded = expandedTools[`tool-${idx}`];
                      return (
                        <div key={idx} className="bg-blue-50 rounded border border-blue-200 overflow-hidden">
                          <button
                            className="w-full flex items-center justify-between px-2 py-1.5 text-left hover:bg-blue-100 transition-colors"
                            onClick={() => setExpandedTools(prev => ({ ...prev, [`tool-${idx}`]: !prev[`tool-${idx}`] }))}
                          >
                            <span className="text-xs font-medium text-blue-700 flex items-center gap-1">
                              🔧 {tool.name || 'unknown'}
                              {tool.input && (
                                <span className="text-gray-400 font-normal">
                                  ({Object.keys(tool.input).length} 个参数)
                                </span>
                              )}
                            </span>
                            <span className="text-xs text-gray-400">{isExpanded ? '▲' : '▼'}</span>
                          </button>
                          {isExpanded && tool.input && (
                            <div className="px-2 pb-2 border-t border-blue-100">
                              <pre className="text-xs overflow-auto max-h-40 text-gray-800 bg-white p-2 rounded mt-1">
                                {JSON.stringify(tool.input, null, 2)}
                              </pre>
                            </div>
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
              <div className="mt-2">
                <button
                  className="w-full flex items-center justify-between px-2 py-1.5 text-left bg-gray-50 rounded border border-gray-200 hover:bg-gray-100 transition-colors"
                  onClick={() => setExpandedResultSection(!expandedResultSection)}
                >
                  <span className="text-xs font-medium text-gray-700">
                    📤 工具结果 ({toolResultParts.length})
                  </span>
                  <span className="text-xs text-gray-400">{expandedResultSection ? '▲' : '▼'}</span>
                </button>
                {expandedResultSection && (
                  <div className="mt-1 space-y-1">
                    {toolResultParts.map((result: any, idx: number) => {
                      const isExpanded = expandedTools[`result-${idx}`];
                      const isError = result.is_error || result.error;

                      const raw = result.content ?? result.output ?? result.result;
                      let content = '';
                      if (raw === null || raw === undefined) {
                        content = '';
                      } else if (typeof raw === 'string') {
                        content = raw;
                      } else if (Array.isArray(raw)) {
                        content = raw.map((item: any) =>
                          typeof item === 'string' ? item :
                          item.text ?? item.content ?? JSON.stringify(item)
                        ).join('\n');
                      } else {
                        content = JSON.stringify(raw, null, 2);
                      }

                      const toolName = result.toolName || result.name ||
                        toolUseParts.find((t: any) => t.id === result.tool_use_id)?.name ||
                        (result.tool_use_id ? `#${idx + 1}` : '工具结果');

                      return (
                        <div key={idx} className={`bg-gray-50 rounded border overflow-hidden ${isError ? 'border-red-300' : 'border-gray-200'}`}>
                          <button
                            className="w-full flex items-center justify-between px-2 py-1.5 text-left hover:bg-gray-100 transition-colors"
                            onClick={() => setExpandedTools(prev => ({ ...prev, [`result-${idx}`]: !prev[`result-${idx}`] }))}
                          >
                            <span className={`text-xs font-medium flex items-center gap-1 ${isError ? 'text-red-700' : 'text-gray-700'}`}>
                              📤 {toolName}
                              {content.length > 0 && (
                                <span className="text-gray-400 font-normal">
                                  ({content.length} 字符)
                                </span>
                              )}
                              {isError && <span>⚠️</span>}
                            </span>
                            <span className="text-xs text-gray-400">{isExpanded ? '▲' : '▼'}</span>
                          </button>
                          {isExpanded && (
                            <div className="px-2 pb-2 border-t border-gray-100">
                              <pre className={`text-xs overflow-auto max-h-40 p-2 rounded mt-1 whitespace-pre-wrap break-all ${isError ? 'bg-red-50 text-red-800' : 'bg-white text-gray-800'}`}>
                                {content ? (content.length > 2000 ? content.substring(0, 2000) + '\n...(已截断)' : content) : '（无内容）'}
                              </pre>
                              {result.error && (
                                <div className="text-xs text-red-600 mt-1">错误: {result.error}</div>
                              )}
                            </div>
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
        )}
      </div>
    </div>
  );
}

function MessageDetailPanel({ messageDetail }: { messageDetail: any }) {
  const parts = messageDetail?.parts || [];
  const info = messageDetail?.info || {};
  
  const [expandedParts, setExpandedParts] = useState<Record<number, boolean>>({});

  // 当 messageDetail 变化时，默认展开所有部分
  useEffect(() => {
    const initial: Record<number, boolean> = {};
    parts.forEach((_: any, index: number) => {
      initial[index] = true;
    });
    setExpandedParts(initial);
  }, [messageDetail]);

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
