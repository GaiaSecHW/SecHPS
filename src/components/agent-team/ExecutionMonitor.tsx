'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
  MessageSquare,
  PauseCircle,
  RefreshCw,
  Wifi,
  WifiOff,
  XCircle,
  Zap,
  TrendingUp,
} from 'lucide-react';
import { useAgentTeamWebSocket } from '@/hooks/useAgentTeamWebSocket';
import type { AgentStatus, ExecutionStatus, MessageDelta } from '@/hooks/useAgentTeamWebSocket';
import { IterationProgress } from '@/components/agent-team/IterationProgress';
import { IterationHistory } from '@/components/agent-team/IterationHistory';
import { ExperienceNotification } from '@/components/agent-team/ExperienceNotification';

// ============ Props Interface ============

interface ExecutionMonitorProps {
  teamId: string;
  executionId: string;
  token: string;
  onCompleted?: (result: ExecutionStatus) => void;
  onCancelled?: () => void;
}

// ============ Status Config ============

const agentStatusConfig = {
  pending: {
    icon: Clock,
    text: '等待中',
    color: 'text-gray-500',
    bgColor: 'bg-gray-100',
    borderColor: 'border-gray-200',
    badgeColor: 'bg-gray-100 text-gray-700 border-gray-200',
  },
  running: {
    icon: Loader2,
    text: '运行中',
    color: 'text-green-500',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    badgeColor: 'bg-green-100 text-green-700 border-green-200',
  },
  completed: {
    icon: CheckCircle,
    text: '已完成',
    color: 'text-blue-500',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    badgeColor: 'bg-blue-100 text-blue-700 border-blue-200',
  },
  failed: {
    icon: XCircle,
    text: '失败',
    color: 'text-red-500',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    badgeColor: 'bg-red-100 text-red-700 border-red-200',
  },
};

const executionStatusConfig = {
  pending: {
    icon: Clock,
    text: '等待开始',
    color: 'text-gray-500',
    bgColor: 'bg-gray-100',
  },
  running: {
    icon: Activity,
    text: '执行中',
    color: 'text-green-600',
    bgColor: 'bg-green-100',
  },
  completed: {
    icon: CheckCircle,
    text: '执行完成',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
  },
  failed: {
    icon: AlertCircle,
    text: '执行失败',
    color: 'text-red-600',
    bgColor: 'bg-red-100',
  },
  cancelled: {
    icon: PauseCircle,
    text: '已取消',
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-100',
  },
};

// ============ Helper Functions ============

function formatTokens(tokens: { input: number; output: number } | undefined): string {
  if (!tokens) return '0 / 0';
  return `${tokens.input.toLocaleString()} / ${tokens.output.toLocaleString()}`;
}

function formatCost(costUsd: number | undefined): string {
  if (!costUsd) return '$0.00';
  return `$${costUsd.toFixed(4)}`;
}

function formatTimestamp(date: Date | undefined): string {
  if (!date) return '--';
  return new Date(date).toLocaleTimeString('zh-CN');
}

function truncateContent(content: string, maxLength: number = 100): string {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + '...';
}

// ============ Sub Components ============

interface AgentCardProps {
  agent: AgentStatus;
  latestMessage?: string;
}

