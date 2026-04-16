'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  AgentTeamEvent,
  ExecutionStartedData,
  AgentInvokedData,
  MessageDeltaData,
  AgentCompletedData,
  ExecutionCompletedData,
  IterationStartedData,
  IterationCompletedData,
  ExperienceQueriedData,
} from '@/types/agent-team-events';
import {
  isExecutionStartedEvent,
  isAgentInvokedEvent,
  isMessageDeltaEvent,
  isAgentCompletedEvent,
  isExecutionCompletedEvent,
  isIterationStartedEvent,
  isIterationCompletedEvent,
  isExperienceQueriedEvent,
} from '@/types/agent-team-events';
import type { IterationRecord } from '@/types/ralph-loop-config';

// ============ State Types ============

/**
 * Execution status from SSE events
 */
export interface ExecutionStatus {
  executionId: string;
  teamId: string;
  teamName?: string;
  leadAgentId?: string;
  leadAgentName?: string;
  memberCount?: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: string;
  totalTokens?: {
    input: number;
    output: number;
  };
  totalCostUsd?: number;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Agent status tracking
 */
export interface AgentStatus {
  agentId: string;
  agentName: string;
  agentRole: 'lead' | 'member';
  memberId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  tokens?: {
    input: number;
    output: number;
  };
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Message delta for streaming text
 */
export interface MessageDelta {
  id: string;
  agentId: string;
  content: string;
  timestamp: Date;
  memberId?: string;
}

/**
 * Iteration status for Ralph Loop tracking
 */
export interface IterationStatus {
  current: number;
  max: number;
  history: IterationRecord[];
  totalCostUsd: number;
  verified: boolean;
  status: 'pending' | 'running' | 'verified' | 'failed';
}

/**
 * Experience learning status
 */
export interface ExperienceStatus {
  queried: boolean;
  count: number;
  titles: string[];
  guidanceInjected: string;
  iteration: number;
}

// ============ Hook Options ============

export interface UseAgentTeamWebSocketOptions {
  teamId: string;
  executionId?: string;
  token: string;
  enabled?: boolean;
  maxRetries?: number;
  retryDelay?: number;
  onExecutionStarted?: (data: ExecutionStartedData) => void;
  onAgentInvoked?: (data: AgentInvokedData) => void;
  onMessageDelta?: (data: MessageDeltaData) => void;
  onAgentCompleted?: (data: AgentCompletedData) => void;
  onExecutionCompleted?: (data: ExecutionCompletedData) => void;
  onIterationStarted?: (data: IterationStartedData) => void;
  onIterationCompleted?: (data: IterationCompletedData) => void;
  onExperienceQueried?: (data: ExperienceQueriedData) => void;
  onError?: (error: Error) => void;
}

// ============ Hook Return Type ============

export interface UseAgentTeamWebSocketReturn {
  execution: ExecutionStatus | null;
  agents: AgentStatus[];
  messages: MessageDelta[];
  isConnected: boolean;
  isConnecting: boolean;
  error: Error | null;
  retryCount: number;
  iteration: IterationStatus | null;
  experience: ExperienceStatus | null;
  connect: () => void;
  disconnect: () => void;
  clearMessages: () => void;
}

// ============ Helper Functions ============

/**
 * Parse SSE message data
 */
function parseSSEMessage(data: string): AgentTeamEvent | null {
  try {
    const event = JSON.parse(data) as AgentTeamEvent;
    // Validate required fields
    if (!event.type || !event.executionId || !event.teamId) {
      console.warn('[useAgentTeamWebSocket] Invalid event structure:', event);
      return null;
    }
    // Parse timestamp
    if (typeof event.timestamp === 'string') {
      event.timestamp = new Date(event.timestamp);
    }
    return event;
  } catch (e) {
    console.warn('[useAgentTeamWebSocket] Failed to parse SSE message:', data, e);
    return null;
  }
}

/**
 * Generate unique message ID
 */
function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ============ Main Hook ============

/**
 * Hook for connecting to Agent Team SSE stream
 * 
 * Features:
 * - SSE connection to /api/agent-teams/[id]/stream
 * - Parse 5 event types: execution_started, agent_invoked, message_delta, agent_completed, execution_completed
 * - State management: execution, agents, messages
 * - Auto-reconnection with retry logic
 * - Connection lifecycle methods: connect(), disconnect()
 */
export function useAgentTeamWebSocket({
  teamId,
  executionId,
  token,
  enabled = true,
  maxRetries = 3,
  retryDelay = 2000,
  onExecutionStarted,
  onAgentInvoked,
  onMessageDelta,
  onAgentCompleted,
  onExecutionCompleted,
  onIterationStarted,
  onIterationCompleted,
  onExperienceQueried,
  onError,
}: UseAgentTeamWebSocketOptions): UseAgentTeamWebSocketReturn {
  // State
  const [execution, setExecution] = useState<ExecutionStatus | null>(null);
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [messages, setMessages] = useState<MessageDelta[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [iteration, setIteration] = useState<IterationStatus | null>(null);
  const [experience, setExperience] = useState<ExperienceStatus | null>(null);

  // Refs - use refs for callbacks to avoid circular dependencies
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldConnectRef = useRef(false);
  const messageCountRef = useRef(0);
  const retryCountRef = useRef(0);
  const disconnectRef = useRef<() => void>(() => {});
  const callbacksRef = useRef({
    onExecutionStarted,
    onAgentInvoked,
    onMessageDelta,
    onAgentCompleted,
    onExecutionCompleted,
    onIterationStarted,
    onIterationCompleted,
    onExperienceQueried,
    onError,
  });

  // Update callbacks ref when props change
  useEffect(() => {
    callbacksRef.current = {
      onExecutionStarted,
      onAgentInvoked,
      onMessageDelta,
      onAgentCompleted,
      onExecutionCompleted,
      onIterationStarted,
      onIterationCompleted,
      onExperienceQueried,
      onError,
    };
  }, [onExecutionStarted, onAgentInvoked, onMessageDelta, onAgentCompleted, onExecutionCompleted, onIterationStarted, onIterationCompleted, onExperienceQueried, onError]);

  /**
   * Clear retry timeout
   */
  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  /**
   * Disconnect from SSE stream
   */
  const disconnect = useCallback(() => {
    shouldConnectRef.current = false;
    clearRetryTimeout();
    
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    
    setIsConnected(false);
    setIsConnecting(false);
    setRetryCount(0);
    retryCountRef.current = 0;
  }, [clearRetryTimeout]);

  // Update disconnect ref
  useEffect(() => {
    disconnectRef.current = disconnect;
  }, [disconnect]);

  /**
   * Handle SSE message event
   */
  const handleMessageRef = useRef<(event: MessageEvent) => void>(() => {});
  
  useEffect(() => {
    handleMessageRef.current = (event: MessageEvent) => {
      const parsedEvent = parseSSEMessage(event.data);
      if (!parsedEvent) return;

      // Reset retry count on successful message
      retryCountRef.current = 0;
      setRetryCount(0);

      // Handle each event type
      if (isExecutionStartedEvent(parsedEvent)) {
        const data = parsedEvent.data as ExecutionStartedData;
        setExecution({
          executionId: parsedEvent.executionId,
          teamId: parsedEvent.teamId,
          teamName: data.teamName,
          leadAgentId: data.leadAgentId,
          leadAgentName: data.leadAgentName,
          memberCount: data.memberCount,
          status: 'running',
          startedAt: parsedEvent.timestamp,
        });
        // Initialize lead agent status
        if (data.leadAgentId) {
          setAgents(prev => {
            const existing = prev.find(a => a.agentId === data.leadAgentId);
            if (existing) return prev;
            return [
              ...prev,
              {
                agentId: data.leadAgentId!,
                agentName: data.leadAgentName || 'Lead Agent',
                agentRole: 'lead',
                status: 'running',
                startedAt: parsedEvent.timestamp,
              },
            ];
          });
        }
        callbacksRef.current.onExecutionStarted?.(data);
      } else if (isAgentInvokedEvent(parsedEvent)) {
        const data = parsedEvent.data as AgentInvokedData;
        setAgents(prev => {
          const existing = prev.find(a => a.agentId === data.agentId);
          if (existing) {
            return prev.map(a =>
              a.agentId === data.agentId
                ? { ...a, status: 'running', startedAt: parsedEvent.timestamp }
                : a
            );
          }
          return [
            ...prev,
            {
              agentId: data.agentId,
              agentName: data.agentName,
              agentRole: data.agentRole,
              memberId: data.memberId,
              status: 'running',
              startedAt: parsedEvent.timestamp,
            },
          ];
        });
        callbacksRef.current.onAgentInvoked?.(data);
      } else if (isMessageDeltaEvent(parsedEvent)) {
        const data = parsedEvent.data as MessageDeltaData;
        const newMessage: MessageDelta = {
          id: generateMessageId(),
          agentId: data.agentId,
          content: data.content,
          timestamp: parsedEvent.timestamp,
          memberId: data.memberId,
        };
        setMessages(prev => [...prev, newMessage]);
        messageCountRef.current++;
        callbacksRef.current.onMessageDelta?.(data);
      } else if (isAgentCompletedEvent(parsedEvent)) {
        const data = parsedEvent.data as AgentCompletedData;
        setAgents(prev =>
          prev.map(a =>
            a.agentId === data.agentId
              ? {
                  ...a,
                  status: 'completed',
                  result: data.result,
                  tokens: data.tokens,
                  completedAt: parsedEvent.timestamp,
                }
              : a
          )
        );
        callbacksRef.current.onAgentCompleted?.(data);
      } else if (isExecutionCompletedEvent(parsedEvent)) {
        const data = parsedEvent.data as ExecutionCompletedData;
        setExecution(prev =>
          prev
            ? {
                ...prev,
                status: data.status,
                result: data.result,
                totalTokens: data.totalTokens,
                totalCostUsd: data.totalCostUsd,
                completedAt: parsedEvent.timestamp,
              }
            : {
                executionId: parsedEvent.executionId,
                teamId: parsedEvent.teamId,
                status: data.status,
                result: data.result,
                totalTokens: data.totalTokens,
                totalCostUsd: data.totalCostUsd,
                completedAt: parsedEvent.timestamp,
              }
        );
        // Mark all agents as completed/failed based on execution status
        setAgents(prev =>
          prev.map(a => ({
            ...a,
            status: data.status === 'completed' ? 'completed' : 'failed',
            completedAt: parsedEvent.timestamp,
          }))
        );
        callbacksRef.current.onExecutionCompleted?.(data);
        // Auto-disconnect on execution completion
        disconnectRef.current();
      } else if (isIterationStartedEvent(parsedEvent)) {
        const data = parsedEvent.data as IterationStartedData;
        setIteration(prev => ({
          current: data.iteration,
          max: data.maxIterations,
          history: prev?.history || [],
          totalCostUsd: data.totalCostUsdSoFar || prev?.totalCostUsd || 0,
          verified: false,
          status: 'running',
        }));
        callbacksRef.current.onIterationStarted?.(data);
      } else if (isIterationCompletedEvent(parsedEvent)) {
        const data = parsedEvent.data as IterationCompletedData;
        // Create iteration record
        const iterationRecord: IterationRecord = {
          iteration: data.iteration,
          startedAt: parsedEvent.timestamp,
          completedAt: parsedEvent.timestamp,
          result: data.result,
          verification: {
            verified: data.verified,
            feedback: data.feedback,
          },
          tokensUsed: data.tokensUsed,
          costUsd: data.costUsd,
          experienceQueried: false,
          experiencesFound: 0,
        };
        setIteration(prev => {
          if (!prev) {
            return {
              current: data.iteration,
              max: 10, // Default
              history: [iterationRecord],
              totalCostUsd: data.totalCostUsdSoFar,
              verified: data.verified,
              status: data.verified ? 'verified' : 'failed',
            };
          }
          return {
            ...prev,
            current: data.iteration,
            history: [...prev.history, iterationRecord],
            totalCostUsd: data.totalCostUsdSoFar,
            verified: data.verified,
            status: data.verified ? 'verified' : 'failed',
          };
        });
        callbacksRef.current.onIterationCompleted?.(data);
      } else if (isExperienceQueriedEvent(parsedEvent)) {
        const data = parsedEvent.data as ExperienceQueriedData;
        setExperience({
          queried: true,
          count: data.experiencesFound,
          titles: data.experienceTitles || [],
          guidanceInjected: data.guidanceInjected,
          iteration: data.iteration,
        });
        // Update iteration history with experience info
        setIteration(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            history: prev.history.map(record =>
              record.iteration === data.iteration
                ? {
                    ...record,
                    experienceQueried: true,
                    experiencesFound: data.experiencesFound,
                  }
                : record
            ),
          };
        });
        callbacksRef.current.onExperienceQueried?.(data);
      }
    };
  }, []);

