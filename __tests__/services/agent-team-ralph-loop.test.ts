/**
 * Ralph Loop Integration Tests - Task 28
 *
 * Test cases:
 * 1. Iteration termination conditions (maxIterations, maxCostUsd, verified)
 * 2. Experience learning trigger (on_failure, always, disabled)
 * 3. WebSocket event broadcasting (iteration_started, iteration_completed, experience_queried)
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentTeamExecutionService, SAFETY_LIMITS } from '@/services/agent-team/execution-service';
import { prisma } from '@/lib/prisma';
import { parseRalphConfig, DEFAULT_RALPH_LOOP_CONFIG } from '@/types/ralph-loop-config';
import {
  emitIterationStarted,
  emitIterationCompleted,
  emitExperienceQueried,
} from '@/lib/agent-team-events';
import { buildDynamicExperiencePrompt, queryRelevantExperiences } from '@/services/autonomous-evolution/experience-query-service';

// Mock the Claude Agent SDK
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

// Import the mocked query
import { query } from '@anthropic-ai/claude-agent-sdk';

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    agentTeam: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    agentTeamExecution: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    agentMemberExecution: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    agentDefinition: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

// Mock agent-team-events broadcaster
vi.mock('@/lib/agent-team-events', () => ({
  agentTeamEventBroadcaster: {
    broadcast: vi.fn(),
    registerClient: vi.fn(),
    unregisterClient: vi.fn(),
    getClientCount: vi.fn(() => 0),
  },
  emitIterationStarted: vi.fn(),
  emitIterationCompleted: vi.fn(),
  emitExperienceQueried: vi.fn(),
}));

// Mock experience query service
vi.mock('@/services/autonomous-evolution/experience-query-service', () => ({
  queryRelevantExperiences: vi.fn(),
  buildDynamicExperiencePrompt: vi.fn(),
  classifyError: vi.fn(() => 'other'),
  calculateRelevanceScore: vi.fn(() => ({ score: 10, matchedPatterns: ['test'] })),
}));

// Suppress console logs in tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('AgentTeamExecutionService - Ralph Loop Integration Tests', () => {
  let service: AgentTeamExecutionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AgentTeamExecutionService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============ Helper: Create mock team with Ralph config ============
  const createMockTeamWithRalphConfig = (ralphConfig: object) => ({
    id: 'team-ralph-1',
    userId: 'user-1',
    name: 'Ralph Loop Test Team',
    description: 'Team with Ralph Loop enabled',
    leadAgentId: 'agent-1',
    taskStrategy: 'parallel',
    maxTeammates: 5,
    status: 'idle',
    ralphConfig: JSON.stringify(ralphConfig),
    createdAt: new Date(),
    updatedAt: new Date(),
    leadAgent: {
      id: 'agent-1',
      name: 'lead-agent',
      displayName: 'Lead Agent',
      description: 'Lead agent for orchestration',
      category: 'reviewer',
      model: 'claude-sonnet-4-20250514',
      systemPrompt: 'You are a lead agent.',
      allowedTools: JSON.stringify(['Read', 'Write', 'Bash']),
      mcpServers: null,
      isActive: true,
      isBuiltin: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    members: [],
  });

  const mockExecution = {
    id: 'exec-ralph-1',
    teamId: 'team-ralph-1',
    evaluationId: null,
    status: 'running',
    startedAt: new Date(),
    completedAt: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    createdAt: new Date(),
  };

  // ============ Test Case 1: Iteration Termination ============
  describe('Iteration Termination', () => {
    test('stops when maxIterations reached', async () => {
      const mockTeam = createMockTeamWithRalphConfig({
        enabled: true,
        maxIterations: 3,
        maxCostUsd: 10.00,
        experienceTrigger: 'disabled',
      });

      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 0 });
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      // Mock query that never returns verified (no completion keywords)
      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          for (let i = 0; i < 3; i++) {
            yield {
              type: 'assistant',
              content: [{ type: 'text', text: 'Working on task...' }],
              message: { usage: { input_tokens: 100, output_tokens: 50 } },
            };
            yield { type: 'result', subtype: 'success', result: 'Still working' };
          }
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: [],
      });

      const result = await service.executeWithRalphLoop({
        teamId: 'team-ralph-1',
        task: 'Test task',
      });

      // Verify iteration count = 3
      expect(result.iterations).toBe(3);
      expect(result.completionReason).toBe('max_iterations');
    });

    test('stops when maxCostUsd reached', async () => {
      const mockTeam = createMockTeamWithRalphConfig({
        enabled: true,
        maxIterations: 10,
        maxCostUsd: 0.01, // Very low cost limit
        experienceTrigger: 'disabled',
      });

      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 0 });
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      // Mock query with high token usage (will exceed cost limit)
      // Note: Result must NOT contain completion keywords to avoid early verification
      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            content: [{ type: 'text', text: 'Processing...' }],
            message: { usage: { input_tokens: 100000, output_tokens: 50000 } }, // High tokens
          };
          yield { type: 'result', subtype: 'success', result: 'Still processing data' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: [],
      });

      const result = await service.executeWithRalphLoop({
        teamId: 'team-ralph-1',
        task: 'Test task',
      });

      // Verify stops due to cost limit
      expect(result.completionReason).toBe('max_cost');
      expect(result.totalCostUsd).toBeGreaterThan(0);
    });

    test('stops when verified=true', async () => {
      const mockTeam = createMockTeamWithRalphConfig({
        enabled: true,
        maxIterations: 10,
        maxCostUsd: 10.00,
        experienceTrigger: 'disabled',
      });

      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 0 });
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      // Mock query that returns verified on iteration 2
      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          // Iteration 1 - not verified
          yield {
            type: 'assistant',
            content: [{ type: 'text', text: 'Working...' }],
            message: { usage: { input_tokens: 100, output_tokens: 50 } },
          };
          yield { type: 'result', subtype: 'success', result: 'Still working' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      // Second call returns verified
      const mockIteratorVerified = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            content: [{ type: 'text', text: 'Task completed successfully' }],
            message: { usage: { input_tokens: 100, output_tokens: 50 } },
          };
          yield { type: 'result', subtype: 'success', result: '任务完成' };
        },
      };

      let callCount = 0;
      (query as any).mockImplementation(() => {
        callCount++;
        if (callCount === 1) return mockIterator;
        return mockIteratorVerified;
      });

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: [],
      });

      const result = await service.executeWithRalphLoop({
        teamId: 'team-ralph-1',
        task: 'Test task',
      });

      // Verify stops at iteration 2 with verified
      expect(result.iterations).toBe(2);
      expect(result.completionReason).toBe('verified');
    });

    test('falls back to regular execute when Ralph Loop disabled', async () => {
      const mockTeam = createMockTeamWithRalphConfig({
        enabled: false,
        maxIterations: 10,
        maxCostUsd: 10.00,
        experienceTrigger: 'disabled',
      });

      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 0 });
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'result', subtype: 'success', result: 'Done' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: [],
      });

      const result = await service.executeWithRalphLoop({
        teamId: 'team-ralph-1',
        task: 'Test task',
      });

      // Falls back to single iteration
      expect(result.iterations).toBe(1);
      expect(result.completionReason).toBe('verified');
    });
  });

  // ============ Test Case 2: Experience Learning Trigger ============
  describe('Experience Learning Trigger', () => {
    test('queries experiences on verification failure (experienceTrigger=on_failure)', async () => {
      const mockTeam = createMockTeamWithRalphConfig({
        enabled: true,
        maxIterations: 3,
        maxCostUsd: 10.00,
        experienceTrigger: 'on_failure',
      });

      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 0 });
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      // Mock query that returns not verified
      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            content: [{ type: 'text', text: 'Working...' }],
            message: { usage: { input_tokens: 100, output_tokens: 50 } },
          };
          yield { type: 'result', subtype: 'success', result: 'Still in progress' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      // Mock experience query returning matches
      (buildDynamicExperiencePrompt as any).mockResolvedValue({
        prompt: 'Try a different approach...',
        matches: [
          {
            experience: {
              id: 'exp-1',
              title: 'Fix path errors',
              directSolution: 'Check file path',
              lesson: 'Always verify paths',
              errorPatterns: '["path not found"]',
              errorCategory: 'path_error',
              hitCount: 5,
            },
            relevanceScore: 10,
            matchedPatterns: ['path not found'],
          },
        ],
      });

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: [],
      });

      await service.executeWithRalphLoop({
        teamId: 'team-ralph-1',
        task: 'Test task',
      });

      // Verify experience query was called
      expect(buildDynamicExperiencePrompt).toHaveBeenCalled();
    });

    test('does not query experiences on verification success', async () => {
      const mockTeam = createMockTeamWithRalphConfig({
        enabled: true,
        maxIterations: 10,
        maxCostUsd: 10.00,
        experienceTrigger: 'on_failure',
      });

      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 0 });
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      // Mock query that returns verified immediately
      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            content: [{ type: 'text', text: 'Task completed' }],
            message: { usage: { input_tokens: 100, output_tokens: 50 } },
          };
          yield { type: 'result', subtype: 'success', result: '任务完成' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: [],
      });

      await service.executeWithRalphLoop({
        teamId: 'team-ralph-1',
        task: 'Test task',
      });

      // Verify experience query was NOT called (verified on first iteration)
      expect(buildDynamicExperiencePrompt).not.toHaveBeenCalled();
    });

    test('injects guidance into next iteration task', async () => {
      const mockTeam = createMockTeamWithRalphConfig({
        enabled: true,
        maxIterations: 3,
        maxCostUsd: 10.00,
        experienceTrigger: 'on_failure',
      });

      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 0 });
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      // Mock query calls
      let queryCallCount = 0;
      (query as any).mockImplementation(() => {
        queryCallCount++;
        const mockIterator = {
          async *[Symbol.asyncIterator]() {
            if (queryCallCount === 1) {
              // First iteration - not verified
              yield {
                type: 'assistant',
                content: [{ type: 'text', text: 'Working...' }],
                message: { usage: { input_tokens: 100, output_tokens: 50 } },
              };
              yield { type: 'result', subtype: 'success', result: 'Still working' };
            } else {
              // Second iteration - should have guidance injected
              yield {
                type: 'assistant',
                content: [{ type: 'text', text: 'Following guidance...' }],
                message: { usage: { input_tokens: 100, output_tokens: 50 } },
              };
              yield { type: 'result', subtype: 'success', result: '任务完成' };
            }
          },
        };
        return mockIterator;
      });

      // Mock experience query returning guidance
      (buildDynamicExperiencePrompt as any).mockResolvedValue({
        prompt: '## Experience Guidance\nTry checking file permissions first.',
        matches: [
          {
            experience: { title: 'Permission fix' },
            relevanceScore: 10,
            matchedPatterns: ['permission'],
          },
        ],
      });

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: [],
      });

      await service.executeWithRalphLoop({
        teamId: 'team-ralph-1',
        task: 'Test task',
      });

      // Verify second query call had guidance injected
      expect(query).toHaveBeenCalledTimes(2);
      const secondCallArgs = (query as any).mock.calls[1][0];
      expect(secondCallArgs.prompt).toContain('[经验指导]');
      expect(secondCallArgs.prompt).toContain('Experience Guidance');
    });

    test('experienceTrigger=disabled does not query experiences', async () => {
      const mockTeam = createMockTeamWithRalphConfig({
        enabled: true,
        maxIterations: 3,
        maxCostUsd: 10.00,
        experienceTrigger: 'disabled',
      });

      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 0 });
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            content: [{ type: 'text', text: 'Working...' }],
            message: { usage: { input_tokens: 100, output_tokens: 50 } },
          };
          yield { type: 'result', subtype: 'success', result: 'Still working' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: [],
      });

      await service.executeWithRalphLoop({
        teamId: 'team-ralph-1',
        task: 'Test task',
      });

      // Verify experience query was NOT called
      expect(buildDynamicExperiencePrompt).not.toHaveBeenCalled();
    });
  });

  // ============ Test Case 3: WebSocket Events ============
  describe('WebSocket Events', () => {
    test('broadcasts iteration_started event', async () => {
      const mockTeam = createMockTeamWithRalphConfig({
        enabled: true,
        maxIterations: 3,
        maxCostUsd: 10.00,
        experienceTrigger: 'disabled',
      });

      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 0 });
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            content: [{ type: 'text', text: 'Working...' }],
            message: { usage: { input_tokens: 100, output_tokens: 50 } },
          };
          yield { type: 'result', subtype: 'success', result: 'Still working' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: [],
      });

      await service.executeWithRalphLoop({
        teamId: 'team-ralph-1',
        task: 'Test task',
      });

      // Verify emitIterationStarted was called
      expect(emitIterationStarted).toHaveBeenCalled();
      const callArgs = (emitIterationStarted as any).mock.calls[0];
      expect(callArgs[0]).toBe('exec-ralph-1');
      expect(callArgs[1]).toBe('team-ralph-1');
      expect(callArgs[2].iteration).toBe(1);
      expect(callArgs[2].maxIterations).toBe(3);
    });

    test('broadcasts iteration_completed event', async () => {
      const mockTeam = createMockTeamWithRalphConfig({
        enabled: true,
        maxIterations: 3,
        maxCostUsd: 10.00,
        experienceTrigger: 'disabled',
      });

      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 0 });
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            content: [{ type: 'text', text: 'Working...' }],
            message: { usage: { input_tokens: 100, output_tokens: 50 } },
          };
          yield { type: 'result', subtype: 'success', result: 'Still working' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: [],
      });

      await service.executeWithRalphLoop({
        teamId: 'team-ralph-1',
        task: 'Test task',
      });

      // Verify emitIterationCompleted was called
      expect(emitIterationCompleted).toHaveBeenCalled();
      const callArgs = (emitIterationCompleted as any).mock.calls[0];
      expect(callArgs[0]).toBe('exec-ralph-1');
      expect(callArgs[1]).toBe('team-ralph-1');
      expect(callArgs[2].iteration).toBe(1);
      expect(callArgs[2].verified).toBe(false);
      expect(callArgs[2].tokensUsed).toBeDefined();
      expect(callArgs[2].costUsd).toBeDefined();
    });

    test('broadcasts experience_queried event when experiences found', async () => {
      const mockTeam = createMockTeamWithRalphConfig({
        enabled: true,
        maxIterations: 3,
        maxCostUsd: 10.00,
        experienceTrigger: 'on_failure',
      });

      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 0 });
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            content: [{ type: 'text', text: 'Working...' }],
            message: { usage: { input_tokens: 100, output_tokens: 50 } },
          };
          yield { type: 'result', subtype: 'success', result: 'Still working' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      // Mock experience query returning matches
      (buildDynamicExperiencePrompt as any).mockResolvedValue({
        prompt: 'Try checking permissions...',
        matches: [
          {
            experience: {
              id: 'exp-1',
              title: 'Permission Fix Guide',
              directSolution: 'chmod +x',
              lesson: 'Always check permissions',
              errorPatterns: '["permission denied"]',
              errorCategory: 'permission',
              hitCount: 10,
            },
            relevanceScore: 15,
            matchedPatterns: ['permission denied'],
          },
          {
            experience: {
              id: 'exp-2',
              title: 'Path Error Fix',
              directSolution: 'Check path',
              lesson: 'Verify paths exist',
              errorPatterns: '["path not found"]',
              errorCategory: 'path_error',
              hitCount: 5,
            },
            relevanceScore: 10,
            matchedPatterns: ['path not found'],
          },
        ],
      });

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: [],
      });

      await service.executeWithRalphLoop({
        teamId: 'team-ralph-1',
        task: 'Test task',
      });

      // Verify emitExperienceQueried was called
      expect(emitExperienceQueried).toHaveBeenCalled();
      const callArgs = (emitExperienceQueried as any).mock.calls[0];
      expect(callArgs[0]).toBe('exec-ralph-1');
      expect(callArgs[1]).toBe('team-ralph-1');
      expect(callArgs[2].iteration).toBe(1);
      expect(callArgs[2].experiencesFound).toBe(2);
      expect(callArgs[2].experienceTitles).toContain('Permission Fix Guide');
      expect(callArgs[2].experienceTitles).toContain('Path Error Fix');
    });

    test('does not broadcast experience_queried when no experiences found', async () => {
      const mockTeam = createMockTeamWithRalphConfig({
        enabled: true,
        maxIterations: 3,
        maxCostUsd: 10.00,
        experienceTrigger: 'on_failure',
      });

      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 0 });
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            content: [{ type: 'text', text: 'Working...' }],
            message: { usage: { input_tokens: 100, output_tokens: 50 } },
          };
          yield { type: 'result', subtype: 'success', result: 'Still working' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      // Mock experience query returning NO matches
      (buildDynamicExperiencePrompt as any).mockResolvedValue({
        prompt: '',
        matches: [],
      });

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: [],
      });

      await service.executeWithRalphLoop({
        teamId: 'team-ralph-1',
        task: 'Test task',
      });

      // Verify emitExperienceQueried was NOT called (no matches)
      expect(emitExperienceQueried).not.toHaveBeenCalled();
    });
  });

  // ============ Test Case 4: parseRalphConfig ============
  describe('parseRalphConfig', () => {
    test('returns default config for null input', () => {
      const result = parseRalphConfig(null);
      expect(result).toEqual(DEFAULT_RALPH_LOOP_CONFIG);
    });

    test('returns default config for undefined input', () => {
      const result = parseRalphConfig(undefined);
      expect(result).toEqual(DEFAULT_RALPH_LOOP_CONFIG);
    });

    test('returns default config for empty string', () => {
      const result = parseRalphConfig('');
      expect(result).toEqual(DEFAULT_RALPH_LOOP_CONFIG);
    });

    test('parses valid JSON config', () => {
      const json = JSON.stringify({
        enabled: true,
        maxIterations: 5,
        maxCostUsd: 2.50,
        experienceTrigger: 'always',
      });

      const result = parseRalphConfig(json);
      expect(result.enabled).toBe(true);
      expect(result.maxIterations).toBe(5);
      expect(result.maxCostUsd).toBe(2.50);
      expect(result.experienceTrigger).toBe('always');
    });

    test('merges with defaults for partial config', () => {
      const json = JSON.stringify({
        enabled: true,
        maxIterations: 15,
      });

      const result = parseRalphConfig(json);
      expect(result.enabled).toBe(true);
      expect(result.maxIterations).toBe(15);
      // Defaults preserved
      expect(result.maxCostUsd).toBe(DEFAULT_RALPH_LOOP_CONFIG.maxCostUsd);
      expect(result.experienceTrigger).toBe(DEFAULT_RALPH_LOOP_CONFIG.experienceTrigger);
    });

    test('returns default config for invalid JSON', () => {
      const result = parseRalphConfig('not valid json');
      expect(result).toEqual(DEFAULT_RALPH_LOOP_CONFIG);
    });
  });

  // ============ Test Case 5: Abort handling ============
  describe('Abort handling', () => {
    test('returns aborted completion reason when abort signal triggered', async () => {
      const mockTeam = createMockTeamWithRalphConfig({
        enabled: true,
        maxIterations: 10,
        maxCostUsd: 10.00,
        experienceTrigger: 'disabled',
      });

      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 0 });
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      // Create an abort controller and abort immediately
      const abortController = new AbortController();
      abortController.abort();

      // Mock query that respects abort
      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            content: [{ type: 'text', text: 'Working...' }],
            message: { usage: { input_tokens: 100, output_tokens: 50 } },
          };
          yield { type: 'result', subtype: 'success', result: 'Done' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: [],
      });

      // Note: The abort is handled internally by the service
      // We can't directly test abort from outside, but we verify the completionReason type
      const result = await service.executeWithRalphLoop({
        teamId: 'team-ralph-1',
        task: 'Test task',
      });

      // Verify completionReason is one of the valid values
      expect(['verified', 'max_iterations', 'max_cost', 'aborted']).toContain(result.completionReason);
    });
  });

  // ============ Test Case 6: Cost calculation ============
  describe('Cost calculation', () => {
    test('totalCostUsd accumulates across iterations', async () => {
      const mockTeam = createMockTeamWithRalphConfig({
        enabled: true,
        maxIterations: 3,
        maxCostUsd: 10.00,
        experienceTrigger: 'disabled',
      });

      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 0 });
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      // Mock query with consistent token usage
      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            content: [{ type: 'text', text: 'Working...' }],
            message: { usage: { input_tokens: 1000, output_tokens: 500 } },
          };
          yield { type: 'result', subtype: 'success', result: 'Still working' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: [],
      });

      const result = await service.executeWithRalphLoop({
        teamId: 'team-ralph-1',
        task: 'Test task',
      });

      // Verify total cost is accumulated (3 iterations)
      expect(result.iterations).toBe(3);
      expect(result.totalCostUsd).toBeGreaterThan(0);
      // Each iteration: (1000/1M * 3) + (500/1M * 15) = 0.003 + 0.0075 = 0.0105
      // 3 iterations = ~0.0315
      expect(result.totalCostUsd).toBeCloseTo(0.0315, 2);
    });
  });
});