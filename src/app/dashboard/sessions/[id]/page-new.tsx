'use client';

import { Suspense, useState, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Square,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle2,
  Circle,
  X,
  GitBranch,
  MessageSquare,
  ListTodo,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  useEvaluation,
  useWorkflowNodes,
  useNodeMessages,
  useNodeTodos,
  useNodeChildren,
} from '@/lib/hooks';

// 辅助函数：获取消息内容预览
function getContentPreview(content: any): string {
  if (!content) return '（空）';
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content);
      if (parsed.args?.description) return parsed.args.description.substring(0, 50);
      if (parsed.args?.prompt) return parsed.args.prompt.substring(0, 50);
      return content.substring(0, 50);
    } catch {
      return content.substring(0, 50);
    }
  }
  return '（非文本）';
}

// Agent状态图标
function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    case 'completed':
      return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    case 'failed':
      return <X className="w-4 h-4 text-red-500" />;
    default:
      return <Circle className="w-4 h-4 text-gray-400" />;
  }
}

export default function EvaluationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const evaluationId = searchParams.get('evaluationId') || resolvedParams.id;
  const projectId = resolvedParams.id;
  
  // 选中的Agent
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [isMessagesExpanded, setIsMessagesExpanded] = useState(true);
  const [isTodosExpanded, setIsTodosExpanded] = useState(true);
  const [isChildrenExpanded, setIsChildrenExpanded] = useState(true);

  // SWR hooks 获取数据
  const { evaluation, isLoading: evalLoading, mutate: mutateEval } = useEvaluation(evaluationId);
  const { nodes: agents, isLoading: agentsLoading, mutate: mutateAgents } = useWorkflowNodes(evaluationId, evaluation?.status);
  
  // 点击Agent后的详情数据（自动刷新）
  const { messages, isLoading: messagesLoading, mutate: mutateMessages } = useNodeMessages(evaluationId, selectedAgentId, evaluation?.status);
  const { todos, isLoading: todosLoading, mutate: mutateTodos } = useNodeTodos(evaluationId, selectedAgentId, evaluation?.status);
  const { children, isLoading: childrenLoading, mutate: mutateChildren } = useNodeChildren(evaluationId, selectedAgentId, evaluation?.status);

  // 点击Agent
  const handleAgentClick = (agentId: string) => {
    if (selectedAgentId === agentId) {
      setSelectedAgentId(null); // 取消选择
    } else {
      setSelectedAgentId(agentId); // 选择Agent
    }
  };

  // 停止评估
  const handleStopEvaluation = async () => {
    if (!evaluationId) return;
    
    const token = localStorage.getItem('token');
    const response = await fetch(`/api/evaluations/${evaluationId}/stop`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    
    if (response.ok) {
      mutateEval(); // 刷新评估状态
      mutateAgents(); // 刷新Agent列表
    }
  };

  // 返回项目列表
  const handleBack = () => {
    router.push('/dashboard/sessions');
  };

  // 计算总Token
  const totalInputTokens = evaluation?.totalInputTokens || 0;
  const totalOutputTokens = evaluation?.totalOutputTokens || 0;
  const totalTokens = totalInputTokens + totalOutputTokens;

  // Agent卡片样式
  const getAgentStyle = (status: string) => {
    switch (status) {
      case 'running':
        return 'border-blue-500 bg-blue-900/20';
      case 'completed':
        return 'border-green-500 bg-green-900/20';
      case 'failed':
        return 'border-red-500 bg-red-900/20';
      default:
        return 'border-gray-600 bg-[#0F172A]';
    }
  };

  if (evalLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  if (!evaluation) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-gray-500 mb-4">评估不存在</p>
          <button onClick={handleBack} className="text-blue-500 hover:underline">
            返回列表
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* 顶部导航栏 */}
      <div className="bg-dark-surface shadow-sm px-4 py-3 flex items-center justify-between">
        <button onClick={handleBack} className="flex items-center gap-2 text-gray-400 hover:text-gray-100">
          <ArrowLeft size={20} />
          <span>返回</span>
        </button>
        
        <div className="flex items-center gap-4">
          {/* Token统计 */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">Token:</span>
            <span className="font-medium">{totalTokens.toLocaleString()}</span>
            <span className="text-gray-400">(输入: {totalInputTokens.toLocaleString()}, 输出: {totalOutputTokens.toLocaleString()})</span>
          </div>
          
          {/* 状态 */}
          <div className="flex items-center gap-2">
            <StatusIcon status={evaluation.status} />
            <span className="text-sm">{evaluation.status}</span>
          </div>
          
          {/* 停止按钮 */}
          {evaluation.status === 'running' && (
            <button
              onClick={handleStopEvaluation}
              className="flex items-center gap-1 px-3 py-1 bg-red-600 text-white rounded hover:bg-red-600"
            >
              <Square size={16} />
              <span>停止</span>
            </button>
          )}
        </div>
      </div>

      {/* 主内容区 */}
      <div className="max-w-6xl mx-auto p-4">
        {/* 评估标题 */}
        <div className="bg-dark-surface rounded-lg shadow p-4 mb-4">
          <h1 className="text-xl font-semibold">{evaluation.Project?.name || '评估详情'}</h1>
          <p className="text-gray-500 text-sm mt-1">
            工作流: {evaluation.workflowType === 'fsm' ? 'FSM流程' : 'DAG编排'}
          </p>
        </div>

        {/* Agent列表 */}
        <div className="bg-dark-surface rounded-lg shadow p-4 mb-4">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <span>Agent列表</span>
            <span className="text-sm text-gray-500">({agents.length}个)</span>
          </h2>
          
          {agentsLoading ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner size="lg" />
            </div>
          ) : agents.length === 0 ? (
            <p className="text-gray-500 text-center py-8">暂无Agent</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {agents.map((agent: any) => (
                <button
                  key={agent.id}
                  onClick={() => handleAgentClick(agent.id)}
                  className={`p-3 rounded-lg border-2 transition-all hover:shadow-md ${getAgentStyle(agent.status)} ${selectedAgentId === agent.id ? 'ring-2 ring-blue-400' : ''}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">{agent.label}</span>
                    <StatusIcon status={agent.status} />
                  </div>
                  <div className="text-xs text-gray-500">
                    Token: {(agent.inputTokens || 0) + (agent.outputTokens || 0)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 选中Agent的详情 */}
        {selectedAgentId && (
          <div className="bg-dark-surface rounded-lg shadow p-4">
            <h2 className="text-lg font-semibold mb-4">
              Agent详情: {agents.find((a: any) => a.id === selectedAgentId)?.label}
            </h2>
            
            {/* 消息列表 */}
            <div className="mb-4 border rounded-lg p-3">
              <button
                onClick={() => setIsMessagesExpanded(!isMessagesExpanded)}
                className="flex items-center justify-between w-full font-medium text-gray-300"
              >
                <span className="flex items-center gap-2">
                  <MessageSquare size={18} className="text-blue-500" />
                  <span>消息</span>
                  <span className="text-xs text-gray-500">({messages.length})</span>
                </span>
                {isMessagesExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
              
              {isMessagesExpanded && (
                <div className="mt-3 space-y-2 max-h-[400px] overflow-auto">
                  {messagesLoading ? (
                    <LoadingSpinner size="md" />
                  ) : messages.length === 0 ? (
                    <p className="text-gray-500 text-sm">暂无消息</p>
                  ) : (
                    messages.slice(-20).map((msg: any) => (
                      <div key={msg.id} className="p-2 bg-[#0F172A] rounded text-sm">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-gray-400">{msg.role}</span>
                          <span className="text-xs text-gray-400">{new Date(msg.createdAt).toLocaleTimeString()}</span>
                        </div>
                        <div className="text-gray-300 whitespace-pre-wrap">
                          {getContentPreview(msg.content)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            
            {/* 任务列表 */}
            <div className="mb-4 border rounded-lg p-3">
              <button
                onClick={() => setIsTodosExpanded(!isTodosExpanded)}
                className="flex items-center justify-between w-full font-medium text-gray-300"
              >
                <span className="flex items-center gap-2">
                  <ListTodo size={18} className="text-green-500" />
                  <span>任务</span>
                  <span className="text-xs text-gray-500">({todos.length})</span>
                </span>
                {isTodosExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
              
              {isTodosExpanded && (
                <div className="mt-3 space-y-2">
                  {todosLoading ? (
                    <LoadingSpinner size="md" />
                  ) : todos.length === 0 ? (
                    <p className="text-gray-500 text-sm">暂无任务</p>
                  ) : (
                    todos.map((todo: any, idx: number) => (
                      <div key={idx} className="flex items-center gap-2 p-2 bg-[#0F172A] rounded text-sm">
                        <StatusIcon status={todo.status} />
                        <span>{todo.content}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            
            {/* 子Agent调用 */}
            <div className="border rounded-lg p-3">
              <button
                onClick={() => setIsChildrenExpanded(!isChildrenExpanded)}
                className="flex items-center justify-between w-full font-medium text-gray-300"
              >
                <span className="flex items-center gap-2">
                  <GitBranch size={18} className="text-purple-500" />
                  <span>子Agent调用</span>
                  <span className="text-xs text-gray-500">({children.length})</span>
                </span>
                {isChildrenExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
              
              {isChildrenExpanded && (
                <div className="mt-3 space-y-2">
                  {childrenLoading ? (
                    <LoadingSpinner size="md" />
                  ) : children.length === 0 ? (
                    <p className="text-gray-500 text-sm">暂无子Agent调用</p>
                  ) : (
                    children.map((child: any, idx: number) => (
                      <div key={idx} className="p-2 bg-purple-900/20 rounded border border-purple-200 text-sm">
                        <div className="font-medium text-purple-700">{child.title || `子Agent ${idx + 1}`}</div>
                        <div className="text-gray-500 text-xs mt-1">
                          状态: {child.status || '未知'}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}