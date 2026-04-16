import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AGENT_TEAM_EVENT_TYPES,
  AgentTeamEvent,
  ExecutionStartedData,
  AgentInvokedData,
  MessageDeltaData,
  AgentCompletedData,
  ExecutionCompletedData,
  createExecutionStartedEvent,
  createAgentInvokedEvent,
  createMessageDeltaEvent,
  createAgentCompletedEvent,
  createExecutionCompletedEvent,
  formatEventForSSE,
  isExecutionStartedEvent,
  isAgentInvokedEvent,
  isMessageDeltaEvent,
  isAgentCompletedEvent,
  isExecutionCompletedEvent,
} from '@/types/agent-team-events';

describe('Agent Team Event Types', () => {
  describe('AGENT_TEAM_EVENT_TYPES', () => {
    test('defines all 5 event types', () => {
      expect(AGENT_TEAM_EVENT_TYPES.EXECUTION_STARTED).toBe('execution_started');
      expect(AGENT_TEAM_EVENT_TYPES.AGENT_INVOKED).toBe('agent_invoked');
      expect(AGENT_TEAM_EVENT_TYPES.MESSAGE_DELTA).toBe('message_delta');
      expect(AGENT_TEAM_EVENT_TYPES.AGENT_COMPLETED).toBe('agent_completed');
      expect(AGENT_TEAM_EVENT_TYPES.EXECUTION_COMPLETED).toBe('execution_completed');
    });
  });

  describe('Event Factory Functions', () => {
    const executionId = 'exec-123';
    const teamId = 'team-456';

    test('createExecutionStartedEvent creates correct event', () => {
      const data: ExecutionStartedData = {
        executionId,
        teamId,
        teamName: 'Test Team',
        leadAgentId: 'agent-1',
        leadAgentName: 'Lead Agent',
        memberCount: 3,
      };

      const event = createExecutionStartedEvent(executionId, teamId, data);

      expect(event.type).toBe('execution_started');
      expect(event.executionId).toBe(executionId);
      expect(event.teamId).toBe(teamId);
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.data).toEqual(data);
    });

    test('createAgentInvokedEvent creates correct event for lead agent', () => {
      const data: AgentInvokedData = {
        agentId: 'agent-1',
        agentName: 'Lead Agent',
        agentRole: 'lead',
        parentToolUseId: null,
      };

      const event = createAgentInvokedEvent(executionId, teamId, data);

      expect(event.type).toBe('agent_invoked');
      expect(event.executionId).toBe(executionId);
      expect(event.teamId).toBe(teamId);
      expect(event.data).toEqual(data);
      expect((event.data as AgentInvokedData).parentToolUseId).toBeNull();
    });

    test('createAgentInvokedEvent creates correct event for member agent', () => {
      const data: AgentInvokedData = {
        agentId: 'agent-2',
        agentName: 'Member Agent',
        agentRole: 'member',
        parentToolUseId: 'tool-use-123',
        memberId: 'member-1',
      };

      const event = createAgentInvokedEvent(executionId, teamId, data);

      expect(event.type).toBe('agent_invoked');
      expect((event.data as AgentInvokedData).parentToolUseId).toBe('tool-use-123');
      expect((event.data as AgentInvokedData).memberId).toBe('member-1');
    });

    test('createMessageDeltaEvent creates correct event', () => {
      const data: MessageDeltaData = {
        agentId: 'agent-1',
        content: 'Processing your request...',
      };

      const event = createMessageDeltaEvent(executionId, teamId, data);

      expect(event.type).toBe('message_delta');
      expect(event.data).toEqual(data);
    });

    test('createAgentCompletedEvent creates correct event', () => {
      const data: AgentCompletedData = {
        agentId: 'agent-1',
        agentName: 'Lead Agent',
        result: 'Task completed successfully',
        tokens: { input: 100, output: 50 },
      };

      const event = createAgentCompletedEvent(executionId, teamId, data);

      expect(event.type).toBe('agent_completed');
      expect(event.data).toEqual(data);
    });

    test('createExecutionCompletedEvent creates correct event', () => {
      const data: ExecutionCompletedData = {
        executionId,
        result: 'All tasks completed',
        totalTokens: { input: 500, output: 200 },
        totalCostUsd: 0.25,
        status: 'completed',
      };

      const event = createExecutionCompletedEvent(executionId, teamId, data);

      expect(event.type).toBe('execution_completed');
      expect(event.data).toEqual(data);
    });

    test('createExecutionCompletedEvent handles failed status', () => {
      const data: ExecutionCompletedData = {
        executionId,
        result: 'Error: Max turns exceeded',
        totalTokens: { input: 100, output: 50 },
        status: 'failed',
      };

      const event = createExecutionCompletedEvent(executionId, teamId, data);

      expect(event.type).toBe('execution_completed');
      expect((event.data as ExecutionCompletedData).status).toBe('failed');
    });

    test('createExecutionCompletedEvent handles cancelled status', () => {
      const data: ExecutionCompletedData = {
        executionId,
        result: 'Execution cancelled by user',
        totalTokens: { input: 50, output: 20 },
        status: 'cancelled',
      };

      const event = createExecutionCompletedEvent(executionId, teamId, data);

      expect(event.type).toBe('execution_completed');
      expect((event.data as ExecutionCompletedData).status).toBe('cancelled');
    });
  });

  describe('Type Guards', () => {
    const executionId = 'exec-123';
    const teamId = 'team-456';

    test('isExecutionStartedEvent returns true for correct type', () => {
      const event = createExecutionStartedEvent(executionId, teamId, {
        executionId,
        teamId,
      });
      expect(isExecutionStartedEvent(event)).toBe(true);
    });

    test('isExecutionStartedEvent returns false for other types', () => {
      const event = createMessageDeltaEvent(executionId, teamId, {
        agentId: 'agent-1',
        content: 'test',
      });
      expect(isExecutionStartedEvent(event)).toBe(false);
    });

    test('isAgentInvokedEvent returns true for correct type', () => {
      const event = createAgentInvokedEvent(executionId, teamId, {
        agentId: 'agent-1',
        agentName: 'Test',
        agentRole: 'lead',
        parentToolUseId: null,
      });
      expect(isAgentInvokedEvent(event)).toBe(true);
    });

    test('isMessageDeltaEvent returns true for correct type', () => {
      const event = createMessageDeltaEvent(executionId, teamId, {
        agentId: 'agent-1',
        content: 'test',
      });
      expect(isMessageDeltaEvent(event)).toBe(true);
    });

    test('isAgentCompletedEvent returns true for correct type', () => {
      const event = createAgentCompletedEvent(executionId, teamId, {
        agentId: 'agent-1',
        agentName: 'Test',
        result: 'done',
        tokens: { input: 0, output: 0 },
      });
      expect(isAgentCompletedEvent(event)).toBe(true);
    });

    test('isExecutionCompletedEvent returns true for correct type', () => {
      const event = createExecutionCompletedEvent(executionId, teamId, {
        executionId,
        result: 'done',
        totalTokens: { input: 0, output: 0 },
        status: 'completed',
      });
      expect(isExecutionCompletedEvent(event)).toBe(true);
    });
  });

  describe('SSE Formatting', () => {
    test('formatEventForSSE produces correct SSE format', () => {
      const event = createMessageDeltaEvent('exec-1', 'team-1', {
        agentId: 'agent-1',
        content: 'Hello',
      });

      const sseMessage = formatEventForSSE(event);

      expect(sseMessage).toMatch(/^data: /);
      expect(sseMessage).toMatch(/\n\n$/);
      expect(sseMessage).toContain('"type":"message_delta"');
      expect(sseMessage).toContain('"content":"Hello"');
    });

    test('formatEventForSSE handles complex data', () => {
      const event = createExecutionCompletedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        result: 'All done',
        totalTokens: { input: 100, output: 50 },
        totalCostUsd: 0.25,
        status: 'completed',
      });

      const sseMessage = formatEventForSSE(event);

      expect(sseMessage).toContain('"totalCostUsd":0.25');
      expect(sseMessage).toContain('"status":"completed"');
    });

    test('formatEventForSSE includes timestamp', () => {
      const event = createExecutionStartedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        teamId: 'team-1',
      });

      const sseMessage = formatEventForSSE(event);

      expect(sseMessage).toContain('"timestamp"');
    });
  });
});