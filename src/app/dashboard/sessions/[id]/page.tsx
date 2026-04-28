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
  RefreshCw,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EvaluationHeader } from '@/components/evaluation';
import {
  useEvaluation,
  useWorkflowNodes,
  useNodeMessages,
  useNodeTodos,
  useNodeChildren,
} from '@/lib/hooks';

// 辅助函数：格式化执行时长（自适应秒/分/小时）
function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h${remainingMinutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 ? `${minutes}m${remainingSeconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}

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
  
  // 确认路由参数
  console.log('[Page] Route param id:', id);
  console.log('[Page] Is id an evaluationId?', id?.startsWith('eval-'));
  
  // 注意：路由参数id可能是projectId，也可能是错误的evaluationId
  // 需要从evaluation.projectId获取真正的projectId
  const evaluationId = searchParams.get('evaluationId') || id; // 如果没有query参数，id可能就是evaluationId
  const projectId = searchParams.get('projectId'); // 尝试从query获取projectId
  
  console.log('[Page] evaluationId:', evaluationId);
  console.log('[Page] projectId from query:', projectId);

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
  const [preloadedAgentMessages, setPreloadedAgentMessages] = useState<Record<string, any[]>>({}); // 预加载的子Agent消息
  const [isTodosExpanded, setIsTodosExpanded] = useState(false);  // 任务列表默认收缩
  const [selectedSessionVuln, setSelectedSessionVuln] = useState<any>(null);
  const [isMessagesExpanded, setIsMessagesExpanded] = useState(false);
  const [isNodeMessagesExpanded, setIsNodeMessagesExpanded] = useState(true); // 节点消息区域默认展开（方便用户查看）
  const [isChildrenExpanded, setIsChildrenExpanded] = useState(false);
  const [isRalphLoopExpanded, setIsRalphLoopExpanded] = useState(false);
  const [vulnerabilitySummary, setVulnerabilitySummary] = useState<any>(null);
  const [progressQuestion, setProgressQuestion] = useState<string>('');
  const [showAllChildMessages, setShowAllChildMessages] = useState(false);
  const [expandedToolResults, setExpandedToolResults] = useState<Set<string>>(new Set());
  const [expandedChildMessages, setExpandedChildMessages] = useState<Set<string>>(new Set());
  const [expandedSkillDirectories, setExpandedSkillDirectories] = useState<Set<string>>(new Set());
  const [injectedExperiences, setInjectedExperiences] = useState<{ id: string; title: string; errorCategory: string; hitCount: number }[]>([]);
  const [experienceInjectionChecked, setExperienceInjectionChecked] = useState(false);
  
  // 工作流节点列表（合并配置和执行状态）
  const [workflowNodes, setWorkflowNodes] = useState<any[]>([]);
  const [nodeProgress, setNodeProgress] = useState<{
    total: number;
    completed: number;
    skipped: number;
    running: number;
    pending: number;
    failed: number;
    currentRunningNode: { id: string; label: string; modelName: string } | null;
  } | null>(null);
  const [isNodesExpanded, setIsNodesExpanded] = useState(true);  // 节点列表默认展开
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodeMessages, setNodeMessages] = useState<any[]>([]);
  const [loadingNodeMessages, setLoadingNodeMessages] = useState(false);
  
  // Skill agent 消息
  const [selectedSkillExecution, setSelectedSkillExecution] = useState<any>(null);
  const [skillMessages, setSkillMessages] = useState<any[]>([]);
  const [loadingSkillMessages, setLoadingSkillMessages] = useState(false);
  
  // 刷新按钮冷却时间控制
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);
  const [refreshCooldown, setRefreshCooldown] = useState(0);

  // 用 ref 持久保存子任务的 startedAt，防止轮询覆盖
  const childStartedAtRef = useRef<Record<string, string>>({});
  
  // 节点数据轮询控制 - 针对运行中的节点
  const nodePollingRef = useRef<{
    intervalId: NodeJS.Timeout | null;
    nodeId: string | null;
  }>({ intervalId: null, nodeId: null });
  
  // 已加载完成的节点ID集合（不再重复加载）
  const loadedCompletedNodesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!evaluationId) return;
    
    // 所有数据加载放在一个串行流程，每次调用后休息3秒
    const loadAllData = async () => {
      try {
        setLoading(true);
        
        // 1. 先获取评估基本信息（返回数据供后续使用）
        const evalData = await fetchEvaluation();
        await new Promise(r => setTimeout(r, 3000));
        
        const projectId = evalData?.projectId;
        console.log('[Init] After fetchEvaluation, projectId:', projectId, 'evalData exists:', !!evalData);
        
        // 2. 消息
        await fetchMessages();
        await new Promise(r => setTimeout(r, 3000));
        
        // 3. 进度问题
        await fetchProgressQuestion();
        await new Promise(r => setTimeout(r, 3000));
        
        // 4. 工作流节点
        await fetchWorkflowNodes();
        await new Promise(r => setTimeout(r, 3000));
        
        console.log('[Init] projectId check:', projectId ? 'passed' : 'FAILED - will skip SSE');
        
        if (projectId) {
          // 5. 会话详情
          await fetchSessionDetail();
          await new Promise(r => setTimeout(r, 3000));
          
          // 6. 任务列表
          await fetchTodos();
          await new Promise(r => setTimeout(r, 3000));
          
          // 7. SDK项目
          await fetchSdkProjects();
          await new Promise(r => setTimeout(r, 3000));
          
          // 8. 子会话
          await fetchChildrenSessions();
          await new Promise(r => setTimeout(r, 3000));
          
          // 9. 广播
          await fetchBroadcast();
        }
        
        setLoading(false);
      } catch (e) {
        console.error('[Init] Error:', e);
        setLoading(false);
      }
    };
    
    loadAllData();
  }, [evaluationId]);

  const fetchEvaluation = async (): Promise<any> => {
    if (!evaluationId) return null;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/evaluations/${evaluationId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        console.error('[fetchEvaluation] Error response text:', text.substring(0, 500));
        try {
          const data = JSON.parse(text);
          setError(data.error || '获取评估会话失败');
        } catch {
          setError(`服务器错误 (${response.status})`);
        }
        setLoading(false);
        return null;
      }

      const data = await response.json();
      console.log('[fetchEvaluation] 完整数据:', {
        id: data.evaluation?.id,
        projectId: data.evaluation?.projectId,
        ProjectId: data.evaluation?.Project?.id,
        status: data.evaluation?.status,
        totalInputTokens: data.evaluation?.totalInputTokens,
        totalOutputTokens: data.evaluation?.totalOutputTokens,
      });
      setEvaluation(data.evaluation);
      setLoading(false);
      return data.evaluation; // 返回数据供后续使用
    } catch (err) {
      console.error('Fetch evaluation error:', err);
      setError('网络错误，请重试');
      setLoading(false);
      return null;
    }
  };

  const fetchBroadcast = async () => {
    try {
      const response = await fetch('/api/broadcast');
      if (!response.ok) return;
      const data = await response.json();
      // 可根据需要处理广播内容
    } catch (err) {
      // 忽略广播错误
    }
  };

  const fetchMessages = async () => {
    if (!evaluationId) return;

    try {
      const token = localStorage.getItem('token');

      const response = await fetch(`/api/evaluations/${evaluationId}/messages`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const text = await response.text();
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
      setMessages(data.messages || []);
      setLoading(false);
    } catch (err) {
      console.error('[fetchMessages] Error:', err);
      setError('网络错误，请重试');
      setLoading(false);
    }
  };

  // 获取节点消息（按 nodeId 过滤）- 保留用于轮询
  const fetchNodeMessages = async (nodeId: string) => {
    if (!evaluationId) return;

    try {
      const token = localStorage.getItem('token');

      const response = await fetch(`/api/evaluations/${evaluationId}/messages?nodeId=${encodeURIComponent(nodeId)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        setNodeMessages([]);
        return;
      }

      const data = await response.json();
      setNodeMessages(data.messages || []);
    } catch (err) {
      setNodeMessages([]);
    }
  };

  // 获取 Skill agent 消息
  const fetchSkillMessages = async (executionId: string, nodeId: string) => {
    if (!evaluationId || !executionId) return;

    setLoadingSkillMessages(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `/api/evaluations/${evaluationId}/node-data?nodeId=${encodeURIComponent(nodeId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!response.ok) {
        setSkillMessages([]);
        return;
      }

      const data = await response.json();
      // agentMessages 按 executionId 分组
      const messages = data.agentMessages?.[executionId] || [];
      setSkillMessages(messages);
    } catch (err) {
      setSkillMessages([]);
    } finally {
      setLoadingSkillMessages(false);
    }
  };

  // 归一化节点数据加载 - 根据节点状态智能加载
  const fetchNodeData = async (nodeId: string, nodeStatus?: string) => {
    if (!evaluationId) return;

    // 即使节点是 pending 状态，也尝试加载（可能有历史数据）
    // 只有真正没有数据时才显示空
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `/api/evaluations/${evaluationId}/node-data?nodeId=${encodeURIComponent(nodeId)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!response.ok) {
        setNodeMessages([]);
        setTodos([]);
        setChildrenSessions([]);
        setPreloadedAgentMessages({});
        return;
      }

      const data = await response.json();
      console.log('[NodeData] Loaded:', data.total);
      
      // 解包数据到各状态
      setNodeMessages(data.messages || []);
      setTodos(data.todos || []);
      setChildrenSessions(data.children || []);
      setPreloadedAgentMessages(data.agentMessages || {});
      
      // 如果节点已完成，标记为已加载（不再重复）
      if (nodeStatus === 'completed' || (data.messages && data.messages.length > 0)) {
        loadedCompletedNodesRef.current.add(nodeId);
      }
    } catch (err) {
      console.error('[NodeData] Error:', err);
      setNodeMessages([]);
      setTodos([]);
      setChildrenSessions([]);
      setPreloadedAgentMessages({});
    }
  };
  
  // 启动节点级轮询（仅对运行中的节点）
  const startNodePolling = (nodeId: string) => {
    // 先停止之前的轮询
    stopNodePolling();
    
    nodePollingRef.current.nodeId = nodeId;
    console.log('[NodePoll] Started for node:', nodeId);
    
    nodePollingRef.current.intervalId = setInterval(() => {
      console.log('[NodePoll] Refreshing node data...');
      fetchNodeData(nodeId, 'running');
    }, 10000); // 每 10 秒刷新
  };
  
  // 停止节点级轮询
  const stopNodePolling = () => {
    if (nodePollingRef.current.intervalId) {
      clearInterval(nodePollingRef.current.intervalId);
      nodePollingRef.current.intervalId = null;
      console.log('[NodePoll] Stopped');
    }
    nodePollingRef.current.nodeId = null;
  };

  // 处理节点点击 - 根据节点状态智能加载
  const handleNodeClick = async (nodeId: string) => {
    if (selectedNodeId === nodeId) {
      // 取消选择
      setSelectedNodeId(null);
      setNodeMessages([]);
      setTodos([]);
      setChildrenSessions([]);
      setPreloadedAgentMessages({});
      stopNodePolling();
    } else {
      // 获取节点状态
      const node = workflowNodes.find((n: any) => n.id === nodeId);
      const nodeStatus = node?.status || 'pending';
      
      // 关闭 skill 详情，选择节点
      setSelectedSkillExecution(null);
      setSkillMessages([]);
      setSelectedNodeId(nodeId);
      
      // 始终尝试加载节点数据（即使状态是 pending，可能有历史数据）
      setLoadingNodeMessages(true);
      await fetchNodeData(nodeId, nodeStatus);
      setLoadingNodeMessages(false);
      
      // 只有运行中的节点才启动轮询
      if (nodeStatus === 'running') {
        startNodePolling(nodeId);
      } else {
        stopNodePolling();
      }
    }
  };
  
  // 清理：组件卸载或切换节点时停止轮询
  useEffect(() => {
    return () => {
      stopNodePolling();
    };
  }, []);
  
  // 刷新按钮冷却倒计时
  useEffect(() => {
    if (refreshCooldown <= 0) return;
    
    const timer = setInterval(() => {
      setRefreshCooldown(prev => {
        if (prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(timer);
  }, [refreshCooldown]);

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

  const fetchTodos = async (nodeId?: string) => {
    // 如果没有 evaluationId 且没有 opencodeSessionId，直接返回
    if (!evaluationId && !evaluation?.opencodeSessionId) return;

    if (evaluationId) {
      try {
        const token = localStorage.getItem('token');
        const url = nodeId 
          ? `/api/evaluations/${evaluationId}/todos?nodeId=${encodeURIComponent(nodeId)}`
          : `/api/evaluations/${evaluationId}/todos`;
        
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          setTodos(data.todos || []);
          return;
        }
      } catch (err) {
        console.error('[TODO] Error fetching:', err);
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
        return;
      }

      const data = await response.json();
      setTodos(data.todos || []);
    } catch (err) {
      console.error('[TODO] Error fetching todos:', err);
    }
  };

  const fetchSdkProjects = async () => {
    if (!evaluationId) return;

    setLoadingSdkProjects(true);
    try {
      const token = localStorage.getItem('token');

      // 串行获取SDK项目列表和当前项目
      const listResponse = await fetch(`/api/projects/sdk/list?evaluationId=${evaluationId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await new Promise(r => setTimeout(r, 1000));

      if (listResponse.ok) {
        const listData = await listResponse.json();
        setSdkProjects(listData.projects || []);
        console.log('[SDK Projects] List:', listData.projects?.length || 0);
      }

      const currentResponse = await fetch(`/api/projects/sdk/current?evaluationId=${evaluationId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

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

const fetchChildrenSessions = async (nodeId?: string) => {
    // 如果没有 evaluationId 且没有 opencodeSessionId，直接返回
    if (!evaluationId && !evaluation?.opencodeSessionId) return;

    try {
      const token = localStorage.getItem('token');
      
      // 优先使用 evaluationId 获取子Agent列表
      if (evaluationId) {
        const url = nodeId 
          ? `/api/evaluations/${evaluationId}/children?nodeId=${encodeURIComponent(nodeId)}`
          : `/api/evaluations/${evaluationId}/children`;
        
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          setChildrenSessions(data.children || []);
          return;
        }
      }

      // 兼容旧的 opencodeSessionId 方式
      if (!evaluation?.opencodeSessionId) return;

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
        setChildrenSessions(fallbackData.children || []);
      }
    } catch (err) {
      // 忽略错误
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

  // 获取子会话消息 - 从预加载的 agentMessages 中读取（无需API调用）
  const fetchChildSessionMessages = async (childId: string) => {
    // 优先使用预加载的消息
    if (preloadedAgentMessages[childId] && preloadedAgentMessages[childId].length > 0) {
      console.log('[Child Messages] Using preloaded:', preloadedAgentMessages[childId].length);
      setChildSessionMessages(preloadedAgentMessages[childId]);
      return;
    }
    
    // 如果预加载中没有，尝试从 evaluations API 获取
    setLoadingChildMessages(true);
    try {
      const token = localStorage.getItem('token');
      
      const response = await fetch(
        `/api/evaluations/${evaluationId}/children?nodeId=${selectedNodeId}&childId=${encodeURIComponent(childId)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      
      if (response.ok) {
        const data = await response.json();
        console.log('[Child Messages] From evaluations API:', data.messages?.length || 0);
        setChildSessionMessages(data.messages || []);
      } else {
        console.log('[Child Messages] No messages found for child:', childId);
        setChildSessionMessages([]);
      }
    } catch (err) {
      console.error('[Child Messages] Error:', err);
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

      // 刷新所有状态
      fetchEvaluation();
      fetchWorkflowNodes();
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
      {/* 评估头部组件 - Token 从 workflowNodes 汇总（实时数据） */}
      <EvaluationHeader 
        status={evaluation?.status || 'pending'}
        totalInputTokens={evaluation?.totalInputTokens || workflowNodes.reduce((sum, node) => sum + (node.inputTokens || 0), 0)}
        totalOutputTokens={evaluation?.totalOutputTokens || workflowNodes.reduce((sum, node) => sum + (node.outputTokens || 0), 0)}
        projectName={evaluation?.Project?.name}
        workflowType={evaluation?.workflowType}
        onStop={handleStopEvaluation}
        onBack={() => router.push('/dashboard/sessions')}
        onViewReport={() => router.push(`/dashboard/evaluations/${evaluationId}/report`)}
        onAskProgress={handleAskProgress}
        onDelete={handleDeleteEvaluation}
        progressQuestion={progressQuestion}
        evaluation={evaluation}
      />
      
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
            
            {/* 公共任务列表已移除 - 任务现在按节点显示 */}
            {/* 点击节点查看该节点的任务、消息和子Agent */}
            
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
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => setIsNodesExpanded(!isNodesExpanded)}
                    className="flex items-center text-lg font-semibold text-gray-900 hover:text-gray-700 transition-colors"
                  >
                    <GitBranch size={18} className="mr-2 text-orange-600" />
                    节点列表 ({workflowNodes.length})
                    <span className="ml-2 text-xs text-gray-400 font-normal">点击节点查看消息</span>
                    {isNodesExpanded ? <ChevronUp size={20} className="ml-2" /> : <ChevronDown size={20} className="ml-2" />}
                  </button>
                  
                  {/* 刷新按钮 */}
                  <button
                    onClick={() => {
                      if (refreshCooldown > 0) return;
                      fetchWorkflowNodes();
                      setLastRefreshTime(new Date());
                      setRefreshCooldown(30);
                    }}
                    disabled={refreshCooldown > 0}
                    className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-md transition-colors ${
                      refreshCooldown > 0
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                    }`}
                    title={refreshCooldown > 0 ? `${refreshCooldown}秒后可刷新` : '刷新节点数据'}
                  >
                    <RefreshCw size={14} />
                    <span>
                      {refreshCooldown > 0 ? `刷新 (${refreshCooldown}秒后)` : '刷新'}
                    </span>
                  </button>
                </div>
                
                {/* 执行进度 */}
                {nodeProgress && (
                  <div className="mb-3 p-3 bg-gradient-to-r from-orange-50 to-blue-50 rounded-lg border border-orange-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <span className="text-sm font-medium text-gray-700">
                          执行进度: 
                          <span className="text-orange-600 ml-1">{nodeProgress.completed + (nodeProgress.skipped || 0)}</span>
                          <span className="text-gray-400"> / </span>
                          <span className="text-gray-900">{nodeProgress.total}</span>
                          <span className="text-gray-500 ml-1">节点</span>
                        </span>
                        {/* 进度条 - 完成和跳过都算作已完成 */}
                        <div className="flex-1 max-w-xs">
                          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full transition-all duration-300"
                              style={{ width: `${((nodeProgress.completed + (nodeProgress.skipped || 0)) / nodeProgress.total) * 100}%` }}
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
                      {nodeProgress.skipped > 0 && (
                        <span className="flex items-center gap-1">
                          <CheckCircle2 size={12} className="text-gray-400" />
                          <span className="text-gray-500">{nodeProgress.skipped} 跳过</span>
                        </span>
                      )}
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
                      
                      // 状态图标和颜色（包含跳过状态）
                      const statusConfig = {
                        completed: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-50', border: 'border-green-200', label: '完成' },
                        running: { icon: Loader2, color: 'text-blue-500 animate-spin', bg: 'bg-blue-50', border: 'border-blue-200', label: '运行中' },
                        pending: { icon: Circle, color: 'text-gray-400', bg: 'bg-gray-50', border: 'border-gray-200', label: '等待' },
                        failed: { icon: X, color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-200', label: '失败' },
                        skipped: { icon: CheckCircle2, color: 'text-gray-400', bg: 'bg-gray-50', border: 'border-gray-300', label: '跳过' },
                      };
                      // 如果节点是跳过的，使用 skipped 配置
                      const actualStatus = node.skipped ? 'skipped' : (node.status as keyof typeof statusConfig);
                      const config = statusConfig[actualStatus] || statusConfig.pending;
                      const StatusIcon = config.icon;
                      
                      // 检测是否是目录节点（有 skill 且为 vulnerability/manual 模式）
                      // vulnerability 模式：skillsDetails.length >= 1
                      // manual 模式：skills.length >= 1
                      const isDirectoryNode = node.skillLoadingMode && 
                        ['vulnerability', 'manual'].includes(node.skillLoadingMode) && 
                        ((node.skillLoadingMode === 'vulnerability' && node.skillsDetails && node.skillsDetails.length >= 1) ||
                         (node.skillLoadingMode === 'manual' && node.skills && node.skills.length >= 1));
                      
                      // 计算目录节点的整体进度
                      const directoryProgress = isDirectoryNode && node.skillsDetails ? {
                        total: node.skillsDetails.length,
                        completed: node.skillsDetails.filter((s: any) => s.executionStatus === 'completed').length,
                        running: node.skillsDetails.filter((s: any) => s.executionStatus === 'running').length,
                        pending: node.skillsDetails.filter((s: any) => s.executionStatus === 'pending').length,
                        failed: node.skillsDetails.filter((s: any) => s.executionStatus === 'failed').length,
                      } : null;
                      
                      // 目录节点是否展开
                      const isDirectoryExpanded = expandedSkillDirectories.has(node.id);
                      
                      // 切换目录展开状态
                      const toggleDirectoryExpand = (e: React.MouseEvent) => {
                        e.stopPropagation();
                        const newSet = new Set(expandedSkillDirectories);
                        if (newSet.has(node.id)) {
                          newSet.delete(node.id);
                        } else {
                          newSet.add(node.id);
                        }
                        setExpandedSkillDirectories(newSet);
                      };
                      
                      return (
                        <div 
                          key={node.id || `node-${index}`} 
                          className={`p-3 rounded-lg border transition-all duration-200 ${
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
                              
                              {/* 目录节点展开/收缩按钮 */}
                              {isDirectoryNode && (
                                <button
                                  onClick={toggleDirectoryExpand}
                                  className="p-1 hover:bg-gray-200 rounded transition-colors"
                                  title={isDirectoryExpanded ? '收缩' : '展开'}
                                >
                                  {isDirectoryExpanded ? (
                                    <ChevronDown size={16} className="text-gray-600" />
                                  ) : (
                                    <ChevronRight size={16} className="text-gray-600" />
                                  )}
                                </button>
                              )}
                              
                              {/* 节点信息 */}
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-gray-900">
                                    {node.label || `节点 ${index + 1}`}
                                  </span>
                                  {/* 跳过标记 */}
                                  {node.skipped && (
                                    <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded border border-gray-300">
                                      跳过
                                    </span>
                                  )}
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
                                  {/* 目录节点进度 */}
                                  {isDirectoryNode && directoryProgress && !isDirectoryExpanded && (
                                    <span className="text-xs text-gray-500">
                                      已完成 {directoryProgress.completed} / {directoryProgress.total}
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
                                  {!isDirectoryNode && node.skills && node.skills.length > 0 && (
                                    <span className="text-gray-400">
                                      Skills: {node.skills.length}
                                    </span>
                                  )}
                                  {/* 执行时长 */}
                                  {duration != null && (
                                    <span className="flex items-center gap-1">
                                      <Clock size={10} />
                                      {formatDuration(duration)}
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
                                
                                {/* 目录节点展开后的 skill 列表 */}
                                {isDirectoryNode && isDirectoryExpanded && node.skillsDetails && (
                                  <div className="mt-2 pl-4 space-y-1">
                                    {node.skillsDetails.map((skill: any, skillIndex: number) => {
                                      const skillStatus = skill.executionStatus || 'pending';
                                      const skillStatusConfig = statusConfig[skillStatus as keyof typeof statusConfig] || statusConfig.pending;
                                      const SkillStatusIcon = skillStatusConfig.icon;
                                      return (
                                        <div 
                                          key={skill.executionId || `skill-${skillIndex}`}
                                          className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-gray-50 cursor-pointer hover:bg-gray-100"
                                          onClick={() => {
                                            setSelectedNodeId(null);  // 关闭节点详情
                                            setNodeMessages([]);
                                            setSelectedSkillExecution(skill);
                                            fetchSkillMessages(skill.executionId, node.id);
                                          }}
                                        >
                                          <SkillStatusIcon size={14} className={skillStatusConfig.color} />
                                          <span className="text-gray-700">
                                            {skill.displayName || skill.name || `Skill ${skillIndex + 1}`}
                                          </span>
                                          <span className={`ml-auto ${skillStatusConfig.color}`}>
                                            {skillStatusConfig.label}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
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

            {/* Skill Agent Messages Panel */}
            {selectedSkillExecution && (
              <div className="mb-6 bg-white rounded-lg border border-purple-300 p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold text-gray-900">
                      {selectedSkillExecution.displayName || selectedSkillExecution.name}
                    </span>
                    <span className="text-sm text-gray-500 bg-purple-100 px-2 py-0.5 rounded">
                      Skill Agent
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedSkillExecution(null);
                      setSkillMessages([]);
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                    title="关闭 Skill 详情"
                  >
                    <X size={14} />
                    <span>关闭</span>
                  </button>
                </div>

                {/* Skill 执行状态 */}
                <div className="flex items-center gap-2 mb-4 text-xs">
                  <span className={`px-2 py-1 rounded ${
                    selectedSkillExecution.executionStatus === 'completed' ? 'bg-green-100 text-green-700' :
                    selectedSkillExecution.executionStatus === 'running' ? 'bg-blue-100 text-blue-700' :
                    selectedSkillExecution.executionStatus === 'failed' ? 'bg-red-100 text-red-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {selectedSkillExecution.executionStatus}
                  </span>
                  {selectedSkillExecution.executionOrder && (
                    <span className="text-gray-500">order: {selectedSkillExecution.executionOrder}</span>
                  )}
                </div>

                {/* Skill 消息列表 */}
                {loadingSkillMessages ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-purple-600" />
                  </div>
                ) : skillMessages.length > 0 ? (
                  <div className="space-y-2 max-h-[500px] overflow-y-auto">
                    {skillMessages.map((msg: any, idx: number) => (
                      <MessageBubble
                        key={msg.id || `skill-msg-${idx}`}
                        message={msg}
                        onCopy={() => {
                          navigator.clipboard.writeText(
                            typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2)
                          );
                        }}
                        onClick={() => {
                          setSelectedMessage(msg);
                          setMessageDetail({
                            id: msg.id,
                            role: msg.role,
                            content: msg.content,
                            createdAt: msg.createdAt,
                            executionId: selectedSkillExecution.executionId,
                          });
                        }}
                        isSelected={selectedMessage?.id === msg.id}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-gray-500">暂无消息</p>
                  </div>
                )}
              </div>
            )}

            {/* Node Detail Panel - 当选中节点时显示节点的消息、任务、子Agent */}
            {selectedNodeId && (
              <div className="mb-6 bg-white rounded-lg border border-blue-300 p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold text-gray-900">
                      {workflowNodes.find((n: any) => n.id === selectedNodeId)?.label || '未知节点'}
                    </span>
                    <span className="text-sm text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                      节点详情
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedNodeId(null);
                      setNodeMessages([]);
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                    title="关闭节点详情"
                  >
                    <X size={14} />
                    <span>关闭</span>
                  </button>
                </div>
                
                {/* 节点关系 - 显示前置和后继节点 */}
                {(() => {
                  const currentNode = workflowNodes.find((n: any) => n.id === selectedNodeId);
                  if (!currentNode) return null;
                  
                  const prevNodes = (currentNode.prevNodeIds || []).map((id: string) => 
                    workflowNodes.find((n: any) => n.id === id)
                  ).filter(Boolean);
                  const nextNodes = (currentNode.nextNodeIds || []).map((id: string) => 
                    workflowNodes.find((n: any) => n.id === id)
                  ).filter(Boolean);
                  
                  if (prevNodes.length === 0 && nextNodes.length === 0) return null;
                  
                  return (
                    <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                        <GitBranch size={16} className="text-orange-600" />
                        <span>节点关系</span>
                      </div>
                      <div className="flex flex-wrap gap-4 text-xs">
                        {/* 前置节点 */}
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500">前置节点:</span>
                          {prevNodes.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {prevNodes.map((n: any) => (
                                <span 
                                  key={n.id}
                                  className="px-2 py-0.5 bg-green-100 text-green-700 rounded cursor-pointer hover:bg-green-200"
                                  onClick={() => handleNodeClick(n.id)}
                                >
                                  {n.label}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-400">无</span>
                          )}
                        </div>
                        {/* 后继节点 */}
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500">后继节点:</span>
                          {nextNodes.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {nextNodes.map((n: any) => (
                                <span 
                                  key={n.id}
                                  className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded cursor-pointer hover:bg-blue-200"
                                  onClick={() => handleNodeClick(n.id)}
                                >
                                  {n.label}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-400">无</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
                
                {loadingNodeMessages ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                    <span className="ml-2 text-sm text-gray-500">加载节点数据...</span>
                  </div>
                ) : (
                  <div className="space-y-4">
{/* 节点任务 */}
                     <div className="border border-gray-200 rounded-lg p-3">
                       <button
                         className="w-full flex items-center justify-between text-sm font-semibold text-gray-700"
                         onClick={() => setIsTodosExpanded(!isTodosExpanded)}
                       >
                         <div className="flex items-center gap-2">
                           <ListTodo size={16} className="text-blue-600" />
                           <span>节点任务</span>
                           <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                             {todos.filter((t: any) => 
                               t.nodeId === selectedNodeId || t.workflowNodeId === selectedNodeId
                             ).length} 个
                           </span>
                         </div>
                         {isTodosExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                       </button>
                       {isTodosExpanded && (
                         <div className="mt-3 space-y-2">
                           {todos.filter((t: any) => 
                             t.nodeId === selectedNodeId || t.workflowNodeId === selectedNodeId
                           ).length === 0 ? (
                             <p className="text-sm text-gray-500 text-center py-2">该节点暂无任务</p>
                           ) : (
                             todos.filter((t: any) => 
                               t.nodeId === selectedNodeId || t.workflowNodeId === selectedNodeId
                             ).map((todo: any, idx: number) => (
                               <TodoItem key={todo.id || `todo-${idx}`} todo={todo} />
                             ))
                           )}
                         </div>
                       )}
                     </div>
                    
                    {/* 节点消息 */}
                    <div className="border border-gray-200 rounded-lg p-3">
                      <button
                        className="w-full flex items-center justify-between text-sm font-semibold text-gray-700"
                        onClick={() => setIsNodeMessagesExpanded(!isNodeMessagesExpanded)}
                      >
                        <div className="flex items-center gap-2">
                          <MessageSquare size={16} className="text-green-600" />
                          <span>节点消息</span>
                          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                            {nodeMessages.length} 条
                          </span>
                        </div>
                        {isNodeMessagesExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                      {isNodeMessagesExpanded && (
                        <div className="mt-3 space-y-3 max-h-80 overflow-y-auto">
                          {nodeMessages.length === 0 ? (
                            <p className="text-sm text-gray-500 text-center py-2">该节点暂无消息</p>
                          ) : (
                            nodeMessages.map((message: any, index: number) => (
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
                                  let parts: any[] = [];
                                  const content = message.content;
                                  if (typeof content === 'string') {
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
                                    parts: parts,
                                    info: {
                                      id: message.id,
                                      role: message.role,
                                      time: { created: message.createdAt },
                                    },
                                  });
                                }}
                                isSelected={selectedMessage?.id === message.id}
                              />
                            ))
                          )}
                        </div>
                      )}
                    </div>
                    
{/* 节点子Agent - 使用API返回的children列表（而非从nodeMessages提取） */}
                      <div className="border border-gray-200 rounded-lg p-3">
                        <button
                          className="w-full flex items-center justify-between text-sm font-semibold text-gray-700"
                          onClick={() => setIsChildrenExpanded(!isChildrenExpanded)}
                        >
                          <div className="flex items-center gap-2">
                            <GitBranch size={16} className="text-purple-600" />
                            <span>子Agent调用</span>
                            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                              {childrenSessions.length} 个
                            </span>
                          </div>
                          {isChildrenExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                        {isChildrenExpanded && (
                          <div className="mt-3 space-y-2">
                            {childrenSessions.length === 0 ? (
                              <p className="text-sm text-gray-500 text-center py-2">该节点暂无子Agent调用</p>
                            ) : (
                              childrenSessions.map((child: any, idx: number) => {
                                const childKey = child.agentId || child.toolUseId || child.id;
                                const isExpanded = expandedChildMessages.has(childKey);
                                
                                // 状态图标
                                const statusIcon = {
                                  completed: { icon: CheckCircle2, color: 'text-green-500' },
                                  running: { icon: Loader2, color: 'text-blue-500 animate-spin' },
                                  failed: { icon: X, color: 'text-red-500' },
                                  active: { icon: Circle, color: 'text-gray-400' },
                                };
                                const iconConfig = statusIcon[child.status as keyof typeof statusIcon] || statusIcon.active;
                                const StatusIcon = iconConfig.icon;
                                
                                return (
                                  <div key={childKey} className="bg-purple-50 rounded border border-purple-200">
                                    <button
                                      className="w-full p-2 flex items-center justify-between hover:bg-purple-100 transition-colors"
                                      onClick={() => {
                                        const newExpanded = !expandedChildMessages.has(childKey);
                                        setExpandedChildMessages(prev => {
                                          const newSet = new Set(prev);
                                          if (newSet.has(childKey)) {
                                            newSet.delete(childKey);
                                          } else {
                                            newSet.add(childKey);
                                          }
                                          return newSet;
                                        });
                                        
                                        // 展开时使用预加载消息（无需API调用）
                                        if (newExpanded) {
                                          // 优先使用预加载消息
                                          const agentId = child.agentId || childKey;
                                          console.log('[子Agent] Using preloaded messages for:', agentId);
                                          
                                          if (preloadedAgentMessages[agentId]) {
                                            setChildSessionMessages(preloadedAgentMessages[agentId]);
                                          } else {
                                            // 备用：API调用
                                            fetchChildSessionMessages(agentId);
                                          }
                                        }
                                      }}
                                    >
                                      <div className="flex items-center gap-2">
                                        <StatusIcon size={14} className={iconConfig.color} />
                                        <span className="text-xs font-medium text-purple-700">
                                          {child.type === 'task' ? 'Task' : 'Agent'}
                                        </span>
                                        <span className="text-xs text-gray-600 truncate max-w-[200px]">
                                          {child.title}
                                        </span>
                                        {child.messageCount && (
                                          <span className="text-xs bg-purple-100 text-purple-600 px-1 rounded">
                                            {child.messageCount} 条消息
                                          </span>
                                        )}
                                      </div>
                                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                    </button>
                                    
                                    {isExpanded && (
                                      <div className="p-3 border-t border-purple-200 bg-white">
                                        {/* 显示子Agent消息 - 直接使用 childSessionMessages */}
                                        {childSessionMessages.length > 0 ? (
                                          <div className="space-y-2 max-h-[500px] overflow-y-auto">
                                            {childSessionMessages.map((childMsg: any, msgIdx: number) => (
                                              <MessageBubble
                                                key={childMsg.id || `child-msg-${msgIdx}`}
                                                message={childMsg}
                                                onCopy={() => {
                                                  navigator.clipboard.writeText(
                                                    typeof childMsg.content === 'string' 
                                                      ? childMsg.content 
                                                      : JSON.stringify(childMsg.content, null, 2)
                                                  );
                                                }}
                                                onClick={() => {
                                                  setSelectedMessage(childMsg);
                                                  let parts: any[] = [];
                                                  const content = childMsg.content;
                                                  if (typeof content === 'string') {
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
                                                    id: childMsg.id,
                                                    role: childMsg.role,
                                                    content: childMsg.content,
                                                    createdAt: childMsg.createdAt,
                                                    agentId: childMsg.agentId,
                                                    parts: parts,
                                                    info: {
                                                      id: childMsg.id,
                                                      role: childMsg.role,
                                                      time: { created: childMsg.createdAt },
                                                    },
                                                  });
                                                }}
                                                isSelected={selectedMessage?.id === childMsg.id}
                                              />
                                            ))}
                                          </div>
                                        ) : (
                                          <div className="text-xs text-gray-500 italic">暂无执行消息</div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                  </div>
                )}
              </div>
            )}
            
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
  const isToolCall = message.role === 'tool_call';
  const isToolResult = message.role === 'tool_result';
  const isThinking = message.role === 'thinking';
  const isAssistant = message.role === 'assistant' || message.role === 'assistant_chunk';
  // 工具结果显示在右边（用户侧），因为它是给 AI 的输入
  // thinking 消息显示在左边（AI 侧）
  const isRightSide = isUser || isToolResult;
  const [isCollapsed, setIsCollapsed] = useState(true); // 默认收缩
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [expandedThinking, setExpandedThinking] = useState(false);
  const [expandedReasoning, setExpandedReasoning] = useState(false);
  const [expandedToolSection, setExpandedToolSection] = useState(false);
  const [expandedResultSection, setExpandedResultSection] = useState(false);

  // 解析所有内容部分
  const parseContent = () => {
    if (typeof message.content === 'string') {
      // 对于工具调用，尝试解析 JSON（包含 toolUseId）
      if (isToolCall) {
        try {
          const parsed = JSON.parse(message.content);
          return [{ 
            type: 'tool_call', 
            toolUseId: parsed.toolUseId || parsed.id || 'unknown',
            name: parsed.name, 
            args: parsed.args 
          }];
        } catch {
          return [{ type: 'tool_call', text: message.content }];
        }
      }
      // 对于工具结果（包含 isError）
      if (isToolResult) {
        // 尝试从 metadata 解析
        let toolUseId = 'unknown';
        let isError = false;
        if (message.metadata) {
          try {
            const meta = JSON.parse(message.metadata);
            toolUseId = meta.toolUseId || 'unknown';
            isError = meta.isError || false;
          } catch {}
        }
        return [{ 
          type: 'tool_result', 
          toolUseId,
          content: message.content,
          isError 
        }];
      }
      // thinking 角色
      if (message.role === 'thinking') {
        return [{ type: 'thinking', thinking: message.content }];
      }
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
  const toolUseParts = parts.filter((p: any) => p.type === 'tool_use' || p.type === 'tool_call');
  const toolResultParts = parts.filter((p: any) => p.type === 'tool_result');
  const subtaskParts = parts.filter((p: any) => p.type === 'subtask' || p.type === 'todo');
  const thinkingParts = parts.filter((p: any) => p.type === 'thinking');

  // 合并文本内容用于复制和预览
  const textContent = textParts.map((p: any) => p.text || '').join('\n');
  
  // 获取文本预览（前30字符）
  const textPreview = textContent.substring(0, 30) + (textContent.length > 30 ? '...' : '');

  return (
    <div className={`flex ${isRightSide ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[90%] rounded-lg transition-all duration-200 ${
          isSelected
            ? isRightSide
              ? 'bg-blue-600 text-white ring-2 ring-blue-400'
              : isToolCall
              ? 'bg-purple-100 text-purple-800 ring-2 ring-purple-400'
              : 'bg-blue-50 border-2 border-blue-400 shadow-md'
            : isRightSide
            ? 'bg-blue-500 text-white hover:bg-blue-600'
            : isToolCall
            ? 'bg-purple-50 border border-purple-200 hover:bg-purple-100'
            : 'bg-white border border-gray-200 shadow-sm hover:shadow-md'
        }`}
      >
        {/* 可点击的标题行（摘要） - 点击展开/收缩 */}
        <button
          className={`w-full flex items-center justify-between px-4 py-2 text-left transition-colors ${
            isCollapsed ? (isRightSide ? 'hover:bg-blue-600' : 'hover:bg-gray-50') : ''
          } ${isRightSide && !isCollapsed ? 'rounded-t-lg' : ''} ${isRightSide && isCollapsed ? 'rounded-lg' : ''}`}
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <div className="flex items-center space-x-2 min-w-0 flex-1 flex-wrap">
            {/* 角色图标 */}
            <span className={`text-xs font-medium flex-shrink-0 ${
              isRightSide ? 'text-white' : isToolCall ? 'text-purple-700' : isThinking ? 'text-yellow-700' : 'text-gray-700'
            }`}>
              {isUser ? '👤 用户' : isToolResult ? '📤 执行结果' : isToolCall ? '🔧 工具调用' : isThinking ? '🧠 思考' : '🤖 AI'}
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
                isRightSide ? 'bg-blue-400 text-white' : 'bg-blue-100 text-blue-700'
              }`}>
                🔧 {toolUseParts.length}
              </span>
            )}
            
            {/* 工具结果标签 */}
            {toolResultParts.length > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                isRightSide ? 'bg-blue-300 text-white' : 'bg-gray-200 text-gray-700'
              }`}>
                📤 {toolResultParts.length}
              </span>
            )}
            
            {/* 推理标签 */}
            {reasoningParts.length > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                isRightSide ? 'bg-purple-400 text-white' : 'bg-purple-100 text-purple-700'
              }`}>
                推理
              </span>
            )}
            
            {/* 思考标签 */}
            {thinkingParts.length > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                isRightSide ? 'bg-yellow-400 text-white' : 'bg-yellow-100 text-yellow-700'
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
