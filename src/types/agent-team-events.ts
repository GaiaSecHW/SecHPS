/**
 * Agent Team Event Types for WebSocket/SSE streaming
 * 
 * Defines 5 core event types for real-time execution monitoring:
 * - execution_started: Execution begins
 * - agent_invoked: An agent is invoked (Lead or member)
 * - message_delta: Streaming text content from agent
 * - agent_completed: Agent finishes with result
 * - execution_completed: Full execution finishes
 */

// ============ Event Type Constants ============

export const AGENT_TEAM_EVENT_TYPES = {
  EXECUTION_STARTED: 'execution_started',
  AGENT_INVOKED: 'agent_invoked',
  MESSAGE_DELTA: 'message_delta',
  AGENT_COMPLETED: 'agent_completed',
  EXECUTION_COMPLETED: 'execution_completed',
} as const;

export type AgentTeamEventType = typeof AGENT_TEAM_EVENT_TYPES[keyof typeof AGENT_TEAM_EVENT_TYPES];

// ============ Event Data Interfaces ============

/**
 * Execution started event data
 */
export interface ExecutionStartedData {
  executionId: string;
  teamId: string;
  teamName?: string;
  leadAgentId?: string;
  leadAgentName?: string;
  memberCount?: number;
}

/**
 * Agent invoked event data
 * parentToolUseId is null for Lead agent, contains tool_use ID for member agents
 */
export interface AgentInvokedData {
  agentId: string;
  agentName: string;
  agentRole: 'lead' | 'member';
  parentToolUseId: string | null;
  memberId?: string;
}

/**
 * Message delta event data - streaming text chunks
 */
export interface MessageDeltaData {
  agentId: string;
  content: string;
  memberId?: string;
}

/**
 * Agent completed event data
 */
export interface AgentCompletedData {
  agentId: string;
  agentName: string;
  result: string;
  tokens: {
    input: number;
    output: number;
  };
  memberId?: string;
}

/**
 * Execution completed event data
 */
export interface ExecutionCompletedData {
  executionId: string;
  result: string;
  totalTokens: {
    input: number;
    output: number;
  };
  totalCostUsd?: number;
  status: 'completed' | 'failed' | 'cancelled';
}

// ============ Union Event Data Type ============

export type AgentTeamEventData = 
  | ExecutionStartedData
  | AgentInvokedData
  | MessageDeltaData
  | AgentCompletedData
  | ExecutionCompletedData;

// ============ Main Event Interface ============

/**
 * Agent Team Event - sent via SSE/WebSocket to connected clients
 */
export interface AgentTeamEvent {
  type: AgentTeamEventType;
  executionId: string;
  teamId: string;
  timestamp: Date;
  data: AgentTeamEventData;
}

// ============ Type Guards ============

export function isExecutionStartedEvent(event: AgentTeamEvent): event is AgentTeamEvent & { data: ExecutionStartedData } {
  return event.type === AGENT_TEAM_EVENT_TYPES.EXECUTION_STARTED;
}

export function isAgentInvokedEvent(event: AgentTeamEvent): event is AgentTeamEvent & { data: AgentInvokedData } {
  return event.type === AGENT_TEAM_EVENT_TYPES.AGENT_INVOKED;
}

export function isMessageDeltaEvent(event: AgentTeamEvent): event is AgentTeamEvent & { data: MessageDeltaData } {
  return event.type === AGENT_TEAM_EVENT_TYPES.MESSAGE_DELTA;
}

export function isAgentCompletedEvent(event: AgentTeamEvent): event is AgentTeamEvent & { data: AgentCompletedData } {
  return event.type === AGENT_TEAM_EVENT_TYPES.AGENT_COMPLETED;
}

export function isExecutionCompletedEvent(event: AgentTeamEvent): event is AgentTeamEvent & { data: ExecutionCompletedData } {
  return event.type === AGENT_TEAM_EVENT_TYPES.EXECUTION_COMPLETED;
}

// ============ Event Factory Functions ============

export function createExecutionStartedEvent(
  executionId: string,
  teamId: string,
  data: ExecutionStartedData
): AgentTeamEvent {
  return {
    type: AGENT_TEAM_EVENT_TYPES.EXECUTION_STARTED,
    executionId,
    teamId,
    timestamp: new Date(),
    data,
  };
}

export function createAgentInvokedEvent(
  executionId: string,
  teamId: string,
  data: AgentInvokedData
): AgentTeamEvent {
  return {
    type: AGENT_TEAM_EVENT_TYPES.AGENT_INVOKED,
    executionId,
    teamId,
    timestamp: new Date(),
    data,
  };
}

export function createMessageDeltaEvent(
  executionId: string,
  teamId: string,
  data: MessageDeltaData
): AgentTeamEvent {
  return {
    type: AGENT_TEAM_EVENT_TYPES.MESSAGE_DELTA,
    executionId,
    teamId,
    timestamp: new Date(),
    data,
  };
}

export function createAgentCompletedEvent(
  executionId: string,
  teamId: string,
  data: AgentCompletedData
): AgentTeamEvent {
  return {
    type: AGENT_TEAM_EVENT_TYPES.AGENT_COMPLETED,
    executionId,
    teamId,
    timestamp: new Date(),
    data,
  };
}

export function createExecutionCompletedEvent(
  executionId: string,
  teamId: string,
  data: ExecutionCompletedData
): AgentTeamEvent {
  return {
    type: AGENT_TEAM_EVENT_TYPES.EXECUTION_COMPLETED,
    executionId,
    teamId,
    timestamp: new Date(),
    data,
  };
}

// ============ SSE Message Format ============

/**
 * Format event for SSE transmission
 * SSE format: "data: <json>\n\n"
 */
export function formatEventForSSE(event: AgentTeamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * SSE event names for client-side EventSource
 */
export const SSE_EVENT_NAMES = {
  CONNECTED: 'connected',
  EVENT: 'event',
  ERROR: 'error',
  COMPLETE: 'complete',
} as const;