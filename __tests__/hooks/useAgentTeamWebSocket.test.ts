/**
 * @vitest-environment jsdom
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock EventSource
class MockEventSource {
  url: string;
  onopen: ((this: EventSource, ev: Event) => any) | null = null;
  onmessage: ((this: EventSource, ev: MessageEvent) => any) | null = null;
  onerror: ((this: EventSource, ev: Event) => any) | null = null;
  readyState: number = 0; // CONNECTING
  private listeners: Map<string, EventListener[]> = new Map();
  static instances: MockEventSource[] = [];

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)!.push(listener);
  }

  removeEventListener(type: string, listener: EventListener) {
    const arr = this.listeners.get(type);
    if (arr) {
      const idx = arr.indexOf(listener);
      if (idx >= 0) arr.splice(idx, 1);
    }
  }

  dispatchEvent(event: Event): boolean {
    const listeners = this.listeners.get(event.type);
    if (listeners) {
      listeners.forEach(l => l(event));
    }
    return true;
  }

  close() {
    this.readyState = 2; // CLOSED
  }

  // Helper methods for testing
  simulateOpen() {
    this.readyState = 1; // OPEN
    if (this.onopen) {
      this.onopen.call(this as any, new Event('open'));
    }
  }

  simulateMessage(data: string) {
    if (this.onmessage) {
      const event = new MessageEvent('message', { data });
      this.onmessage.call(this as any, event);
    }
  }

  simulateError() {
    if (this.onerror) {
      this.onerror.call(this as any, new Event('error'));
    }
  }

  simulateCustomEvent(type: string, data: string) {
    const event = new MessageEvent(type, { data });
    this.dispatchEvent(event);
  }
}

// Mock global EventSource
vi.stubGlobal('EventSource', MockEventSource);

// Import hook after mocking
import { useAgentTeamWebSocket } from '@/hooks/useAgentTeamWebSocket';

// Suppress console logs
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('useAgentTeamWebSocket', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    MockEventSource.instances.forEach(es => es.close());
    MockEventSource.instances = [];
  });

  describe('Connection', () => {
    test('connects to SSE stream when enabled', () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      expect(MockEventSource.instances.length).toBe(1);
      expect(MockEventSource.instances[0].url).toContain('/api/agent-teams/team-1/stream');
      expect(MockEventSource.instances[0].url).toContain('token=test-token');
    });

    test('does not connect when disabled', () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: false,
        })
      );

      expect(MockEventSource.instances.length).toBe(0);
      expect(result.current.isConnected).toBe(false);
    });

    test('includes executionId in URL when provided', () => {
      renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          executionId: 'exec-1',
          token: 'test-token',
          enabled: true,
        })
      );

      expect(MockEventSource.instances[0].url).toContain('executionId=exec-1');
    });

    test('sets isConnected to true on open', () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      expect(result.current.isConnected).toBe(false);

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      expect(result.current.isConnected).toBe(true);
      expect(result.current.isConnecting).toBe(false);
    });

    test('disconnect closes EventSource', () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      expect(result.current.isConnected).toBe(true);

      act(() => {
        result.current.disconnect();
      });

      expect(MockEventSource.instances[0].readyState).toBe(2); // CLOSED
      expect(result.current.isConnected).toBe(false);
    });
  });

  describe('Event Parsing', () => {
    test('parses execution_started event', () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
        MockEventSource.instances[0].simulateMessage(JSON.stringify({
          type: 'execution_started',
          executionId: 'exec-1',
          teamId: 'team-1',
          timestamp: '2024-01-01T00:00:00Z',
          data: {
            executionId: 'exec-1',
            teamId: 'team-1',
            teamName: 'Test Team',
            leadAgentId: 'agent-1',
            leadAgentName: 'Lead Agent',
            memberCount: 3,
          },
        }));
      });

      expect(result.current.execution).toBeDefined();
      expect(result.current.execution?.executionId).toBe('exec-1');
      expect(result.current.execution?.status).toBe('running');
      expect(result.current.execution?.teamName).toBe('Test Team');
      expect(result.current.agents.length).toBe(1);
      expect(result.current.agents[0].agentId).toBe('agent-1');
      expect(result.current.agents[0].agentRole).toBe('lead');
    });

    test('parses agent_invoked event', () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
        MockEventSource.instances[0].simulateMessage(JSON.stringify({
          type: 'agent_invoked',
          executionId: 'exec-1',
          teamId: 'team-1',
          timestamp: '2024-01-01T00:00:00Z',
          data: {
            agentId: 'agent-2',
            agentName: 'Coder Agent',
            agentRole: 'member',
            parentToolUseId: 'tool-123',
            memberId: 'member-1',
          },
        }));
      });

      expect(result.current.agents.length).toBe(1);
      expect(result.current.agents[0].agentId).toBe('agent-2');
      expect(result.current.agents[0].agentName).toBe('Coder Agent');
      expect(result.current.agents[0].agentRole).toBe('member');
      expect(result.current.agents[0].memberId).toBe('member-1');
      expect(result.current.agents[0].status).toBe('running');
    });

    test('parses message_delta event', () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
        MockEventSource.instances[0].simulateMessage(JSON.stringify({
          type: 'message_delta',
          executionId: 'exec-1',
          teamId: 'team-1',
          timestamp: '2024-01-01T00:00:00Z',
          data: {
            agentId: 'agent-1',
            content: 'Hello world',
          },
        }));
      });

      expect(result.current.messages.length).toBe(1);
      expect(result.current.messages[0].agentId).toBe('agent-1');
      expect(result.current.messages[0].content).toBe('Hello world');
    });

    test('parses agent_completed event', () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      // First add an agent
      act(() => {
        MockEventSource.instances[0].simulateOpen();
        MockEventSource.instances[0].simulateMessage(JSON.stringify({
          type: 'agent_invoked',
          executionId: 'exec-1',
          teamId: 'team-1',
          timestamp: '2024-01-01T00:00:00Z',
          data: {
            agentId: 'agent-1',
            agentName: 'Coder',
            agentRole: 'member',
            parentToolUseId: null,
          },
        }));
      });

      expect(result.current.agents[0].status).toBe('running');

      // Then complete it
      act(() => {
        MockEventSource.instances[0].simulateMessage(JSON.stringify({
          type: 'agent_completed',
          executionId: 'exec-1',
          teamId: 'team-1',
          timestamp: '2024-01-01T00:01:00Z',
          data: {
            agentId: 'agent-1',
            agentName: 'Coder',
            result: 'Code written successfully',
            tokens: { input: 100, output: 50 },
          },
        }));
      });

      expect(result.current.agents[0].status).toBe('completed');
      expect(result.current.agents[0].result).toBe('Code written successfully');
      expect(result.current.agents[0].tokens?.input).toBe(100);
      expect(result.current.agents[0].tokens?.output).toBe(50);
    });

    test('parses execution_completed event', () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
        MockEventSource.instances[0].simulateMessage(JSON.stringify({
          type: 'execution_started',
          executionId: 'exec-1',
          teamId: 'team-1',
          timestamp: '2024-01-01T00:00:00Z',
          data: {
            executionId: 'exec-1',
            teamId: 'team-1',
          },
        }));
      });

      expect(result.current.execution?.status).toBe('running');

      act(() => {
        MockEventSource.instances[0].simulateMessage(JSON.stringify({
          type: 'execution_completed',
          executionId: 'exec-1',
          teamId: 'team-1',
          timestamp: '2024-01-01T00:05:00Z',
          data: {
            executionId: 'exec-1',
            result: 'All tasks completed',
            totalTokens: { input: 500, output: 200 },
            totalCostUsd: 0.25,
            status: 'completed',
          },
        }));
      });

      expect(result.current.execution?.status).toBe('completed');
      expect(result.current.execution?.result).toBe('All tasks completed');
      expect(result.current.execution?.totalTokens?.input).toBe(500);
      expect(result.current.execution?.totalCostUsd).toBe(0.25);
    });

    test('handles invalid JSON gracefully', () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
        MockEventSource.instances[0].simulateMessage('invalid json');
      });

      // Should not crash, state should remain unchanged
      expect(result.current.messages.length).toBe(0);
      expect(result.current.execution).toBeNull();
    });

    test('handles missing required fields gracefully', () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
        MockEventSource.instances[0].simulateMessage(JSON.stringify({
          type: 'message_delta',
          // Missing executionId and teamId
          timestamp: '2024-01-01T00:00:00Z',
          data: {
            agentId: 'agent-1',
            content: 'Hello',
          },
        }));
      });

      // Should not update state due to invalid event structure
      expect(result.current.messages.length).toBe(0);
    });
  });

  describe('Callbacks', () => {
    test('calls onExecutionStarted callback', () => {
      const onExecutionStarted = vi.fn();

      renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
          onExecutionStarted,
        })
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
        MockEventSource.instances[0].simulateMessage(JSON.stringify({
          type: 'execution_started',
          executionId: 'exec-1',
          teamId: 'team-1',
          timestamp: '2024-01-01T00:00:00Z',
          data: {
            executionId: 'exec-1',
            teamId: 'team-1',
            teamName: 'Test Team',
          },
        }));
      });

      expect(onExecutionStarted).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: 'exec-1',
          teamId: 'team-1',
          teamName: 'Test Team',
        })
      );
    });

    test('calls onMessageDelta callback', () => {
      const onMessageDelta = vi.fn();

      renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
          onMessageDelta,
        })
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
        MockEventSource.instances[0].simulateMessage(JSON.stringify({
          type: 'message_delta',
          executionId: 'exec-1',
          teamId: 'team-1',
          timestamp: '2024-01-01T00:00:00Z',
          data: {
            agentId: 'agent-1',
            content: 'Hello',
          },
        }));
      });

      expect(onMessageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          content: 'Hello',
        })
      );
    });

    test('calls onExecutionCompleted callback', () => {
      const onExecutionCompleted = vi.fn();

      renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
          onExecutionCompleted,
        })
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
        MockEventSource.instances[0].simulateMessage(JSON.stringify({
          type: 'execution_completed',
          executionId: 'exec-1',
          teamId: 'team-1',
          timestamp: '2024-01-01T00:00:00Z',
          data: {
            executionId: 'exec-1',
            result: 'Done',
            totalTokens: { input: 100, output: 50 },
            status: 'completed',
          },
        }));
      });

      expect(onExecutionCompleted).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: 'exec-1',
          result: 'Done',
          status: 'completed',
        })
      );
    });

    test('calls onError callback on connection error', () => {
      const onError = vi.fn();

      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
          onError,
        })
      );

      act(() => {
        MockEventSource.instances[0].simulateError();
      });

      expect(onError).toHaveBeenCalled();
      expect(result.current.error).toBeDefined();
    });
  });

  describe('Error Handling & Retry', () => {
    test('sets error on connection error', () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      act(() => {
        MockEventSource.instances[0].simulateError();
      });

      expect(result.current.error).toBeDefined();
      expect(result.current.isConnected).toBe(false);
    });

    test('retries connection on error', async () => {
      vi.useFakeTimers();

      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
          maxRetries: 3,
          retryDelay: 1000,
        })
      );

      // First connection attempt
      expect(MockEventSource.instances.length).toBe(1);

      act(() => {
        MockEventSource.instances[0].simulateError();
      });

      expect(result.current.retryCount).toBe(1);

      // Wait for retry delay
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      // Should have created new EventSource for retry
      expect(MockEventSource.instances.length).toBe(2);

      vi.useRealTimers();
    });

    test('stops retrying after max retries', async () => {
      vi.useFakeTimers();

      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
          maxRetries: 2,
          retryDelay: 100,
        })
      );

      // Initial connection
      expect(MockEventSource.instances.length).toBe(1);

      // Simulate first error - should trigger retry
      act(() => {
        MockEventSource.instances[0].simulateError();
      });

      expect(result.current.retryCount).toBe(1);

      // Wait for retry delay - should create new EventSource
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      expect(MockEventSource.instances.length).toBe(2);

      // Simulate second error - should trigger another retry
      act(() => {
        MockEventSource.instances[1].simulateError();
      });

      expect(result.current.retryCount).toBe(2);

      // Wait for retry delay - should create third EventSource
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      expect(MockEventSource.instances.length).toBe(3);

      // Simulate third error - should stop retrying (maxRetries=2)
      act(() => {
        MockEventSource.instances[2].simulateError();
      });

      // Should disconnect and not retry anymore
      expect(result.current.isConnected).toBe(false);

      vi.useRealTimers();
    });

    test('resets retry count on successful message', async () => {
      vi.useFakeTimers();

      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
          maxRetries: 3,
          retryDelay: 100,
        })
      );

      // Simulate error to increment retry count
      act(() => {
        MockEventSource.instances[0].simulateError();
      });

      expect(result.current.retryCount).toBe(1);

      // Wait for retry delay
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      // New EventSource should be created
      expect(MockEventSource.instances.length).toBe(2);

      // Simulate successful connection and message
      act(() => {
        MockEventSource.instances[1].simulateOpen();
        MockEventSource.instances[1].simulateMessage(JSON.stringify({
          type: 'execution_started',
          executionId: 'exec-1',
          teamId: 'team-1',
          timestamp: '2024-01-01T00:00:00Z',
          data: { executionId: 'exec-1', teamId: 'team-1' },
        }));
      });

      expect(result.current.retryCount).toBe(0);

      vi.useRealTimers();
    });
  });

  describe('Auto-disconnect', () => {
    test('auto-disconnects on execution_completed', () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
      });

      expect(result.current.isConnected).toBe(true);

      act(() => {
        MockEventSource.instances[0].simulateMessage(JSON.stringify({
          type: 'execution_completed',
          executionId: 'exec-1',
          teamId: 'team-1',
          timestamp: '2024-01-01T00:00:00Z',
          data: {
            executionId: 'exec-1',
            result: 'Done',
            totalTokens: { input: 100, output: 50 },
            status: 'completed',
          },
        }));
      });

      expect(result.current.isConnected).toBe(false);
      expect(MockEventSource.instances[0].readyState).toBe(2); // CLOSED
    });

    test('marks all agents as completed/failed on execution_completed', () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
        // Add agents
        MockEventSource.instances[0].simulateMessage(JSON.stringify({
          type: 'agent_invoked',
          executionId: 'exec-1',
          teamId: 'team-1',
          timestamp: '2024-01-01T00:00:00Z',
          data: {
            agentId: 'agent-1',
            agentName: 'Agent 1',
            agentRole: 'lead',
            parentToolUseId: null,
          },
        }));
        MockEventSource.instances[0].simulateMessage(JSON.stringify({
          type: 'agent_invoked',
          executionId: 'exec-1',
          teamId: 'team-1',
          timestamp: '2024-01-01T00:00:00Z',
          data: {
            agentId: 'agent-2',
            agentName: 'Agent 2',
            agentRole: 'member',
            parentToolUseId: 'tool-1',
          },
        }));
      });

      expect(result.current.agents.every(a => a.status === 'running')).toBe(true);

      act(() => {
        MockEventSource.instances[0].simulateMessage(JSON.stringify({
          type: 'execution_completed',
          executionId: 'exec-1',
          teamId: 'team-1',
          timestamp: '2024-01-01T00:05:00Z',
          data: {
            executionId: 'exec-1',
            result: 'Done',
            totalTokens: { input: 100, output: 50 },
            status: 'completed',
          },
        }));
      });

      expect(result.current.agents.every(a => a.status === 'completed')).toBe(true);
    });

    test('marks agents as failed on failed execution', () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
        MockEventSource.instances[0].simulateMessage(JSON.stringify({
          type: 'agent_invoked',
          executionId: 'exec-1',
          teamId: 'team-1',
          timestamp: '2024-01-01T00:00:00Z',
          data: {
            agentId: 'agent-1',
            agentName: 'Agent 1',
            agentRole: 'lead',
            parentToolUseId: null,
          },
        }));
      });

      act(() => {
        MockEventSource.instances[0].simulateMessage(JSON.stringify({
          type: 'execution_completed',
          executionId: 'exec-1',
          teamId: 'team-1',
          timestamp: '2024-01-01T00:05:00Z',
          data: {
            executionId: 'exec-1',
            result: 'Error occurred',
            totalTokens: { input: 100, output: 50 },
            status: 'failed',
          },
        }));
      });

      expect(result.current.agents.every(a => a.status === 'failed')).toBe(true);
    });
  });

  describe('Utility Methods', () => {
    test('clearMessages clears message history', () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
        MockEventSource.instances[0].simulateMessage(JSON.stringify({
          type: 'message_delta',
          executionId: 'exec-1',
          teamId: 'team-1',
          timestamp: '2024-01-01T00:00:00Z',
          data: {
            agentId: 'agent-1',
            content: 'Hello',
          },
        }));
      });

      expect(result.current.messages.length).toBe(1);

      act(() => {
        result.current.clearMessages();
      });

      expect(result.current.messages.length).toBe(0);
    });

    test('connect() manually reconnects', () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: false, // Start disabled
        })
      );

      expect(MockEventSource.instances.length).toBe(0);

      act(() => {
        result.current.connect();
      });

      expect(MockEventSource.instances.length).toBe(1);
    });
  });

  describe('Multiple Messages', () => {
    test('accumulates multiple message_delta events', () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
        for (let i = 0; i < 5; i++) {
          MockEventSource.instances[0].simulateMessage(JSON.stringify({
            type: 'message_delta',
            executionId: 'exec-1',
            teamId: 'team-1',
            timestamp: `2024-01-01T00:00:0${i}Z`,
            data: {
              agentId: 'agent-1',
              content: `Message ${i}`,
            },
          }));
        }
      });

      expect(result.current.messages.length).toBe(5);
      expect(result.current.messages.map(m => m.content)).toEqual([
        'Message 0',
        'Message 1',
        'Message 2',
        'Message 3',
        'Message 4',
      ]);
    });

    test('updates existing agent status on duplicate agent_invoked', () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      act(() => {
        MockEventSource.instances[0].simulateOpen();
        // First invocation
        MockEventSource.instances[0].simulateMessage(JSON.stringify({
          type: 'agent_invoked',
          executionId: 'exec-1',
          teamId: 'team-1',
          timestamp: '2024-01-01T00:00:00Z',
          data: {
            agentId: 'agent-1',
            agentName: 'Agent 1',
            agentRole: 'lead',
            parentToolUseId: null,
          },
        }));
        // Complete
        MockEventSource.instances[0].simulateMessage(JSON.stringify({
          type: 'agent_completed',
          executionId: 'exec-1',
          teamId: 'team-1',
          timestamp: '2024-01-01T00:01:00Z',
          data: {
            agentId: 'agent-1',
            agentName: 'Agent 1',
            result: 'Done',
            tokens: { input: 100, output: 50 },
          },
        }));
        // Re-invoke same agent
        MockEventSource.instances[0].simulateMessage(JSON.stringify({
          type: 'agent_invoked',
          executionId: 'exec-1',
          teamId: 'team-1',
          timestamp: '2024-01-01T00:02:00Z',
          data: {
            agentId: 'agent-1',
            agentName: 'Agent 1',
            agentRole: 'lead',
            parentToolUseId: null,
          },
        }));
      });

      expect(result.current.agents.length).toBe(1); // No duplicate
      expect(result.current.agents[0].status).toBe('running'); // Updated to running
    });
  });
});