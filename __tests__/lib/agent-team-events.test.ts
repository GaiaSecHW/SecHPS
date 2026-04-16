import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  agentTeamEventBroadcaster,
  createAgentTeamEventStream,
  emitExecutionStarted,
  emitAgentInvoked,
  emitMessageDelta,
  emitAgentCompleted,
  emitExecutionCompleted,
  SSEClient,
} from '@/lib/agent-team-events';
import {
  createExecutionStartedEvent,
  createMessageDeltaEvent,
  createExecutionCompletedEvent,
} from '@/types/agent-team-events';

// Mock console.log to suppress noise in tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('AgentTeamEventBroadcaster', () => {
  beforeEach(() => {
    // Reset broadcaster state before each test
    agentTeamEventBroadcaster.closeAll();
  });

  afterEach(() => {
    agentTeamEventBroadcaster.closeAll();
    vi.clearAllMocks();
  });

  describe('Client Registration', () => {
    test('registers client and returns clientId', () => {
      const chunks: Uint8Array[] = [];
      const controller = {
        enqueue: (chunk: Uint8Array) => chunks.push(chunk),
        close: vi.fn(),
      } as any;

      const clientId = agentTeamEventBroadcaster.registerClient(controller, {
        teamId: 'team-1',
      });

      expect(clientId).toBeDefined();
      expect(typeof clientId).toBe('string');
      expect(agentTeamEventBroadcaster.getClientCount()).toBe(1);
    });

    test('registers client with executionId filter', () => {
      const controller = {
        enqueue: vi.fn(),
        close: vi.fn(),
      } as any;

      const clientId = agentTeamEventBroadcaster.registerClient(controller, {
        teamId: 'team-1',
        executionId: 'exec-1',
      });

      expect(clientId).toBeDefined();
      expect(agentTeamEventBroadcaster.getExecutionClientCount('exec-1')).toBe(1);
    });

    test('sends connected event on registration', () => {
      const chunks: Uint8Array[] = [];
      const controller = {
        enqueue: (chunk: Uint8Array) => chunks.push(chunk),
        close: vi.fn(),
      } as any;

      agentTeamEventBroadcaster.registerClient(controller, {
        teamId: 'team-1',
      });

      // Should have sent connected event
      expect(chunks.length).toBeGreaterThan(0);
      const message = new TextDecoder().decode(chunks[0]);
      expect(message).toContain('connected');
    });

    test('tracks team subscriptions', () => {
      const controller1 = { enqueue: vi.fn(), close: vi.fn() } as any;
      const controller2 = { enqueue: vi.fn(), close: vi.fn() } as any;

      agentTeamEventBroadcaster.registerClient(controller1, { teamId: 'team-1' });
      agentTeamEventBroadcaster.registerClient(controller2, { teamId: 'team-1' });

      expect(agentTeamEventBroadcaster.getTeamClientCount('team-1')).toBe(2);
    });
  });

  describe('Client Unregistration', () => {
    test('unregisters client correctly', () => {
      const controller = { enqueue: vi.fn(), close: vi.fn() } as any;
      const clientId = agentTeamEventBroadcaster.registerClient(controller, {
        teamId: 'team-1',
      });

      expect(agentTeamEventBroadcaster.getClientCount()).toBe(1);

      agentTeamEventBroadcaster.unregisterClient(clientId);

      expect(agentTeamEventBroadcaster.getClientCount()).toBe(0);
      expect(agentTeamEventBroadcaster.getTeamClientCount('team-1')).toBe(0);
    });

    test('unregisters client with executionId', () => {
      const controller = { enqueue: vi.fn(), close: vi.fn() } as any;
      const clientId = agentTeamEventBroadcaster.registerClient(controller, {
        teamId: 'team-1',
        executionId: 'exec-1',
      });

      expect(agentTeamEventBroadcaster.getExecutionClientCount('exec-1')).toBe(1);

      agentTeamEventBroadcaster.unregisterClient(clientId);

      expect(agentTeamEventBroadcaster.getExecutionClientCount('exec-1')).toBe(0);
    });

    test('handles unregistering non-existent client', () => {
      // Should not throw
      agentTeamEventBroadcaster.unregisterClient('non-existent-id');
      expect(agentTeamEventBroadcaster.getClientCount()).toBe(0);
    });
  });

  describe('Event Broadcasting', () => {
    test('broadcasts event to team clients', () => {
      const chunks1: Uint8Array[] = [];
      const chunks2: Uint8Array[] = [];
      const controller1 = {
        enqueue: (chunk: Uint8Array) => chunks1.push(chunk),
        close: vi.fn(),
      } as any;
      const controller2 = {
        enqueue: (chunk: Uint8Array) => chunks2.push(chunk),
        close: vi.fn(),
      } as any;

      agentTeamEventBroadcaster.registerClient(controller1, { teamId: 'team-1' });
      agentTeamEventBroadcaster.registerClient(controller2, { teamId: 'team-1' });

      const event = createMessageDeltaEvent('exec-1', 'team-1', {
        agentId: 'agent-1',
        content: 'Hello world',
      });

      agentTeamEventBroadcaster.broadcast(event);

      // Both clients should receive the event (plus connected event)
      expect(chunks1.length).toBeGreaterThan(1);
      expect(chunks2.length).toBeGreaterThan(1);

      // Check last message is the broadcast event
      const lastMessage1 = new TextDecoder().decode(chunks1[chunks1.length - 1]);
      expect(lastMessage1).toContain('message_delta');
      expect(lastMessage1).toContain('Hello world');
    });

    test('filters events by executionId', () => {
      const chunks: Uint8Array[] = [];
      const controller = {
        enqueue: (chunk: Uint8Array) => chunks.push(chunk),
        close: vi.fn(),
      } as any;

      // Register client for specific execution
      agentTeamEventBroadcaster.registerClient(controller, {
        teamId: 'team-1',
        executionId: 'exec-1',
      });

      // Broadcast event for different execution
      const event1 = createMessageDeltaEvent('exec-2', 'team-1', {
        agentId: 'agent-1',
        content: 'Should not receive',
      });
      agentTeamEventBroadcaster.broadcast(event1);

      // Broadcast event for matching execution
      const event2 = createMessageDeltaEvent('exec-1', 'team-1', {
        agentId: 'agent-1',
        content: 'Should receive',
      });
      agentTeamEventBroadcaster.broadcast(event2);

      // Should only have connected + one message_delta
      expect(chunks.length).toBe(2);
      const lastMessage = new TextDecoder().decode(chunks[1]);
      expect(lastMessage).toContain('Should receive');
      expect(lastMessage).not.toContain('Should not receive');
    });

    test('does not broadcast to clients of different team', () => {
      const chunks: Uint8Array[] = [];
      const controller = {
        enqueue: (chunk: Uint8Array) => chunks.push(chunk),
        close: vi.fn(),
      } as any;

      agentTeamEventBroadcaster.registerClient(controller, { teamId: 'team-1' });

      const event = createMessageDeltaEvent('exec-1', 'team-2', {
        agentId: 'agent-1',
        content: 'Hello',
      });
      agentTeamEventBroadcaster.broadcast(event);

      // Should only have connected event
      expect(chunks.length).toBe(1);
    });

    test('handles broadcast with no clients', () => {
      const event = createMessageDeltaEvent('exec-1', 'team-1', {
        agentId: 'agent-1',
        content: 'Hello',
      });

      // Should not throw
      agentTeamEventBroadcaster.broadcast(event);
    });
  });

  describe('Execution Completion Cleanup', () => {
    test('closes clients on execution_completed event', () => {
      const closeMock = vi.fn();
      const controller = {
        enqueue: vi.fn(),
        close: closeMock,
      } as any;

      agentTeamEventBroadcaster.registerClient(controller, {
        teamId: 'team-1',
        executionId: 'exec-1',
      });

      const event = createExecutionCompletedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        result: 'Done',
        totalTokens: { input: 100, output: 50 },
        status: 'completed',
      });

      agentTeamEventBroadcaster.broadcast(event);

      // Client should be closed and removed
      expect(closeMock).toHaveBeenCalled();
      expect(agentTeamEventBroadcaster.getClientCount()).toBe(0);
    });

    test('does not close clients without executionId filter', () => {
      const closeMock = vi.fn();
      const controller = {
        enqueue: vi.fn(),
        close: closeMock,
      } as any;

      // Register client without executionId filter
      agentTeamEventBroadcaster.registerClient(controller, { teamId: 'team-1' });

      const event = createExecutionCompletedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        result: 'Done',
        totalTokens: { input: 100, output: 50 },
        status: 'completed',
      });

      agentTeamEventBroadcaster.broadcast(event);

      // Client should NOT be closed (no executionId filter)
      expect(closeMock).not.toHaveBeenCalled();
      expect(agentTeamEventBroadcaster.getClientCount()).toBe(1);
    });
  });

  describe('Helper Functions', () => {
    test('emitExecutionStarted broadcasts correct event', () => {
      const chunks: Uint8Array[] = [];
      const controller = {
        enqueue: (chunk: Uint8Array) => chunks.push(chunk),
        close: vi.fn(),
      } as any;

      agentTeamEventBroadcaster.registerClient(controller, { teamId: 'team-1' });

      emitExecutionStarted('exec-1', 'team-1', {
        teamName: 'Test Team',
        leadAgentId: 'agent-1',
        leadAgentName: 'Lead',
        memberCount: 3,
      });

      const lastMessage = new TextDecoder().decode(chunks[chunks.length - 1]);
      expect(lastMessage).toContain('execution_started');
      expect(lastMessage).toContain('Test Team');
    });

    test('emitAgentInvoked broadcasts correct event', () => {
      const chunks: Uint8Array[] = [];
      const controller = {
        enqueue: (chunk: Uint8Array) => chunks.push(chunk),
        close: vi.fn(),
      } as any;

      agentTeamEventBroadcaster.registerClient(controller, { teamId: 'team-1' });

      emitAgentInvoked('exec-1', 'team-1', {
        agentId: 'agent-1',
        agentName: 'Coder',
        agentRole: 'member',
        parentToolUseId: 'tool-123',
      });

      const lastMessage = new TextDecoder().decode(chunks[chunks.length - 1]);
      expect(lastMessage).toContain('agent_invoked');
      expect(lastMessage).toContain('Coder');
    });

    test('emitMessageDelta broadcasts correct event', () => {
      const chunks: Uint8Array[] = [];
      const controller = {
        enqueue: (chunk: Uint8Array) => chunks.push(chunk),
        close: vi.fn(),
      } as any;

      agentTeamEventBroadcaster.registerClient(controller, { teamId: 'team-1' });

      emitMessageDelta('exec-1', 'team-1', {
        agentId: 'agent-1',
        content: 'Processing...',
      });

      const lastMessage = new TextDecoder().decode(chunks[chunks.length - 1]);
      expect(lastMessage).toContain('message_delta');
      expect(lastMessage).toContain('Processing...');
    });

    test('emitAgentCompleted broadcasts correct event', () => {
      const chunks: Uint8Array[] = [];
      const controller = {
        enqueue: (chunk: Uint8Array) => chunks.push(chunk),
        close: vi.fn(),
      } as any;

      agentTeamEventBroadcaster.registerClient(controller, { teamId: 'team-1' });

      emitAgentCompleted('exec-1', 'team-1', {
        agentId: 'agent-1',
        agentName: 'Coder',
        result: 'Code written',
        tokens: { input: 100, output: 50 },
      });

      const lastMessage = new TextDecoder().decode(chunks[chunks.length - 1]);
      expect(lastMessage).toContain('agent_completed');
      expect(lastMessage).toContain('Code written');
    });

    test('emitExecutionCompleted broadcasts correct event', () => {
      const chunks: Uint8Array[] = [];
      const controller = {
        enqueue: (chunk: Uint8Array) => chunks.push(chunk),
        close: vi.fn(),
      } as any;

      agentTeamEventBroadcaster.registerClient(controller, { teamId: 'team-1' });

      emitExecutionCompleted('exec-1', 'team-1', {
        result: 'All done',
        totalTokens: { input: 500, output: 200 },
        totalCostUsd: 0.25,
        status: 'completed',
      });

      const lastMessage = new TextDecoder().decode(chunks[chunks.length - 1]);
      expect(lastMessage).toContain('execution_completed');
      expect(lastMessage).toContain('All done');
    });
  });

  describe('createAgentTeamEventStream', () => {
    test('creates readable stream', () => {
      const stream = createAgentTeamEventStream('team-1');

      expect(stream).toBeInstanceOf(ReadableStream);
    });

    test('stream registers client on start', async () => {
      const stream = createAgentTeamEventStream('team-1');
      const reader = stream.getReader();

      // Start reading
      const { value } = await reader.read();

      // Should receive connected event
      expect(value).toBeDefined();
      const message = new TextDecoder().decode(value);
      expect(message).toContain('connected');

      reader.releaseLock();
    });

    test('stream unregisters client on cancel', async () => {
      // Close all first to ensure clean state
      agentTeamEventBroadcaster.closeAll();

      const stream = createAgentTeamEventStream('team-1');

      // Stream starts immediately, so client is registered
      const reader = stream.getReader();
      await reader.read();

      expect(agentTeamEventBroadcaster.getClientCount()).toBe(1);

      await reader.cancel();

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(agentTeamEventBroadcaster.getClientCount()).toBe(0);
    });
  });

  describe('Utility Methods', () => {
    test('getActiveExecutions returns active execution IDs', () => {
      const controller1 = { enqueue: vi.fn(), close: vi.fn() } as any;
      const controller2 = { enqueue: vi.fn(), close: vi.fn() } as any;

      agentTeamEventBroadcaster.registerClient(controller1, {
        teamId: 'team-1',
        executionId: 'exec-1',
      });
      agentTeamEventBroadcaster.registerClient(controller2, {
        teamId: 'team-2',
        executionId: 'exec-2',
      });

      const activeExecutions = agentTeamEventBroadcaster.getActiveExecutions();

      expect(activeExecutions).toContain('exec-1');
      expect(activeExecutions).toContain('exec-2');
    });

    test('closeAll closes all connections', () => {
      const closeMock1 = vi.fn();
      const closeMock2 = vi.fn();
      const controller1 = { enqueue: vi.fn(), close: closeMock1 } as any;
      const controller2 = { enqueue: vi.fn(), close: closeMock2 } as any;

      agentTeamEventBroadcaster.registerClient(controller1, { teamId: 'team-1' });
      agentTeamEventBroadcaster.registerClient(controller2, { teamId: 'team-2' });

      agentTeamEventBroadcaster.closeAll();

      expect(closeMock1).toHaveBeenCalled();
      expect(closeMock2).toHaveBeenCalled();
      expect(agentTeamEventBroadcaster.getClientCount()).toBe(0);
    });
  });
});