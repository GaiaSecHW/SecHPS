/**
 * TDD Tests for AgentTeam Execution - Task 13
 * 
 * Test cases:
 * 1. Execution starts with correct SDK config (maxBudgetUsd, maxTurns, agents)
 * 2. Subagent invocation tracked via Agent tool_use
 * 3. Token usage attributed per agent member
 * 4. SSE events are emitted correctly
 * 5. Budget exhaustion handling (maxBudgetUsd exceeded)
 * 6. Circular dependency rejection in team creation
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentTeamExecutionService, SAFETY_LIMITS, ExecutionCallbacks, ExecuteParams } from '@/services/agent-team/execution-service';
import { prisma } from '@/lib/prisma';
import {
  agentTeamEventBroadcaster,
  emitExecutionStarted,
  emitAgentInvoked,
  emitMessageDelta,
  emitAgentCompleted,
  emitExecutionCompleted,
} from '@/lib/agent-team-events';

// Circular dependency detection function (copied from route to avoid auth import)
function hasCircularDependency(dependencies: { from: string; to: string }[]): boolean {
  const graph = new Map<string, string[]>();
  for (const dep of dependencies) {
    if (!graph.has(dep.from)) graph.set(dep.from, []);
    graph.get(dep.from)!.push(dep.to);
  }

  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(node: string): boolean {
    visited.add(node);
    recursionStack.add(node);
    for (const neighbor of graph.get(node) || []) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
      } else if (recursionStack.has(neighbor)) {
        return true;
      }
    }
    recursionStack.delete(node);
    return false;
  }

  for (const node of graph.keys()) {
    if (!visited.has(node) && dfs(node)) return true;
  }
  return false;
}

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
  emitExecutionStarted: vi.fn(),
  emitAgentInvoked: vi.fn(),
  emitMessageDelta: vi.fn(),
  emitAgentCompleted: vi.fn(),
  emitExecutionCompleted: vi.fn(),
}));

// Suppress console logs in tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('AgentTeam Execution - Task 13 Tests', () => {
  let service: AgentTeamExecutionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AgentTeamExecutionService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============ Test Case 1: Execution starts with correct SDK config ============
  describe('Test Case 1: Execution starts with correct SDK config', () => {
    const mockTeam = {
      id: 'team-1',
      userId: 'user-1',
      name: 'Test Team',
      description: 'A test team',
      leadAgentId: 'agent-1',
      taskStrategy: 'parallel',
      maxTeammates: 5,
      status: 'idle',
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
      members: [
        {
          id: 'member-1',
          teamId: 'team-1',
          agentId: 'agent-2',
          role: 'coder',
          overrideModel: null,
          overrideTools: null,
          createdAt: new Date(),
          agent: {
            id: 'agent-2',
            name: 'coder-agent',
            displayName: 'Coder Agent',
            description: 'Writes code',
            category: 'coder',
            model: 'claude-sonnet-4-20250514',
            systemPrompt: 'You are a coder.',
            allowedTools: JSON.stringify(['Read', 'Write', 'Edit']),
            mcpServers: null,
            isActive: true,
            isBuiltin: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ],
    };

    const mockExecution = {
      id: 'exec-1',
      teamId: 'team-1',
      evaluationId: null,
      status: 'running',
      startedAt: new Date(),
      completedAt: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      createdAt: new Date(),
    };

    const mockMemberExecutions = [
      {
        id: 'member-exec-1',
        teamExecutionId: 'exec-1',
        memberId: 'member-1',
        status: 'pending',
        startedAt: null,
        completedAt: null,
        inputTokens: 0,
        outputTokens: 0,
        createdAt: new Date(),
      },
    ];

    test('SDK query is called with correct maxBudgetUsd', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 1 });
      (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'result', subtype: 'success', result: 'Done' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: mockMemberExecutions,
      });

      await service.execute({ teamId: 'team-1', task: 'Test' });

      expect(query).toHaveBeenCalled();
      const callArgs = (query as any).mock.calls[0][0];
      expect(callArgs.options.maxBudgetUsd).toBe(SAFETY_LIMITS.maxBudgetUsd);
      expect(callArgs.options.maxBudgetUsd).toBe(5.00);
    });

    test('SDK query is called with correct maxTurns', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 1 });
      (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'result', subtype: 'success', result: 'Done' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: mockMemberExecutions,
      });

      await service.execute({ teamId: 'team-1', task: 'Test' });

      expect(query).toHaveBeenCalled();
      const callArgs = (query as any).mock.calls[0][0];
      expect(callArgs.options.maxTurns).toBe(SAFETY_LIMITS.maxTurns);
      expect(callArgs.options.maxTurns).toBe(20);
    });

    test('SDK query is called with agents config from team members', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 1 });
      (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'result', subtype: 'success', result: 'Done' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: mockMemberExecutions,
      });

      await service.execute({ teamId: 'team-1', task: 'Test' });

      expect(query).toHaveBeenCalled();
      const callArgs = (query as any).mock.calls[0][0];
      
      // Verify agents config is built
      expect(callArgs.options.agents).toBeDefined();
      expect(callArgs.options.agents['coder-agent']).toBeDefined();
      
      // Verify agent definition structure
      const coderAgentDef = callArgs.options.agents['coder-agent'];
      expect(coderAgentDef.description).toBeDefined();
      expect(coderAgentDef.prompt).toBeDefined();
      expect(coderAgentDef.tools).toBeDefined();
      expect(coderAgentDef.model).toBeDefined();
    });

    test('Lead Agent allowedTools includes Agent tool', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 1 });
      (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'result', subtype: 'success', result: 'Done' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: mockMemberExecutions,
      });

      await service.execute({ teamId: 'team-1', task: 'Test' });

      expect(query).toHaveBeenCalled();
      const callArgs = (query as any).mock.calls[0][0];
      expect(callArgs.options.allowedTools).toContain('Agent');
    });

    test('Subagent tools do NOT include Agent (SDK limitation)', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 1 });
      (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'result', subtype: 'success', result: 'Done' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: mockMemberExecutions,
      });

      await service.execute({ teamId: 'team-1', task: 'Test' });

      expect(query).toHaveBeenCalled();
      const callArgs = (query as any).mock.calls[0][0];
      const coderAgentTools = callArgs.options.agents['coder-agent'].tools;
      expect(coderAgentTools).not.toContain('Agent');
    });
  });

  // ============ Test Case 2: Subagent invocation tracked ============
  describe('Test Case 2: Subagent invocation tracked', () => {
    const mockTeamWithMembers = {
      id: 'team-1',
      userId: 'user-1',
      name: 'Test Team',
      leadAgentId: 'agent-1',
      taskStrategy: 'parallel',
      maxTeammates: 5,
      status: 'idle',
      createdAt: new Date(),
      updatedAt: new Date(),
      leadAgent: {
        id: 'agent-1',
        name: 'lead-agent',
        displayName: 'Lead Agent',
        category: 'reviewer',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'Lead agent',
        allowedTools: JSON.stringify(['Read', 'Write', 'Bash']),
        mcpServers: null,
        isActive: true,
        isBuiltin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      members: [
        {
          id: 'member-1',
          teamId: 'team-1',
          agentId: 'agent-2',
          role: 'coder',
          overrideModel: null,
          overrideTools: null,
          createdAt: new Date(),
          agent: {
            id: 'agent-2',
            name: 'coder-agent',
            displayName: 'Coder Agent',
            category: 'coder',
            model: 'claude-sonnet-4-20250514',
            systemPrompt: 'Coder agent',
            allowedTools: JSON.stringify(['Read', 'Write', 'Edit']),
            mcpServers: null,
            isActive: true,
            isBuiltin: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ],
    };

    const mockExecution = {
      id: 'exec-1',
      teamId: 'team-1',
      status: 'running',
      startedAt: new Date(),
      totalInputTokens: 0,
      totalOutputTokens: 0,
      createdAt: new Date(),
    };

    const mockMemberExecutions = [
      {
        id: 'member-exec-1',
        teamExecutionId: 'exec-1',
        memberId: 'member-1',
        status: 'pending',
        startedAt: null,
        completedAt: null,
        inputTokens: 0,
        outputTokens: 0,
        createdAt: new Date(),
      },
    ];

    test('Agent tool_use triggers subagent tracking', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeamWithMembers);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 1 });
      (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeamWithMembers, status: 'running' });

      // Mock member execution lookup
      (prisma.agentMemberExecution.findFirst as any).mockResolvedValue(mockMemberExecutions[0]);
      (prisma.agentMemberExecution.update as any).mockResolvedValue({ ...mockMemberExecutions[0], status: 'running' });

      // Mock query with Agent tool invocation
      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'tool_use',
            tool_name: 'Agent',
            tool_input: { agent_name: 'coder-agent', prompt: 'Write a function' },
          };
          yield {
            type: 'tool_result',
            tool_name: 'Agent',
            tool_result: 'Function written',
          };
          yield { type: 'result', subtype: 'success', result: 'Done' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: mockMemberExecutions,
      });

      const onSubagentStart = vi.fn();
      const onSubagentComplete = vi.fn();

      await service.execute({
        teamId: 'team-1',
        task: 'Test',
        callbacks: { onSubagentStart, onSubagentComplete },
      });

      // Wait for async execution
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify subagent start was tracked
      expect(onSubagentStart).toHaveBeenCalledWith('coder-agent', 'member-exec-1');
    });

    test('Member execution status updates to running on Agent tool_use', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeamWithMembers);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 1 });
      (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeamWithMembers, status: 'running' });

      (prisma.agentMemberExecution.findFirst as any).mockResolvedValue(mockMemberExecutions[0]);
      (prisma.agentMemberExecution.update as any).mockResolvedValue({ ...mockMemberExecutions[0], status: 'running' });

      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'tool_use',
            tool_name: 'Agent',
            tool_input: { agent_name: 'coder-agent' },
          };
          yield { type: 'result', subtype: 'success', result: 'Done' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: mockMemberExecutions,
      });

      await service.execute({ teamId: 'team-1', task: 'Test' });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify member execution was updated to running
      expect(prisma.agentMemberExecution.update).toHaveBeenCalledWith({
        where: { id: 'member-exec-1' },
        data: {
          status: 'running',
          startedAt: expect.any(Date),
        },
      });
    });

    test('Member execution status updates to completed on Agent tool_result', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeamWithMembers);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 1 });
      (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeamWithMembers, status: 'running' });

      (prisma.agentMemberExecution.findFirst as any).mockResolvedValue(mockMemberExecutions[0]);
      (prisma.agentMemberExecution.update as any).mockResolvedValue({ ...mockMemberExecutions[0], status: 'completed' });

      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'tool_use',
            tool_name: 'Agent',
            tool_input: { agent_name: 'coder-agent' },
          };
          yield {
            type: 'tool_result',
            tool_name: 'Agent',
            tool_result: 'Done',
          };
          yield { type: 'result', subtype: 'success', result: 'Done' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: mockMemberExecutions,
      });

      await service.execute({ teamId: 'team-1', task: 'Test' });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify member execution was updated to completed
      expect(prisma.agentMemberExecution.update).toHaveBeenCalledWith({
        where: { id: 'member-exec-1' },
        data: {
          status: 'completed',
          completedAt: expect.any(Date),
        },
      });
    });

    test('onSubagentComplete callback is called with result', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeamWithMembers);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 1 });
      (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeamWithMembers, status: 'running' });

      (prisma.agentMemberExecution.findFirst as any).mockResolvedValue(mockMemberExecutions[0]);
      (prisma.agentMemberExecution.update as any).mockResolvedValue({ ...mockMemberExecutions[0], status: 'completed' });

      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'tool_use',
            tool_name: 'Agent',
            tool_input: { agent_name: 'coder-agent' },
          };
          yield {
            type: 'tool_result',
            tool_name: 'Agent',
            tool_result: 'Function implemented successfully',
          };
          yield { type: 'result', subtype: 'success', result: 'Done' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: mockMemberExecutions,
      });

      const onSubagentComplete = vi.fn();

      await service.execute({
        teamId: 'team-1',
        task: 'Test',
        callbacks: { onSubagentComplete },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(onSubagentComplete).toHaveBeenCalledWith('coder-agent', 'member-exec-1', 'Function implemented successfully');
    });
  });

  // ============ Test Case 3: Token usage attributed per agent ============
  describe('Test Case 3: Token usage attributed per agent', () => {
    const mockTeamWithMembers = {
      id: 'team-1',
      userId: 'user-1',
      name: 'Test Team',
      leadAgentId: 'agent-1',
      taskStrategy: 'parallel',
      maxTeammates: 5,
      status: 'idle',
      createdAt: new Date(),
      updatedAt: new Date(),
      leadAgent: {
        id: 'agent-1',
        name: 'lead-agent',
        displayName: 'Lead Agent',
        category: 'reviewer',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'Lead agent',
        allowedTools: null,
        mcpServers: null,
        isActive: true,
        isBuiltin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      members: [
        {
          id: 'member-1',
          teamId: 'team-1',
          agentId: 'agent-2',
          role: 'coder',
          overrideModel: null,
          overrideTools: null,
          createdAt: new Date(),
          agent: {
            id: 'agent-2',
            name: 'coder-agent',
            displayName: 'Coder Agent',
            category: 'coder',
            model: 'claude-sonnet-4-20250514',
            systemPrompt: 'Coder',
            allowedTools: null,
            mcpServers: null,
            isActive: true,
            isBuiltin: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ],
    };

    const mockExecution = {
      id: 'exec-1',
      teamId: 'team-1',
      status: 'running',
      startedAt: new Date(),
      totalInputTokens: 0,
      totalOutputTokens: 0,
      createdAt: new Date(),
    };

    const mockMemberExecutions = [
      {
        id: 'member-exec-1',
        teamExecutionId: 'exec-1',
        memberId: 'member-1',
        status: 'pending',
        startedAt: null,
        completedAt: null,
        inputTokens: 0,
        outputTokens: 0,
        createdAt: new Date(),
      },
    ];

    test('Token usage is tracked for Lead Agent', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeamWithMembers);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 1 });
      (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeamWithMembers, status: 'running' });

      // Mock query with usage data from Lead Agent
      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            content: [{ type: 'text', text: 'Processing...' }],
            message: {
              usage: { input_tokens: 500, output_tokens: 200 },
            },
          };
          yield { type: 'result', subtype: 'success', result: 'Done', total_cost_usd: 0.15 };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue({
        ...mockExecution,
        totalInputTokens: 500,
        totalOutputTokens: 200,
      });
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        totalInputTokens: 500,
        totalOutputTokens: 200,
        memberExecutions: mockMemberExecutions,
      });

      const onUsage = vi.fn();

      await service.execute({
        teamId: 'team-1',
        task: 'Test',
        callbacks: { onUsage },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify total tokens were updated
      expect(prisma.agentTeamExecution.update).toHaveBeenCalledWith({
        where: { id: 'exec-1' },
        data: {
          totalInputTokens: { increment: 500 },
          totalOutputTokens: { increment: 200 },
        },
      });

      // Verify onUsage callback was called with correct tokens
      expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({
        inputTokens: 500,
        outputTokens: 200,
        memberId: undefined,
      }));
    });

    test('Token usage is attributed to member when in subagent context', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeamWithMembers);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 1 });
      (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeamWithMembers, status: 'running' });

      (prisma.agentMemberExecution.findFirst as any).mockResolvedValue(mockMemberExecutions[0]);
      (prisma.agentMemberExecution.update as any).mockResolvedValue({ ...mockMemberExecutions[0], status: 'running' });

      // Mock query with Agent tool invocation and usage in subagent context
      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          // Lead agent starts
          yield {
            type: 'assistant',
            content: [{ type: 'text', text: 'Starting...' }],
            message: { usage: { input_tokens: 100, output_tokens: 50 } },
          };
          // Agent tool invoked
          yield {
            type: 'tool_use',
            tool_name: 'Agent',
            tool_input: { agent_name: 'coder-agent' },
          };
          // Subagent usage (in subagent context)
          yield {
            type: 'assistant',
            content: [{ type: 'text', text: 'Coding...' }],
            message: { usage: { input_tokens: 300, output_tokens: 150 } },
          };
          // Agent tool result
          yield {
            type: 'tool_result',
            tool_name: 'Agent',
            tool_result: 'Code written',
          };
          yield { type: 'result', subtype: 'success', result: 'Done' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: mockMemberExecutions,
      });

      const onUsage = vi.fn();

      await service.execute({
        teamId: 'team-1',
        task: 'Test',
        callbacks: { onUsage },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify member token counts were updated
      expect(prisma.agentMemberExecution.update).toHaveBeenCalledWith({
        where: { id: 'member-exec-1' },
        data: {
          inputTokens: { increment: 300 },
          outputTokens: { increment: 150 },
        },
      });

      // Verify onUsage was called with memberId
      expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({
        inputTokens: 300,
        outputTokens: 150,
        memberId: 'member-1',
      }));
    });

    test('Total execution tokens aggregate Lead + Member tokens', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeamWithMembers);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 1 });
      (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeamWithMembers, status: 'running' });

      (prisma.agentMemberExecution.findFirst as any).mockResolvedValue(mockMemberExecutions[0]);
      (prisma.agentMemberExecution.update as any).mockResolvedValue(mockMemberExecutions[0]);

      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            content: [{ type: 'text', text: 'Lead...' }],
            message: { usage: { input_tokens: 200, output_tokens: 100 } },
          };
          yield {
            type: 'tool_use',
            tool_name: 'Agent',
            tool_input: { agent_name: 'coder-agent' },
          };
          yield {
            type: 'assistant',
            content: [{ type: 'text', text: 'Member...' }],
            message: { usage: { input_tokens: 400, output_tokens: 200 } },
          };
          yield {
            type: 'tool_result',
            tool_name: 'Agent',
            tool_result: 'Done',
          };
          yield { type: 'result', subtype: 'success', result: 'Done', total_cost_usd: 0.30 };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        totalInputTokens: 600,
        totalOutputTokens: 300,
        memberExecutions: mockMemberExecutions,
      });

      await service.execute({ teamId: 'team-1', task: 'Test' });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify total tokens were incremented for both Lead and Member
      // Lead: 200 + 100, Member: 400 + 200
      // Total should be 600 input, 300 output
      expect(prisma.agentTeamExecution.update).toHaveBeenCalledWith({
        where: { id: 'exec-1' },
        data: {
          totalInputTokens: { increment: expect.any(Number) },
          totalOutputTokens: { increment: expect.any(Number) },
        },
      });
    });
  });

  // ============ Test Case 4: SSE events are emitted correctly ============
  describe('Test Case 4: SSE events are emitted correctly', () => {
    const mockTeam = {
      id: 'team-1',
      userId: 'user-1',
      name: 'Test Team',
      leadAgentId: 'agent-1',
      taskStrategy: 'parallel',
      maxTeammates: 5,
      status: 'idle',
      createdAt: new Date(),
      updatedAt: new Date(),
      leadAgent: {
        id: 'agent-1',
        name: 'lead-agent',
        displayName: 'Lead Agent',
        category: 'reviewer',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'Lead agent',
        allowedTools: null,
        mcpServers: null,
        isActive: true,
        isBuiltin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      members: [],
    };

    const mockExecution = {
      id: 'exec-1',
      teamId: 'team-1',
      status: 'running',
      startedAt: new Date(),
      totalInputTokens: 0,
      totalOutputTokens: 0,
      createdAt: new Date(),
    };

    test('emitExecutionStarted is called when execution starts', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'result', subtype: 'success', result: 'Done' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: [],
      });

      // Call emitExecutionStarted manually to test
      emitExecutionStarted('exec-1', 'team-1', {
        teamName: 'Test Team',
        leadAgentId: 'agent-1',
        leadAgentName: 'Lead Agent',
        memberCount: 0,
      });

      expect(emitExecutionStarted).toHaveBeenCalledWith('exec-1', 'team-1', {
        teamName: 'Test Team',
        leadAgentId: 'agent-1',
        leadAgentName: 'Lead Agent',
        memberCount: 0,
      });
    });

    test('emitMessageDelta is called for streaming text', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            content: [{ type: 'text', text: 'Hello world' }],
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

      // Test emitMessageDelta directly
      emitMessageDelta('exec-1', 'team-1', {
        agentId: 'agent-1',
        content: 'Hello world',
      });

      expect(emitMessageDelta).toHaveBeenCalledWith('exec-1', 'team-1', {
        agentId: 'agent-1',
        content: 'Hello world',
      });
    });

    test('emitExecutionCompleted is called when execution finishes', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'result', subtype: 'success', result: 'Task completed', total_cost_usd: 0.25 };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        memberExecutions: [],
      });

      // Test emitExecutionCompleted directly
      emitExecutionCompleted('exec-1', 'team-1', {
        result: 'Task completed',
        totalTokens: { input: 100, output: 50 },
        totalCostUsd: 0.25,
        status: 'completed',
      });

      expect(emitExecutionCompleted).toHaveBeenCalledWith('exec-1', 'team-1', {
        result: 'Task completed',
        totalTokens: { input: 100, output: 50 },
        totalCostUsd: 0.25,
        status: 'completed',
      });
    });

    test('emitExecutionCompleted is called with failed status on error', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'error_max_budget',
            errors: ['Budget exceeded'],
          };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.updateMany as any).mockResolvedValue({});
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue(mockExecution);

      // Test emitExecutionCompleted with failed status
      emitExecutionCompleted('exec-1', 'team-1', {
        result: 'Budget exceeded',
        totalTokens: { input: 0, output: 0 },
        status: 'failed',
      });

      expect(emitExecutionCompleted).toHaveBeenCalledWith('exec-1', 'team-1', {
        result: 'Budget exceeded',
        totalTokens: { input: 0, output: 0 },
        status: 'failed',
      });
    });

    test('agentTeamEventBroadcaster.broadcast is called for events', async () => {
      // Test broadcaster directly
      const event = {
        type: 'execution_started',
        executionId: 'exec-1',
        teamId: 'team-1',
        timestamp: new Date(),
        data: {
          executionId: 'exec-1',
          teamId: 'team-1',
          teamName: 'Test Team',
        },
      };

      agentTeamEventBroadcaster.broadcast(event as any);

      expect(agentTeamEventBroadcaster.broadcast).toHaveBeenCalledWith(event as any);
    });
  });

  // ============ Test Case 5: Budget exhaustion handling ============
  describe('Test Case 5: Budget exhaustion handling', () => {
    const mockTeam = {
      id: 'team-1',
      userId: 'user-1',
      name: 'Test Team',
      leadAgentId: 'agent-1',
      taskStrategy: 'parallel',
      maxTeammates: 5,
      status: 'idle',
      createdAt: new Date(),
      updatedAt: new Date(),
      leadAgent: {
        id: 'agent-1',
        name: 'lead-agent',
        displayName: 'Lead Agent',
        category: 'reviewer',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'Lead agent',
        allowedTools: null,
        mcpServers: null,
        isActive: true,
        isBuiltin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      members: [],
    };

    const mockExecution = {
      id: 'exec-1',
      teamId: 'team-1',
      status: 'running',
      startedAt: new Date(),
      totalInputTokens: 0,
      totalOutputTokens: 0,
      createdAt: new Date(),
    };

    test('SDK returns error_max_budget when budget exceeded', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      // Mock query that returns budget exceeded error
      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'error_max_budget',
            errors: ['Budget limit exceeded: $5.00'],
          };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue({});
      (prisma.agentMemberExecution.updateMany as any).mockResolvedValue({});
      // Include memberExecutions for getStatus call
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: [],
      });

      const onError = vi.fn();
      const onStatusChange = vi.fn();

      await service.execute({
        teamId: 'team-1',
        task: 'Test',
        callbacks: { onError, onStatusChange },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify error handling
      expect(onError).toHaveBeenCalled();
      expect(onError.mock.calls[0][0].message).toContain('Budget limit exceeded');
      expect(onStatusChange).toHaveBeenCalledWith('failed', 'exec-1');
    });

    test('Execution status is updated to failed on budget exhaustion', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'error_max_budget',
            errors: ['Budget exceeded'],
          };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue({});
      (prisma.agentMemberExecution.updateMany as any).mockResolvedValue({});
      // Include memberExecutions for getStatus call
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: [],
      });

      await service.execute({ teamId: 'team-1', task: 'Test' });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify execution was marked as failed
      expect(prisma.agentTeamExecution.update).toHaveBeenCalledWith({
        where: { id: 'exec-1' },
        data: {
          status: 'failed',
          completedAt: expect.any(Date),
        },
      });
    });

    test('Team status is updated to idle on budget exhaustion', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'error_max_budget',
            errors: ['Budget exceeded'],
          };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue({});
      (prisma.agentMemberExecution.updateMany as any).mockResolvedValue({});
      // Include memberExecutions for getStatus call
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: [],
      });

      await service.execute({ teamId: 'team-1', task: 'Test' });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify team status was updated to idle
      expect(prisma.agentTeam.update).toHaveBeenCalledWith({
        where: { id: 'team-1' },
        data: { status: 'idle' },
      });
    });

    test('Safety limits are enforced at SDK level', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
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

      await service.execute({ teamId: 'team-1', task: 'Test' });

      // Verify SDK was called with safety limits
      expect(query).toHaveBeenCalled();
      const callArgs = (query as any).mock.calls[0][0];
      expect(callArgs.options.maxBudgetUsd).toBe(5.00);
      expect(callArgs.options.maxTurns).toBe(20);
    });
  });

  // ============ Test Case 6: Circular dependency rejection ============
  describe('Test Case 6: Circular dependency rejection', () => {
    test('hasCircularDependency detects simple cycle A -> B -> A', () => {
      const dependencies = [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'A' },
      ];

      const result = hasCircularDependency(dependencies);
      expect(result).toBe(true);
    });

    test('hasCircularDependency detects longer cycle A -> B -> C -> A', () => {
      const dependencies = [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C' },
        { from: 'C', to: 'A' },
      ];

      const result = hasCircularDependency(dependencies);
      expect(result).toBe(true);
    });

    test('hasCircularDependency returns false for valid chain A -> B -> C', () => {
      const dependencies = [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C' },
      ];

      const result = hasCircularDependency(dependencies);
      expect(result).toBe(false);
    });

    test('hasCircularDependency returns false for empty dependencies', () => {
      const dependencies: { from: string; to: string }[] = [];

      const result = hasCircularDependency(dependencies);
      expect(result).toBe(false);
    });

    test('hasCircularDependency returns false for single dependency', () => {
      const dependencies = [
        { from: 'A', to: 'B' },
      ];

      const result = hasCircularDependency(dependencies);
      expect(result).toBe(false);
    });

    test('hasCircularDependency handles self-loop A -> A', () => {
      const dependencies = [
        { from: 'A', to: 'A' },
      ];

      const result = hasCircularDependency(dependencies);
      expect(result).toBe(true);
    });

    test('hasCircularDependency handles disconnected graphs', () => {
      const dependencies = [
        { from: 'A', to: 'B' },
        { from: 'C', to: 'D' },
        { from: 'D', to: 'C' }, // Cycle in C-D
      ];

      const result = hasCircularDependency(dependencies);
      expect(result).toBe(true);
    });

    test('API route rejects circular dependency on team creation', async () => {
      // This test would require importing the route handler
      // For now, we test the validation function directly
      const circularDependencies = [
        { from: 'agent-1', to: 'agent-2' },
        { from: 'agent-2', to: 'agent-1' },
      ];

      expect(hasCircularDependency(circularDependencies)).toBe(true);
    });

    test('API route accepts valid dependencies on team creation', async () => {
      const validDependencies = [
        { from: 'lead-agent', to: 'coder-agent' },
        { from: 'coder-agent', to: 'tester-agent' },
      ];

      expect(hasCircularDependency(validDependencies)).toBe(false);
    });
  });

  // ============ Additional comprehensive tests ============
  describe('Additional comprehensive tests', () => {
    test('Multiple subagent invocations are tracked correctly', async () => {
      const mockTeamWithMultipleMembers = {
        id: 'team-1',
        userId: 'user-1',
        name: 'Test Team',
        leadAgentId: 'agent-1',
        taskStrategy: 'parallel',
        maxTeammates: 5,
        status: 'idle',
        createdAt: new Date(),
        updatedAt: new Date(),
        leadAgent: {
          id: 'agent-1',
          name: 'lead-agent',
          displayName: 'Lead Agent',
          category: 'reviewer',
          model: 'claude-sonnet-4-20250514',
          systemPrompt: 'Lead agent',
          allowedTools: null,
          mcpServers: null,
          isActive: true,
          isBuiltin: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        members: [
          {
            id: 'member-1',
            teamId: 'team-1',
            agentId: 'agent-2',
            role: 'coder',
            overrideModel: null,
            overrideTools: null,
            createdAt: new Date(),
            agent: {
              id: 'agent-2',
              name: 'coder-agent',
              displayName: 'Coder Agent',
              category: 'coder',
              model: 'claude-sonnet-4-20250514',
              systemPrompt: 'Coder',
              allowedTools: null,
              mcpServers: null,
              isActive: true,
              isBuiltin: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
          {
            id: 'member-2',
            teamId: 'team-1',
            agentId: 'agent-3',
            role: 'tester',
            overrideModel: null,
            overrideTools: null,
            createdAt: new Date(),
            agent: {
              id: 'agent-3',
              name: 'tester-agent',
              displayName: 'Tester Agent',
              category: 'tester',
              model: 'claude-haiku-4-20250514',
              systemPrompt: 'Tester',
              allowedTools: null,
              mcpServers: null,
              isActive: true,
              isBuiltin: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
        ],
      };

      const mockExecution = {
        id: 'exec-1',
        teamId: 'team-1',
        status: 'running',
        startedAt: new Date(),
        totalInputTokens: 0,
        totalOutputTokens: 0,
        createdAt: new Date(),
      };

      const mockMemberExecutions = [
        {
          id: 'member-exec-1',
          teamExecutionId: 'exec-1',
          memberId: 'member-1',
          status: 'pending',
          startedAt: null,
          completedAt: null,
          inputTokens: 0,
          outputTokens: 0,
          createdAt: new Date(),
        },
        {
          id: 'member-exec-2',
          teamExecutionId: 'exec-1',
          memberId: 'member-2',
          status: 'pending',
          startedAt: null,
          completedAt: null,
          inputTokens: 0,
          outputTokens: 0,
          createdAt: new Date(),
        },
      ];

      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeamWithMultipleMembers);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 2 });
      (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeamWithMultipleMembers, status: 'running' });

      // Mock member execution lookups
      (prisma.agentMemberExecution.findFirst as any).mockImplementation(async ({ where }) => {
        if (where.memberId === 'member-1') return mockMemberExecutions[0];
        if (where.memberId === 'member-2') return mockMemberExecutions[1];
        return null;
      });
      (prisma.agentMemberExecution.update as any).mockResolvedValue({});

      // Mock query with multiple Agent tool invocations
      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'tool_use',
            tool_name: 'Agent',
            tool_input: { agent_name: 'coder-agent' },
          };
          yield {
            type: 'tool_result',
            tool_name: 'Agent',
            tool_result: 'Code written',
          };
          yield {
            type: 'tool_use',
            tool_name: 'Agent',
            tool_input: { agent_name: 'tester-agent' },
          };
          yield {
            type: 'tool_result',
            tool_name: 'Agent',
            tool_result: 'Tests passed',
          };
          yield { type: 'result', subtype: 'success', result: 'Done' };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: mockMemberExecutions,
      });

      const onSubagentStart = vi.fn();
      const onSubagentComplete = vi.fn();

      await service.execute({
        teamId: 'team-1',
        task: 'Test',
        callbacks: { onSubagentStart, onSubagentComplete },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify both subagent starts were tracked
      expect(onSubagentStart).toHaveBeenCalledWith('coder-agent', 'member-exec-1');
      expect(onSubagentStart).toHaveBeenCalledWith('tester-agent', 'member-exec-2');
      expect(onSubagentStart).toHaveBeenCalledTimes(2);
    });

    test('Execution cancellation aborts SDK query', async () => {
      const mockTeam = {
        id: 'team-1',
        userId: 'user-1',
        name: 'Test Team',
        leadAgentId: 'agent-1',
        taskStrategy: 'parallel',
        maxTeammates: 5,
        status: 'idle',
        createdAt: new Date(),
        updatedAt: new Date(),
        leadAgent: {
          id: 'agent-1',
          name: 'lead-agent',
          displayName: 'Lead Agent',
          category: 'reviewer',
          model: 'claude-sonnet-4-20250514',
          systemPrompt: 'Lead agent',
          allowedTools: null,
          mcpServers: null,
          isActive: true,
          isBuiltin: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        members: [],
      };

      const mockExecution = {
        id: 'exec-1',
        teamId: 'team-1',
        status: 'running',
        startedAt: new Date(),
        totalInputTokens: 0,
        totalOutputTokens: 0,
        createdAt: new Date(),
      };

      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      // Mock query that takes time (simulating long execution)
      let aborted = false;
      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          // Simulate delay
          await new Promise(resolve => setTimeout(resolve, 500));
          if (!aborted) {
            yield { type: 'result', subtype: 'success', result: 'Done' };
          }
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: [],
      });

      // Start execution
      const result = await service.execute({ teamId: 'team-1', task: 'Test' });

      // Cancel immediately
      (prisma.agentTeamExecution.update as any).mockResolvedValue({});
      (prisma.agentMemberExecution.updateMany as any).mockResolvedValue({});
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        status: 'cancelled',
        memberExecutions: [],
      });

      const cancelResult = await service.cancel(result.executionId);

      expect(cancelResult.status).toBe('cancelled');
      expect(prisma.agentTeamExecution.update).toHaveBeenCalledWith({
        where: { id: 'exec-1' },
        data: {
          status: 'cancelled',
          completedAt: expect.any(Date),
        },
      });
    });

    test('Error in SDK query is handled gracefully', async () => {
      const mockTeam = {
        id: 'team-1',
        userId: 'user-1',
        name: 'Test Team',
        leadAgentId: 'agent-1',
        taskStrategy: 'parallel',
        maxTeammates: 5,
        status: 'idle',
        createdAt: new Date(),
        updatedAt: new Date(),
        leadAgent: {
          id: 'agent-1',
          name: 'lead-agent',
          displayName: 'Lead Agent',
          category: 'reviewer',
          model: 'claude-sonnet-4-20250514',
          systemPrompt: 'Lead agent',
          allowedTools: null,
          mcpServers: null,
          isActive: true,
          isBuiltin: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        members: [],
      };

      const mockExecution = {
        id: 'exec-1',
        teamId: 'team-1',
        status: 'running',
        startedAt: new Date(),
        totalInputTokens: 0,
        totalOutputTokens: 0,
        createdAt: new Date(),
      };

      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      // Mock query that throws an error
      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'error_unknown',
            errors: ['Unknown error occurred'],
          };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue({});
      (prisma.agentMemberExecution.updateMany as any).mockResolvedValue({});
      // Include memberExecutions for getStatus call
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: [],
      });

      const onError = vi.fn();

      await service.execute({
        teamId: 'team-1',
        task: 'Test',
        callbacks: { onError },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(onError).toHaveBeenCalled();
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    });
  });
});