function AgentCard({ agent, latestMessage }: AgentCardProps) {
  const config = agentStatusConfig[agent.status];
  const Icon = config.icon;
  const isAnimating = agent.status === 'running';

  return (
    <div
      className={`rounded-lg border p-4 transition-all duration-200 ${config.bgColor} ${config.borderColor}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <Icon
            size={18}
            className={`${config.color} ${isAnimating ? 'animate-spin' : ''}`}
          />
          <span className="font-medium text-gray-900">{agent.agentName}</span>
        </div>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${config.badgeColor}`}
        >
          {config.text}
        </span>
      </div>

      {/* Role Badge */}
      <div className="mb-2">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${
            agent.agentRole === 'lead'
              ? 'bg-purple-100 text-purple-700'
              : 'bg-gray-100 text-gray-600'
          }`}
        >
          {agent.agentRole === 'lead' ? 'Lead Agent' : 'Teammate'}
        </span>
      </div>

      {/* Token Usage */}
      <div className="flex items-center space-x-2 text-sm text-gray-600 mb-2">
        <Zap size={14} className="text-yellow-500" />
        <span>Token: {formatTokens(agent.tokens)}</span>
      </div>

      {/* Latest Message Preview */}
      {latestMessage && (
        <div className="mt-2 pt-2 border-t border-gray-200">
          <div className="flex items-start space-x-2">
            <MessageSquare size={14} className="text-gray-400 mt-0.5" />
            <p className="text-xs text-gray-500 line-clamp-2">
              {truncateContent(latestMessage)}
            </p>
          </div>
        </div>
      )}

      {/* Timestamps */}
      <div className="mt-2 flex items-center space-x-4 text-xs text-gray-400">
        {agent.startedAt && (
          <span>开始: {formatTimestamp(agent.startedAt)}</span>
        )}
        {agent.completedAt && (
          <span>完成: {formatTimestamp(agent.completedAt)}</span>
        )}
      </div>
    </div>
  );
}

interface MessageFlowItemProps {
  message: MessageDelta;
  agentName: string;
}

function MessageFlowItem({ message, agentName }: MessageFlowItemProps) {
  return (
    <div className="flex items-start space-x-3 py-2 border-b border-gray-100 last:border-0">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
        <MessageSquare size={14} className="text-blue-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center space-x-2 mb-1">
          <span className="font-medium text-sm text-gray-900">{agentName}</span>
          <span className="text-xs text-gray-400">
            {formatTimestamp(message.timestamp)}
          </span>
        </div>
        <p className="text-sm text-gray-600 break-words">
          {truncateContent(message.content, 200)}
        </p>
      </div>
    </div>
  );
}

interface ResultsPanelProps {
  execution: ExecutionStatus;
}

function ResultsPanel({ execution }: ResultsPanelProps) {
  if (!execution.result) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mt-4">
      <h3 className="font-semibold text-gray-900 mb-3 flex items-center">
        <CheckCircle size={18} className="text-green-500 mr-2" />
        执行结果
      </h3>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">总输入 Token</p>
          <p className="text-lg font-semibold text-gray-900">
            {execution.totalTokens?.input?.toLocaleString() || 0}
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">总输出 Token</p>
          <p className="text-lg font-semibold text-gray-900">
            {execution.totalTokens?.output?.toLocaleString() || 0}
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">预估成本</p>
          <p className="text-lg font-semibold text-gray-900">
            {formatCost(execution.totalCostUsd)}
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">执行状态</p>
          <p className="text-lg font-semibold text-gray-900">
            {executionStatusConfig[execution.status]?.text || execution.status}
          </p>
        </div>
      </div>

      {/* Result Content */}
      <div className="bg-gray-50 rounded-lg p-4 max-h-[400px] overflow-y-auto">
        <pre className="text-sm text-gray-700 whitespace-pre-wrap break-words">
          {execution.result}
        </pre>
      </div>
    </div>
  );
}

// ============ Main Component ============

export function ExecutionMonitor({
  teamId,
  executionId,
  token,
  onCompleted,
  onCancelled,
}: ExecutionMonitorProps) {
  // State
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [iterationHistoryExpanded, setIterationHistoryExpanded] = useState(false);
  const [showExperienceNotification, setShowExperienceNotification] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // WebSocket connection
  const {
    execution,
    agents,
    messages,
    isConnected,
    isConnecting,
    error,
    retryCount,
    iteration,
    experience,
    disconnect,
  } = useAgentTeamWebSocket({
    teamId,
    executionId,
    token,
    enabled: true,
    onExecutionCompleted: (data) => {
      if (onCompleted && execution) {
        onCompleted(execution);
      }
    },
    onExperienceQueried: (data) => {
      // Show experience notification when experience is queried
      setShowExperienceNotification(true);
    },
  });

  // Build agent message map for latest message preview
  const agentLatestMessage = useCallback(() => {
    const map = new Map<string, string>();
    for (const msg of messages) {
      const existing = map.get(msg.agentId);
      if (!existing || msg.timestamp > (messages.find(m => m.agentId === msg.agentId && m.content === existing)?.timestamp || new Date(0))) {
        map.set(msg.agentId, msg.content);
      }
    }
    return map;
  }, [messages]);

  const latestMessagesMap = agentLatestMessage();

  // Calculate progress
  const totalAgents = execution?.memberCount || agents.length || 1;
  const completedAgents = agents.filter(
    (a) => a.status === 'completed' || a.status === 'failed'
  ).length;
  const progress = totalAgents > 0 ? Math.round((completedAgents / totalAgents) * 100) : 0;

  // Auto-scroll messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Handle cancel
  const handleCancel = async () => {
    if (!confirm('确定要取消此执行吗？')) return;

    setIsCancelling(true);
    setCancelError(null);

    try {
      const response = await fetch(
        `/api/agent-teams/${teamId}/executions/${executionId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status: 'cancelled' }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '取消失败');
      }

      disconnect();
      onCancelled?.();
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : '取消失败');
    } finally {
      setIsCancelling(false);
    }
  };

  // Get execution status config
  const execConfig = execution
    ? executionStatusConfig[execution.status]
    : executionStatusConfig.pending;
  const ExecIcon = execConfig.icon;

  // Render
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <ExecIcon
              size={24}
              className={`${execConfig.color} ${
                execution?.status === 'running' ? 'animate-pulse' : ''
              }`}
            />
            <div>
              <h2 className="font-semibold text-gray-900">
                执行监控
              </h2>
              <p className="text-sm text-gray-500">
                ID: {executionId.slice(0, 8)}...
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* Connection Status */}
            <div className="flex items-center space-x-2">
              {isConnecting ? (
                <Loader2 size={16} className="text-yellow-500 animate-spin" />
              ) : isConnected ? (
                <Wifi size={16} className="text-green-500" />
              ) : (
                <WifiOff size={16} className="text-red-500" />
              )}
              <span className="text-xs text-gray-500">
                {isConnecting
                  ? `连接中${retryCount > 0 ? ` (${retryCount})` : ''}`
                  : isConnected
                  ? '已连接'
                  : '未连接'}
              </span>
            </div>

            {/* Status Badge */}
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${execConfig.bgColor} ${execConfig.color}`}
            >
              {execConfig.text}
            </span>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
            <AlertCircle size={16} className="text-red-500" />
            <span className="text-sm text-red-700">
              {error.message || '连接错误'}
            </span>
          </div>
        )}

        {cancelError && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
            <AlertCircle size={16} className="text-red-500" />
            <span className="text-sm text-red-700">{cancelError}</span>
          </div>
        )}
      </div>

      {/* Progress Bar */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">执行进度</span>
          <span className="text-sm text-gray-500">
            {completedAgents} / {totalAgents} Agent 完成
          </span>
        </div>
        <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              execution?.status === 'failed'
                ? 'bg-red-500'
                : execution?.status === 'completed'
                ? 'bg-green-500'
                : 'bg-blue-500'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
          <span>
            开始时间: {formatTimestamp(execution?.startedAt)}
          </span>
          {execution?.completedAt && (
            <span>完成时间: {formatTimestamp(execution.completedAt)}</span>
          )}
        </div>
      </div>

      {/* Ralph Loop Iteration Progress */}
      {iteration && (
        <IterationProgress
          currentIteration={iteration.current}
          maxIterations={iteration.max}
          verified={iteration.verified}
          costUsd={iteration.totalCostUsd}
          maxCostUsd={5.0} // Default max cost, could be passed from config
          status={iteration.status}
        />
      )}

      {/* Experience Learning Notification */}
      {experience && showExperienceNotification && (
        <ExperienceNotification
          iteration={experience.iteration}
          experiencesFound={experience.count}
          experienceTitles={experience.titles}
          guidanceInjected={experience.guidanceInjected}
          variant="inline"
          onDismiss={() => setShowExperienceNotification(false)}
        />
      )}

      {/* Iteration History */}
      {iteration && iteration.history.length > 0 && (
        <IterationHistory
          iterations={iteration.history}
          expanded={iterationHistoryExpanded}
          onToggleExpand={() => setIterationHistoryExpanded(!iterationHistoryExpanded)}
        />
      )}

      {/* Agent Cards Grid */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center">
          <Activity size={18} className="text-blue-500 mr-2" />
          Agent 状态
        </h3>

        {agents.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Clock size={32} className="mx-auto mb-2 text-gray-400" />
            <p>等待 Agent 启动...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent) => (
              <AgentCard
                key={agent.agentId}
                agent={agent}
                latestMessage={latestMessagesMap.get(agent.agentId)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Message Flow Panel */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center">
          <MessageSquare size={18} className="text-purple-500 mr-2" />
          消息流
          <span className="ml-2 text-xs text-gray-400">
            ({messages.length} 条消息)
          </span>
        </h3>

        <div className="max-h-[400px] overflow-y-auto">
          {messages.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <MessageSquare size={32} className="mx-auto mb-2 text-gray-400" />
              <p>等待消息...</p>
            </div>
          ) : (
            <>
              {messages.map((msg) => {
                const agent = agents.find((a) => a.agentId === msg.agentId);
                return (
                  <MessageFlowItem
                    key={msg.id}
                    message={msg}
                    agentName={agent?.agentName || 'Unknown Agent'}
                  />
                );
              })}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      {execution?.status === 'running' && (
        <div className="flex items-center justify-center">
          <button
            onClick={handleCancel}
            disabled={isCancelling}
            className="inline-flex items-center px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isCancelling ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" />
                取消中...
              </>
            ) : (
              <>
                <PauseCircle size={16} className="mr-2" />
                取消执行
              </>
            )}
          </button>
        </div>
      )}

      {/* Results Panel */}
      {(execution?.status === 'completed' ||
        execution?.status === 'failed' ||
        execution?.status === 'cancelled') && (
        <ResultsPanel execution={execution!} />
      )}
    </div>
  );
}

export default ExecutionMonitor;