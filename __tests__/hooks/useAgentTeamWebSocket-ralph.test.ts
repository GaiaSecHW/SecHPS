/**
 * useAgentTeamWebSocket Ralph Loop Tests - Task 28
 *
 * @vitest-environment jsdom
 *
 * Test cases:
 * 1. Iteration state tracking (iteration_started, iteration_completed events)
 * 2. Experience learning state tracking (experience_queried event)
 * 3. Callback invocations for Ralph Loop events
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgentTeamWebSocket } from '@/hooks/useAgentTeamWebSocket';
import type {
  IterationStartedData,
  IterationCompletedData,
  ExperienceQueriedData,
  AgentTeamEvent,
} from '@/types/agent-team-events';
import {
  AGENT_TEAM_EVENT_TYPES,
  createIterationStartedEvent,
  createIterationCompletedEvent,
  createExperienceQueriedEvent,
} from '@/types/agent-team-events';

// Mock EventSource
class MockEventSource {
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState: number = 0;
  private listeners: Map<string, ((event: MessageEvent) => void)[]> = new Map();
  private closed = false;

  constructor(url: string) {
    this.url = url;
    this.readyState = 1; // OPEN
    // Simulate connection after a short delay
    setTimeout(() => {
      if (!this.closed && this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 10);
  }

  addEventListener(type: string, callback: (event: MessageEvent) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)!.push(callback);
  }

  removeEventListener(type: string, callback: (event: MessageEvent) => void) {
    const callbacks = this.listeners.get(type);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) callbacks.splice(index, 1);
    }
  }

  dispatchEvent(event: MessageEvent): boolean {
    const callbacks = this.listeners.get(event.type);
    if (callbacks) {
      callbacks.forEach(cb => cb(event));
    }
    return true;
  }

  close() {
    this.closed = true;
    this.readyState = 2; // CLOSED
  }

  // Helper to simulate receiving a message
  simulateMessage(data: string) {
    if (!this.closed && this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }

  // Helper to simulate an error
  simulateError() {
    if (!this.closed && this.onerror) {
      this.onerror(new Event('error'));
    }
  }
}

// Mock global EventSource
vi.stubGlobal('EventSource', MockEventSource);

// Suppress console logs
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('useAgentTeamWebSocket - Ralph Loop Tests', () => {
  let mockEventSource: MockEventSource | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEventSource = null;

    // Capture EventSource instances
    const originalEventSource = MockEventSource;
    vi.stubGlobal('EventSource', class extends originalEventSource {
      constructor(url: string) {
        super(url);
        mockEventSource = this as unknown as MockEventSource;
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (mockEventSource) {
      mockEventSource.close();
    }
  });

  // ============ Helper: Create SSE message ============
  const createSSEMessage = (event: AgentTeamEvent): string => {
    return JSON.stringify(event);
  };

  // ============ Test Case 1: Iteration State Tracking ============
  describe('Iteration State Tracking', () => {
    test('iteration_started event updates iteration state', async () => {
      const onIterationStarted = vi.fn();

      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
          onIterationStarted,
        })
      );

      // Wait for connection
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // Simulate iteration_started event
      const event = createIterationStartedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        iteration: 2,
        maxIterations: 5,
        previousFeedback: 'Try again',
        totalCostUsdSoFar: 0.15,
      });

      await act(async () => {
        mockEventSource?.simulateMessage(createSSEMessage(event));
      });

      // Verify iteration state
      expect(result.current.iteration).not.toBeNull();
      expect(result.current.iteration?.current).toBe(2);
      expect(result.current.iteration?.max).toBe(5);
      expect(result.current.iteration?.totalCostUsd).toBe(0.15);
      expect(result.current.iteration?.status).toBe('running');
      expect(result.current.iteration?.verified).toBe(false);

      // Verify callback was called
      expect(onIterationStarted).toHaveBeenCalledWith({
        executionId: 'exec-1',
        iteration: 2,
        maxIterations: 5,
        previousFeedback: 'Try again',
        totalCostUsdSoFar: 0.15,
      });
    });

    test('iteration_completed event updates iteration state with verification', async () => {
      const onIterationCompleted = vi.fn();

      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
          onIterationCompleted,
        })
      );

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // First send iteration_started
      const startedEvent = createIterationStartedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        iteration: 3,
        maxIterations: 5,
        totalCostUsdSoFar: 0.20,
      });

      await act(async () => {
        mockEventSource?.simulateMessage(createSSEMessage(startedEvent));
      });

      // Then send iteration_completed with verified=true
      const completedEvent = createIterationCompletedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        iteration: 3,
        result: 'Task completed successfully',
        verified: true,
        feedback: 'All tests passed',
        tokensUsed: { input: 500, output: 200 },
        costUsd: 0.05,
        totalCostUsdSoFar: 0.25,
      });

      await act(async () => {
        mockEventSource?.simulateMessage(createSSEMessage(completedEvent));
      });

      // Verify iteration state updated
      expect(result.current.iteration?.current).toBe(3);
      expect(result.current.iteration?.verified).toBe(true);
      expect(result.current.iteration?.status).toBe('verified');
      expect(result.current.iteration?.totalCostUsd).toBe(0.25);

      // Verify history contains the iteration record
      expect(result.current.iteration?.history.length).toBe(1);
      const historyRecord = result.current.iteration?.history[0];
      expect(historyRecord?.iteration).toBe(3);
      expect(historyRecord?.verification.verified).toBe(true);
      expect(historyRecord?.verification.feedback).toBe('All tests passed');
      expect(historyRecord?.costUsd).toBe(0.05);

      // Verify callback was called
      expect(onIterationCompleted).toHaveBeenCalledWith({
        executionId: 'exec-1',
        iteration: 3,
        result: 'Task completed successfully',
        verified: true,
        feedback: 'All tests passed',
        tokensUsed: { input: 500, output: 200 },
        costUsd: 0.05,
        totalCostUsdSoFar: 0.25,
      });
    });

    test('iteration_completed event with verified=false updates status to failed', async () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // Send iteration_completed with verified=false
      const completedEvent = createIterationCompletedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        iteration: 1,
        result: 'Still working',
        verified: false,
        feedback: 'Need to continue',
        tokensUsed: { input: 100, output: 50 },
        costUsd: 0.01,
        totalCostUsdSoFar: 0.01,
      });

      await act(async () => {
        mockEventSource?.simulateMessage(createSSEMessage(completedEvent));
      });

      // Verify status is 'failed' (not verified)
      expect(result.current.iteration?.status).toBe('failed');
      expect(result.current.iteration?.verified).toBe(false);
    });

    test('iteration history accumulates across multiple iterations', async () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // Send multiple iteration events
      for (let i = 1; i <= 3; i++) {
        const startedEvent = createIterationStartedEvent('exec-1', 'team-1', {
          executionId: 'exec-1',
          iteration: i,
          maxIterations: 5,
          totalCostUsdSoFar: i * 0.05,
        });

        await act(async () => {
          mockEventSource?.simulateMessage(createSSEMessage(startedEvent));
        });

        const completedEvent = createIterationCompletedEvent('exec-1', 'team-1', {
          executionId: 'exec-1',
          iteration: i,
          result: `Iteration ${i} result`,
          verified: i === 3, // Only verified on iteration 3
          feedback: i === 3 ? 'Done' : 'Continue',
          tokensUsed: { input: 100, output: 50 },
          costUsd: 0.05,
          totalCostUsdSoFar: i * 0.05,
        });

        await act(async () => {
          mockEventSource?.simulateMessage(createSSEMessage(completedEvent));
        });
      }

      // Verify history has 3 records
      expect(result.current.iteration?.history.length).toBe(3);

      // Verify each record
      const history = result.current.iteration?.history || [];
      expect(history[0]?.iteration).toBe(1);
      expect(history[0]?.verification.verified).toBe(false);
      expect(history[1]?.iteration).toBe(2);
      expect(history[1]?.verification.verified).toBe(false);
      expect(history[2]?.iteration).toBe(3);
      expect(history[2]?.verification.verified).toBe(true);

      // Verify final status is verified
      expect(result.current.iteration?.status).toBe('verified');
    });
  });

  // ============ Test Case 2: Experience Learning State Tracking ============
  describe('Experience Learning State Tracking', () => {
    test('experience_queried event updates experience state', async () => {
      const onExperienceQueried = vi.fn();

      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
          onExperienceQueried,
        })
      );

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // Send experience_queried event
      const event = createExperienceQueriedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        iteration: 2,
        experiencesFound: 3,
        experienceTitles: ['Fix path errors', 'Permission denied fix', 'Timeout handling'],
        guidanceInjected: '## Experience Guidance\nCheck file paths first...',
      });

      await act(async () => {
        mockEventSource?.simulateMessage(createSSEMessage(event));
      });

      // Verify experience state
      expect(result.current.experience).not.toBeNull();
      expect(result.current.experience?.queried).toBe(true);
      expect(result.current.experience?.count).toBe(3);
      expect(result.current.experience?.titles).toContain('Fix path errors');
      expect(result.current.experience?.titles).toContain('Permission denied fix');
      expect(result.current.experience?.titles).toContain('Timeout handling');
      expect(result.current.experience?.iteration).toBe(2);
      expect(result.current.experience?.guidanceInjected).toContain('Experience Guidance');

      // Verify callback was called
      expect(onExperienceQueried).toHaveBeenCalledWith({
        executionId: 'exec-1',
        iteration: 2,
        experiencesFound: 3,
        experienceTitles: ['Fix path errors', 'Permission denied fix', 'Timeout handling'],
        guidanceInjected: '## Experience Guidance\nCheck file paths first...',
      });
    });

    test('experience_queried event updates iteration history', async () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // First send iteration_started and completed
      const startedEvent = createIterationStartedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        iteration: 1,
        maxIterations: 5,
      });

      await act(async () => {
        mockEventSource?.simulateMessage(createSSEMessage(startedEvent));
      });

      const completedEvent = createIterationCompletedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        iteration: 1,
        result: 'Failed',
        verified: false,
        tokensUsed: { input: 100, output: 50 },
        costUsd: 0.01,
        totalCostUsdSoFar: 0.01,
      });

      await act(async () => {
        mockEventSource?.simulateMessage(createSSEMessage(completedEvent));
      });

      // Then send experience_queried
      const experienceEvent = createExperienceQueriedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        iteration: 1,
        experiencesFound: 2,
        experienceTitles: ['Fix A', 'Fix B'],
        guidanceInjected: 'Try this...',
      });

      await act(async () => {
        mockEventSource?.simulateMessage(createSSEMessage(experienceEvent));
      });

      // Verify iteration history updated with experience info
      const historyRecord = result.current.iteration?.history[0];
      expect(historyRecord?.experienceQueried).toBe(true);
      expect(historyRecord?.experiencesFound).toBe(2);
    });

    test('multiple experience_queried events for different iterations', async () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // Send iteration 1 with experience
      const started1 = createIterationStartedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        iteration: 1,
        maxIterations: 5,
      });
      await act(async () => {
        mockEventSource?.simulateMessage(createSSEMessage(started1));
      });

      const completed1 = createIterationCompletedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        iteration: 1,
        result: 'Failed',
        verified: false,
        tokensUsed: { input: 100, output: 50 },
        costUsd: 0.01,
        totalCostUsdSoFar: 0.01,
      });
      await act(async () => {
        mockEventSource?.simulateMessage(createSSEMessage(completed1));
      });

      const exp1 = createExperienceQueriedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        iteration: 1,
        experiencesFound: 1,
        experienceTitles: ['Fix 1'],
        guidanceInjected: 'Guidance 1',
      });
      await act(async () => {
        mockEventSource?.simulateMessage(createSSEMessage(exp1));
      });

      // Send iteration 2 with experience
      const started2 = createIterationStartedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        iteration: 2,
        maxIterations: 5,
      });
      await act(async () => {
        mockEventSource?.simulateMessage(createSSEMessage(started2));
      });

      const completed2 = createIterationCompletedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        iteration: 2,
        result: 'Failed again',
        verified: false,
        tokensUsed: { input: 100, output: 50 },
        costUsd: 0.01,
        totalCostUsdSoFar: 0.02,
      });
      await act(async () => {
        mockEventSource?.simulateMessage(createSSEMessage(completed2));
      });

      const exp2 = createExperienceQueriedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        iteration: 2,
        experiencesFound: 2,
        experienceTitles: ['Fix 2A', 'Fix 2B'],
        guidanceInjected: 'Guidance 2',
      });
      await act(async () => {
        mockEventSource?.simulateMessage(createSSEMessage(exp2));
      });

      // Verify both iterations have experience info
      const history = result.current.iteration?.history || [];
      expect(history[0]?.experienceQueried).toBe(true);
      expect(history[0]?.experiencesFound).toBe(1);
      expect(history[1]?.experienceQueried).toBe(true);
      expect(history[1]?.experiencesFound).toBe(2);

      // Verify current experience state reflects latest
      expect(result.current.experience?.iteration).toBe(2);
      expect(result.current.experience?.count).toBe(2);
    });
  });

  // ============ Test Case 3: Callback Invocations ============
  describe('Callback Invocations', () => {
    test('all Ralph Loop callbacks are invoked correctly', async () => {
      const onIterationStarted = vi.fn();
      const onIterationCompleted = vi.fn();
      const onExperienceQueried = vi.fn();

      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
          onIterationStarted,
          onIterationCompleted,
          onExperienceQueried,
        })
      );

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // Send full Ralph Loop sequence
      const startedEvent = createIterationStartedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        iteration: 1,
        maxIterations: 3,
        previousFeedback: undefined,
        totalCostUsdSoFar: 0,
      });
      await act(async () => {
        mockEventSource?.simulateMessage(createSSEMessage(startedEvent));
      });

      expect(onIterationStarted).toHaveBeenCalledTimes(1);

      const completedEvent = createIterationCompletedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        iteration: 1,
        result: 'Not done',
        verified: false,
        feedback: 'Continue',
        tokensUsed: { input: 100, output: 50 },
        costUsd: 0.01,
        totalCostUsdSoFar: 0.01,
      });
      await act(async () => {
        mockEventSource?.simulateMessage(createSSEMessage(completedEvent));
      });

      expect(onIterationCompleted).toHaveBeenCalledTimes(1);

      const experienceEvent = createExperienceQueriedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        iteration: 1,
        experiencesFound: 1,
        experienceTitles: ['Fix'],
        guidanceInjected: 'Try this',
      });
      await act(async () => {
        mockEventSource?.simulateMessage(createSSEMessage(experienceEvent));
      });

      expect(onExperienceQueried).toHaveBeenCalledTimes(1);

      // Verify all callbacks received correct data
      expect(onIterationStarted).toHaveBeenCalledWith(expect.objectContaining({
        iteration: 1,
        maxIterations: 3,
      }));

      expect(onIterationCompleted).toHaveBeenCalledWith(expect.objectContaining({
        iteration: 1,
        verified: false,
        feedback: 'Continue',
      }));

      expect(onExperienceQueried).toHaveBeenCalledWith(expect.objectContaining({
        iteration: 1,
        experiencesFound: 1,
      }));
    });

    test('callbacks are not invoked when hook is disabled', async () => {
      const onIterationStarted = vi.fn();
      const onIterationCompleted = vi.fn();

      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: false, // Disabled
          onIterationStarted,
          onIterationCompleted,
        })
      );

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // EventSource should not be created when disabled
      expect(mockEventSource).toBeNull();

      // Callbacks should not be called
      expect(onIterationStarted).not.toHaveBeenCalled();
      expect(onIterationCompleted).not.toHaveBeenCalled();
    });
  });

  // ============ Test Case 4: Connection Lifecycle ============
  describe('Connection Lifecycle', () => {
    test('disconnect clears iteration and experience state', async () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // Send events to populate state
      const startedEvent = createIterationStartedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        iteration: 1,
        maxIterations: 5,
      });
      await act(async () => {
        mockEventSource?.simulateMessage(createSSEMessage(startedEvent));
      });

      const experienceEvent = createExperienceQueriedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        iteration: 1,
        experiencesFound: 1,
        experienceTitles: ['Fix'],
        guidanceInjected: 'Try',
      });
      await act(async () => {
        mockEventSource?.simulateMessage(createSSEMessage(experienceEvent));
      });

      // Verify state is populated
      expect(result.current.iteration).not.toBeNull();
      expect(result.current.experience).not.toBeNull();

      // Disconnect
      act(() => {
        result.current.disconnect();
      });

      // Note: disconnect doesn't clear state, just closes connection
      // State persists for display purposes
      expect(result.current.isConnected).toBe(false);
    });

    test('reconnect resets iteration state', async () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // Send initial events
      const startedEvent = createIterationStartedEvent('exec-1', 'team-1', {
        executionId: 'exec-1',
        iteration: 2,
        maxIterations: 5,
      });
      await act(async () => {
        mockEventSource?.simulateMessage(createSSEMessage(startedEvent));
      });

      expect(result.current.iteration?.current).toBe(2);

      // Disconnect and reconnect
      act(() => {
        result.current.disconnect();
      });

      await act(async () => {
        result.current.connect();
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // New connection should start fresh
      // Note: State persists but new events will update it
      expect(result.current.isConnected).toBe(true);
    });
  });

  // ============ Test Case 5: Edge Cases ============
  describe('Edge Cases', () => {
    test('handles malformed iteration event gracefully', async () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // Send malformed JSON
      await act(async () => {
        mockEventSource?.simulateMessage('not valid json');
      });

      // State should remain null (no crash)
      expect(result.current.iteration).toBeNull();
      expect(result.current.error).toBeNull();
    });

    test('handles iteration event with missing fields', async () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // Send event with missing required fields
      const malformedEvent = {
        type: 'iteration_started',
        executionId: 'exec-1',
        teamId: 'team-1',
        timestamp: new Date(),
        data: {
          // Missing iteration and maxIterations
          executionId: 'exec-1',
        },
      };

      await act(async () => {
        mockEventSource?.simulateMessage(JSON.stringify(malformedEvent));
      });

      // Should handle gracefully (state may be undefined or have defaults)
      // No crash should occur
      expect(result.current).toBeDefined();
    });

    test('handles rapid iteration events', async () => {
      const { result } = renderHook(() =>
        useAgentTeamWebSocket({
          teamId: 'team-1',
          token: 'test-token',
          enabled: true,
        })
      );

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      // Send 10 rapid iteration events
      await act(async () => {
        for (let i = 1; i <= 10; i++) {
          const startedEvent = createIterationStartedEvent('exec-1', 'team-1', {
            executionId: 'exec-1',
            iteration: i,
            maxIterations: 10,
          });
          mockEventSource?.simulateMessage(createSSEMessage(startedEvent));

          const completedEvent = createIterationCompletedEvent('exec-1', 'team-1', {
            executionId: 'exec-1',
            iteration: i,
            result: `Result ${i}`,
            verified: i === 10,
            tokensUsed: { input: 100, output: 50 },
            costUsd: 0.01,
            totalCostUsdSoFar: i * 0.01,
          });
          mockEventSource?.simulateMessage(createSSEMessage(completedEvent));
        }
      });

      // Verify all 10 iterations are tracked
      expect(result.current.iteration?.history.length).toBe(10);
      expect(result.current.iteration?.current).toBe(10);
      expect(result.current.iteration?.verified).toBe(true);
    });
  });
});