  /**
   * Handle SSE error event
   */
  const handleErrorRef = useRef<(event: Event) => void>(() => {});
  
  useEffect(() => {
    handleErrorRef.current = (event: Event) => {
      const err = new Error('SSE connection error');
      setError(err);
      setIsConnected(false);
      setIsConnecting(false);
      callbacksRef.current.onError?.(err);

      // Attempt reconnection if within retry limit
      if (shouldConnectRef.current && retryCountRef.current < maxRetries) {
        retryCountRef.current++;
        setRetryCount(retryCountRef.current);
        retryTimeoutRef.current = setTimeout(() => {
          if (shouldConnectRef.current) {
            connectInternalRef.current();
          }
        }, retryDelay);
      } else if (retryCountRef.current >= maxRetries) {
        console.warn('[useAgentTeamWebSocket] Max retries reached, stopping reconnection');
        disconnectRef.current();
      }
    };
  }, [maxRetries, retryDelay]);

  /**
   * Internal connect function
   */
  const connectInternalRef = useRef<() => void>(() => {});
  
  useEffect(() => {
    connectInternalRef.current = () => {
      if (!teamId || !token) {
        console.warn('[useAgentTeamWebSocket] Missing teamId or token');
        return;
      }

      // Close existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      setIsConnecting(true);
      setError(null);

      // Build SSE URL
      const baseUrl = `/api/agent-teams/${teamId}/stream`;
      const url = executionId
        ? `${baseUrl}?executionId=${executionId}`
        : baseUrl;

      // Create EventSource with authorization header
      // Note: EventSource doesn't support custom headers directly
      // We need to use a workaround or pass token in URL
      // For security, we'll use a query param approach (server validates it)
      const urlWithToken = `${url}&token=${encodeURIComponent(token)}`;

      try {
        const eventSource = new EventSource(urlWithToken);
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
          setIsConnected(true);
          setIsConnecting(false);
          setError(null);
          retryCountRef.current = 0;
          setRetryCount(0);
          console.log('[useAgentTeamWebSocket] Connected to SSE stream');
        };

        eventSource.onmessage = (event) => handleMessageRef.current(event);

        eventSource.onerror = (event) => handleErrorRef.current(event);

        // Handle custom SSE event types
        eventSource.addEventListener('connected', (event: MessageEvent) => {
          console.log('[useAgentTeamWebSocket] Received connected event:', event.data);
        });

        eventSource.addEventListener('complete', (event: MessageEvent) => {
          console.log('[useAgentTeamWebSocket] Received complete event:', event.data);
          disconnectRef.current();
        });

        eventSource.addEventListener('error', (event: MessageEvent) => {
          const err = new Error(event.data || 'Server error');
          setError(err);
          callbacksRef.current.onError?.(err);
        });

      } catch (e) {
        const err = e instanceof Error ? e : new Error('Failed to create EventSource');
        setError(err);
        setIsConnecting(false);
        callbacksRef.current.onError?.(err);
      }
    };
  }, [teamId, executionId, token]);

  /**
   * Connect to SSE stream
   */
  const connect = useCallback(() => {
    shouldConnectRef.current = true;
    clearRetryTimeout();
    retryCountRef.current = 0;
    setRetryCount(0);
    connectInternalRef.current();
  }, [clearRetryTimeout]);

  /**
   * Clear messages
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
    messageCountRef.current = 0;
  }, []);

  /**
   * Auto-connect when enabled
   */
  useEffect(() => {
    if (enabled && teamId && token) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [enabled, teamId, token, connect, disconnect]);

  return {
    execution,
    agents,
    messages,
    isConnected,
    isConnecting,
    error,
    retryCount,
    iteration,
    experience,
    connect,
    disconnect,
    clearMessages,
  };
}

// ============ Export Types ============

// Types are already exported as interfaces above, no need to re-export