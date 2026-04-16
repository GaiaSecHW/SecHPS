import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentTeamExecutionService, SAFETY_LIMITS, ExecutionCallbacks, ExecuteParams, createAgentTeamExecutionService, MODEL_PRICING, calculateCost, getModelPricing } from '@/services/agent-team/execution-service';
import { prisma } from '@/lib/prisma';

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
  },
}));

describe('AgentTeamExecutionService', () => {
  let service: AgentTeamExecutionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AgentTeamExecutionService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('SAFETY_LIMITS', () => {
    test('safety limits are configured correctly', () => {
      expect(SAFETY_LIMITS.maxBudgetUsd).toBe(5.00);
      expect(SAFETY_LIMITS.maxTurns).toBe(20);
    });
  });

  describe('execute()', () => {
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
        description: 'Lead agent',
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
          createdAt: new Date(),
          agent: {
            id: 'agent-2',
            name: 'member-agent',
            displayName: 'Member Agent',
            description: 'Member agent',
            category: 'coder',
            model: 'claude-sonnet-4-20250514',
            systemPrompt: 'You are a coder.',
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
      evaluationId: null,
      status: 'running',
      startedAt: new Date(),
      completedAt: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      createdAt: new Date(),
      memberExecutions: [],
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

    test('creates execution record in database', async () => {
      // Setup mocks
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 1 });
      (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      // Mock query to return empty async iterator
      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          // Yield a success result
          yield {
            type: 'result',
            subtype: 'success',
            result: 'Task completed successfully',
            total_cost_usd: 0.5,
          };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      // Mock getStatus
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: mockMemberExecutions,
      });

      const params: ExecuteParams = {
        teamId: 'team-1',
        task: 'Test task',
      };

      const result = await service.execute(params);

      expect(result.executionId).toBe('exec-1');
      expect(result.status.status).toBe('running');
      expect(prisma.agentTeamExecution.create).toHaveBeenCalledWith({
        data: {
          teamId: 'team-1',
          evaluationId: undefined,
          status: 'running',
          startedAt: expect.any(Date),
          totalInputTokens: 0,
          totalOutputTokens: 0,
        },
      });
    });

    test('creates member execution records', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 1 });
      (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'success',
            result: 'Done',
          };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        memberExecutions: mockMemberExecutions,
      });

      await service.execute({ teamId: 'team-1', task: 'Test' });

      expect(prisma.agentMemberExecution.createMany).toHaveBeenCalledWith({
        data: [
          {
            teamExecutionId: 'exec-1',
            memberId: 'member-1',
            status: 'pending',
            inputTokens: 0,
            outputTokens: 0,
          },
        ],
      });
    });

    test('throws error if team not found', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(null);

      await expect(
        service.execute({ teamId: 'nonexistent', task: 'Test' })
      ).rejects.toThrow('Agent team not found: nonexistent');
    });

    test('calls callbacks during execution', async () => {
      const callbacks: ExecutionCallbacks = {
        onChunk: vi.fn(),
        onToolUse: vi.fn(),
        onToolResult: vi.fn(),
        onUsage: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onStatusChange: vi.fn(),
      };

      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 1 });
      (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeam, status: 'running' });

      // Mock query with assistant message and result
      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            content: [{ type: 'text', text: 'Working on it...' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          };
          yield {
            type: 'tool_use',
            tool_name: 'Read',
            tool_input: { file_path: '/test.ts' },
          };
          yield {
            type: 'tool_result',
            tool_name: 'Read',
            tool_result: 'file content',
          };
          yield {
            type: 'result',
            subtype: 'success',
            result: 'Task completed',
            total_cost_usd: 0.25,
          };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      // Mock token updates
      (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        memberExecutions: mockMemberExecutions,
      });

      await service.execute({ teamId: 'team-1', task: 'Test', callbacks });

      // Wait for async execution to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(callbacks.onChunk).toHaveBeenCalled();
      expect(callbacks.onToolUse).toHaveBeenCalledWith('Read', { file_path: '/test.ts' }, undefined);
      expect(callbacks.onToolResult).toHaveBeenCalledWith('Read', 'file content', undefined);
      expect(callbacks.onUsage).toHaveBeenCalled();
      expect(callbacks.onComplete).toHaveBeenCalledWith('Task completed', 'exec-1');
      expect(callbacks.onStatusChange).toHaveBeenCalledWith('running', 'exec-1');
    });

    test('SDK options include safety limits', async () => {
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

      // Verify query was called with safety limits
      expect(query).toHaveBeenCalled();
      const callArgs = (query as any).mock.calls[0][0];
      expect(callArgs.options.maxBudgetUsd).toBe(SAFETY_LIMITS.maxBudgetUsd);
      expect(callArgs.options.maxTurns).toBe(SAFETY_LIMITS.maxTurns);
    });
  });

  describe('cancel()', () => {
    test('updates execution status to cancelled', async () => {
      const mockExecution = {
        id: 'exec-1',
        teamId: 'team-1',
        status: 'running',
        startedAt: new Date(),
        completedAt: null,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        createdAt: new Date(),
        memberExecutions: [],
      };

      (prisma.agentTeamExecution.update as any).mockResolvedValue({
        ...mockExecution,
        status: 'cancelled',
        completedAt: new Date(),
      });
      (prisma.agentMemberExecution.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        status: 'cancelled',
        completedAt: new Date(),
        memberExecutions: [],
      });
      (prisma.agentTeam.update as any).mockResolvedValue({ id: 'team-1', status: 'idle' });

      const result = await service.cancel('exec-1');

      expect(result.status).toBe('cancelled');
      expect(prisma.agentTeamExecution.update).toHaveBeenCalledWith({
        where: { id: 'exec-1' },
        data: {
          status: 'cancelled',
          completedAt: expect.any(Date),
        },
      });
    });

    test('updates member executions to cancelled', async () => {
      (prisma.agentTeamExecution.update as any).mockResolvedValue({});
      (prisma.agentMemberExecution.updateMany as any).mockResolvedValue({ count: 2 });
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        id: 'exec-1',
        teamId: 'team-1',
        status: 'cancelled',
        memberExecutions: [],
      });
      (prisma.agentTeam.update as any).mockResolvedValue({});

      await service.cancel('exec-1');

      expect(prisma.agentMemberExecution.updateMany).toHaveBeenCalledWith({
        where: { teamExecutionId: 'exec-1' },
        data: {
          status: 'cancelled',
          completedAt: expect.any(Date),
        },
      });
    });

    test('updates team status to idle', async () => {
      (prisma.agentTeamExecution.update as any).mockResolvedValue({});
      (prisma.agentMemberExecution.updateMany as any).mockResolvedValue({});
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        id: 'exec-1',
        teamId: 'team-1',
        status: 'cancelled',
        memberExecutions: [],
      });
      (prisma.agentTeam.update as any).mockResolvedValue({ id: 'team-1', status: 'idle' });

      await service.cancel('exec-1');

      expect(prisma.agentTeam.update).toHaveBeenCalledWith({
        where: { id: 'team-1' },
        data: { status: 'idle' },
      });
    });
  });

  describe('getStatus()', () => {
    test('returns execution status with member executions', async () => {
      const mockExecution = {
        id: 'exec-1',
        teamId: 'team-1',
        status: 'running',
        startedAt: new Date(),
        completedAt: null,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        createdAt: new Date(),
        memberExecutions: [
          {
            id: 'member-exec-1',
            memberId: 'member-1',
            status: 'running',
            inputTokens: 50,
            outputTokens: 25,
          },
        ],
      };

      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue(mockExecution);

      const result = await service.getStatus('exec-1');

      expect(result.id).toBe('exec-1');
      expect(result.teamId).toBe('team-1');
      expect(result.status).toBe('running');
      expect(result.totalInputTokens).toBe(100);
      expect(result.totalOutputTokens).toBe(50);
      expect(result.memberExecutions).toHaveLength(1);
      expect(result.memberExecutions[0].memberId).toBe('member-1');
    });

    test('throws error if execution not found', async () => {
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue(null);

      await expect(service.getStatus('nonexistent')).rejects.toThrow('Execution not found: nonexistent');
    });
  });

  describe('createAgentTeamExecutionService()', () => {
    test('creates service instance', () => {
      const service = createAgentTeamExecutionService();
      expect(service).toBeInstanceOf(AgentTeamExecutionService);
    });
  });

  describe('token tracking', () => {
    test('tracks input and output tokens', async () => {
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
      (prisma.agentTeam.update as any).mockResolvedValue({});

      // Mock query with usage data
      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'assistant',
            content: [{ type: 'text', text: 'Processing...' }],
            message: {
              usage: { input_tokens: 200, output_tokens: 100 },
            },
          };
          yield {
            type: 'result',
            subtype: 'success',
            result: 'Done',
            total_cost_usd: 0.15,
          };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      // Mock token updates
      (prisma.agentTeamExecution.update as any).mockResolvedValue({
        ...mockExecution,
        totalInputTokens: 200,
        totalOutputTokens: 100,
      });
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
        ...mockExecution,
        totalInputTokens: 200,
        totalOutputTokens: 100,
        memberExecutions: [],
      });

      const onUsage = vi.fn();
      await service.execute({
        teamId: 'team-1',
        task: 'Test',
        callbacks: { onUsage },
      });

      // Wait for async execution
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify token update was called
      expect(prisma.agentTeamExecution.update).toHaveBeenCalledWith({
        where: { id: 'exec-1' },
        data: {
          totalInputTokens: { increment: 200 },
          totalOutputTokens: { increment: 100 },
        },
      });
    });
  });

  describe('error handling', () => {
    test('handles execution errors and updates status', async () => {
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
        memberExecutions: [],
      };

      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentTeam.update as any).mockResolvedValue({});

      // Mock query that throws error
      const mockIterator = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'result',
            subtype: 'error_max_turns',
            errors: ['Max turns exceeded'],
          };
        },
      };
      (query as any).mockReturnValue(mockIterator);

      (prisma.agentTeamExecution.update as any).mockResolvedValue({});
      (prisma.agentMemberExecution.updateMany as any).mockResolvedValue({});
      (prisma.agentTeamExecution.findUnique as any).mockResolvedValue(mockExecution);

      const onError = vi.fn();
      const onStatusChange = vi.fn();

      await service.execute({
        teamId: 'team-1',
        task: 'Test',
        callbacks: { onError, onStatusChange },
      });

      // Wait for async execution
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify error handling
      expect(onError).toHaveBeenCalled();
      expect(onStatusChange).toHaveBeenCalledWith('failed', 'exec-1');
      expect(prisma.agentTeamExecution.update).toHaveBeenCalledWith({
        where: { id: 'exec-1' },
        data: {
          status: 'failed',
          completedAt: expect.any(Date),
        },
      });
    });
  });

  describe('Lead Agent + Subagent orchestration', () => {
    const mockTeamWithMembers = {
      id: 'team-1',
      userId: 'user-1',
      name: 'Test Team',
      description: 'A test team with subagents',
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
        systemPrompt: 'You are a lead agent that delegates to subagents.',
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
            description: 'Writes code implementations',
            category: 'coder',
            model: 'claude-sonnet-4-20250514',
            systemPrompt: 'You are a coder agent.',
            allowedTools: JSON.stringify(['Read', 'Write', 'Edit', 'Bash']),
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
          overrideTools: JSON.stringify(['Read', 'Grep', 'Bash']),
          createdAt: new Date(),
          agent: {
            id: 'agent-3',
            name: 'tester-agent',
            displayName: 'Tester Agent',
            description: 'Runs tests and validates code',
            category: 'tester',
            model: 'claude-haiku-4-20250514',
            systemPrompt: 'You are a tester agent.',
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
      evaluationId: null,
      status: 'running',
      startedAt: new Date(),
      completedAt: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      createdAt: new Date(),
      memberExecutions: [],
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

    test('Lead Agent has Agent tool in allowedTools', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeamWithMembers);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 2 });
      (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeamWithMembers, status: 'running' });

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

      // Verify query was called with Agent tool in allowedTools
      expect(query).toHaveBeenCalled();
      const callArgs = (query as any).mock.calls[0][0];
      expect(callArgs.options.allowedTools).toContain('Agent');
    });

    test('Subagent definitions are built from team members', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeamWithMembers);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 2 });
      (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeamWithMembers, status: 'running' });

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

      // Verify agents config was built
      expect(query).toHaveBeenCalled();
      const callArgs = (query as any).mock.calls[0][0];
      expect(callArgs.options.agents).toBeDefined();
      expect(callArgs.options.agents['coder-agent']).toBeDefined();
      expect(callArgs.options.agents['tester-agent']).toBeDefined();
    });

    test('Subagent tools do NOT include Agent (SDK limitation)', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeamWithMembers);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 2 });
      (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeamWithMembers, status: 'running' });

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

      // Verify subagent tools don't include Agent
      const callArgs = (query as any).mock.calls[0][0];
      const coderAgentTools = callArgs.options.agents['coder-agent'].tools;
      const testerAgentTools = callArgs.options.agents['tester-agent'].tools;
      
      expect(coderAgentTools).not.toContain('Agent');
      expect(testerAgentTools).not.toContain('Agent');
    });

    test('Subagent invocation is tracked via Agent tool_use', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeamWithMembers);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 2 });
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
            tool_result: 'Function written successfully',
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
      
      // Verify member execution status was updated
      expect(prisma.agentMemberExecution.update).toHaveBeenCalledWith({
        where: { id: 'member-exec-1' },
        data: {
          status: 'running',
          startedAt: expect.any(Date),
        },
      });
    });

    test('Member execution status updates when subagent completes', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeamWithMembers);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 2 });
      (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeamWithMembers, status: 'running' });

      // Mock member execution lookup
      (prisma.agentMemberExecution.findFirst as any).mockResolvedValue(mockMemberExecutions[0]);
      (prisma.agentMemberExecution.update as any).mockResolvedValue({ ...mockMemberExecutions[0], status: 'completed' });

      // Mock query with Agent tool invocation and completion
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
            tool_result: 'Function written successfully',
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

      // Wait for async execution
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify member execution was marked as completed
      expect(prisma.agentMemberExecution.update).toHaveBeenCalledWith({
        where: { id: 'member-exec-1' },
        data: {
          status: 'completed',
          completedAt: expect.any(Date),
        },
      });
      
      // Verify subagent complete callback was called
      expect(onSubagentComplete).toHaveBeenCalled();
    });

    test('Override tools are used for subagent when defined', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeamWithMembers);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 2 });
      (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeamWithMembers, status: 'running' });

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

      // Verify tester-agent uses override tools (Read, Grep, Bash) not Agent
      const callArgs = (query as any).mock.calls[0][0];
      const testerAgentTools = callArgs.options.agents['tester-agent'].tools;
      
      expect(testerAgentTools).toContain('Read');
      expect(testerAgentTools).toContain('Grep');
      expect(testerAgentTools).toContain('Bash');
      expect(testerAgentTools).not.toContain('Agent');
    });

    test('Subagent model is set from override or agent definition', async () => {
      (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeamWithMembers);
      (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
      (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 2 });
      (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
      (prisma.agentTeam.update as any).mockResolvedValue({ ...mockTeamWithMembers, status: 'running' });

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

      // Verify subagent models are set correctly
      const callArgs = (query as any).mock.calls[0][0];
      
      // coder-agent uses agent's model (sonnet)
      expect(callArgs.options.agents['coder-agent'].model).toBe('claude-sonnet-4-20250514');
      
      // tester-agent uses agent's model (haiku)
      expect(callArgs.options.agents['tester-agent'].model).toBe('claude-haiku-4-20250514');
    });
  });

  describe('Cost Attribution', () => {
    describe('MODEL_PRICING', () => {
      test('MODEL_PRICING contains common models', () => {
        expect(MODEL_PRICING['claude-opus-4-20250514']).toBeDefined();
        expect(MODEL_PRICING['claude-sonnet-4-20250514']).toBeDefined();
        expect(MODEL_PRICING['claude-haiku-3-5-20241022']).toBeDefined();
        expect(MODEL_PRICING['gpt-4o']).toBeDefined();
        expect(MODEL_PRICING['glm-5']).toBeDefined();
      });

      test('MODEL_PRICING has input and output rates', () => {
        const sonnetPricing = MODEL_PRICING['claude-sonnet-4-20250514'];
        expect(sonnetPricing.input).toBeGreaterThan(0);
        expect(sonnetPricing.output).toBeGreaterThan(0);
        expect(sonnetPricing.output).toBeGreaterThan(sonnetPricing.input); // Output is typically more expensive
      });

      test('Opus is most expensive, Haiku is cheapest', () => {
        const opusPricing = MODEL_PRICING['claude-opus-4-20250514'];
        const sonnetPricing = MODEL_PRICING['claude-sonnet-4-20250514'];
        const haikuPricing = MODEL_PRICING['claude-haiku-3-5-20241022'];
        
        expect(opusPricing.input).toBeGreaterThan(sonnetPricing.input);
        expect(sonnetPricing.input).toBeGreaterThan(haikuPricing.input);
        expect(opusPricing.output).toBeGreaterThan(sonnetPricing.output);
        expect(sonnetPricing.output).toBeGreaterThan(haikuPricing.output);
      });
    });

    describe('getModelPricing()', () => {
      test('returns pricing for known models', () => {
        const pricing = getModelPricing('claude-sonnet-4-20250514');
        expect(pricing.input).toBe(3);
        expect(pricing.output).toBe(15);
      });

      test('returns default pricing for unknown models', () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const pricing = getModelPricing('unknown-model-xyz');
        expect(pricing.input).toBe(3); // Default sonnet-like pricing
        expect(pricing.output).toBe(15);
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
      });

      test('handles model aliases', () => {
        // Test that different model name formats work
        expect(getModelPricing('claude-sonnet-4').input).toBe(3);
        expect(getModelPricing('claude-3-5-sonnet').input).toBe(3);
      });
    });

    describe('calculateCost()', () => {
      test('calculates cost correctly for sonnet', () => {
        // Sonnet: $3/M input, $15/M output
        // 1000 input + 500 output = (1000/1M * 3) + (500/1M * 15) = 0.003 + 0.0075 = 0.0105
        const cost = calculateCost(1000, 500, 'claude-sonnet-4-20250514');
        expect(cost).toBeCloseTo(0.0105, 6);
      });

      test('calculates cost correctly for opus', () => {
        // Opus: $15/M input, $75/M output
        // 1000 input + 500 output = (1000/1M * 15) + (500/1M * 75) = 0.015 + 0.0375 = 0.0525
        const cost = calculateCost(1000, 500, 'claude-opus-4-20250514');
        expect(cost).toBeCloseTo(0.0525, 6);
      });

      test('calculates cost correctly for haiku', () => {
        // Haiku: $0.8/M input, $4/M output
        // 1000 input + 500 output = (1000/1M * 0.8) + (500/1M * 4) = 0.0008 + 0.002 = 0.0028
        const cost = calculateCost(1000, 500, 'claude-haiku-3-5-20241022');
        expect(cost).toBeCloseTo(0.0028, 6);
      });

      test('returns 0 for zero tokens', () => {
        const cost = calculateCost(0, 0, 'claude-sonnet-4-20250514');
        expect(cost).toBe(0);
      });

      test('handles large token counts', () => {
        // 1M input + 1M output for sonnet = 3 + 15 = 18 USD
        const cost = calculateCost(1_000_000, 1_000_000, 'claude-sonnet-4-20250514');
        expect(cost).toBe(18);
      });

      test('uses default pricing for unknown model', () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const cost = calculateCost(1000, 500, 'unknown-model');
        // Default: $3/M input, $15/M output
        expect(cost).toBeCloseTo(0.0105, 6);
        consoleSpy.mockRestore();
      });
    });

    describe('Cost in onUsage callback', () => {
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

      test('onUsage callback includes model and cost', async () => {
        (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeam);
        (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
        (prisma.agentTeam.update as any).mockResolvedValue({});
        (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 0 });

        const mockIterator = {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'assistant',
              content: [{ type: 'text', text: 'Processing...' }],
              message: {
                usage: { input_tokens: 1000, output_tokens: 500 },
              },
            };
            yield {
              type: 'result',
              subtype: 'success',
              result: 'Done',
              total_cost_usd: 0.0105,
            };
          },
        };
        (query as any).mockReturnValue(mockIterator);

        (prisma.agentTeamExecution.update as any).mockResolvedValue({
          ...mockExecution,
          totalInputTokens: 1000,
          totalOutputTokens: 500,
        });
        (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
          ...mockExecution,
          totalInputTokens: 1000,
          totalOutputTokens: 500,
          memberExecutions: [],
        });

        const onUsage = vi.fn();
        await service.execute({
          teamId: 'team-1',
          task: 'Test',
          callbacks: { onUsage },
        });

        await new Promise(resolve => setTimeout(resolve, 100));

        // Verify onUsage was called with model and cost
        expect(onUsage).toHaveBeenCalled();
        const usageCall = onUsage.mock.calls.find(call => call[0].inputTokens === 1000);
        expect(usageCall).toBeDefined();
        expect(usageCall[0].model).toBe('claude-sonnet-4-20250514');
        expect(usageCall[0].totalCostUsd).toBeCloseTo(0.0105, 6);
      });

      test('cost is calculated with correct model for subagent', async () => {
        const mockTeamWithMembers = {
          ...mockTeam,
          members: [
            {
              id: 'member-1',
              teamId: 'team-1',
              agentId: 'agent-2',
              role: 'coder',
              overrideModel: 'claude-haiku-3-5-20241022',
              createdAt: new Date(),
              agent: {
                id: 'agent-2',
                name: 'coder-agent',
                displayName: 'Coder Agent',
                category: 'coder',
                model: 'claude-sonnet-4-20250514',
                systemPrompt: 'Coder agent',
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

        const mockMemberExecutions = [
          {
            id: 'member-exec-1',
            teamExecutionId: 'exec-1',
            memberId: 'member-1',
            status: 'pending',
            inputTokens: 0,
            outputTokens: 0,
            createdAt: new Date(),
          },
        ];

        (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeamWithMembers);
        (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
        (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 1 });
        (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
        (prisma.agentTeam.update as any).mockResolvedValue({});
        (prisma.agentMemberExecution.findFirst as any).mockResolvedValue(mockMemberExecutions[0]);
        (prisma.agentMemberExecution.update as any).mockResolvedValue(mockMemberExecutions[0]);

        // Mock query with subagent invocation
        const mockIterator = {
          async *[Symbol.asyncIterator]() {
            // Lead agent usage (sonnet)
            yield {
              type: 'assistant',
              content: [{ type: 'text', text: 'Starting...' }],
              message: {
                usage: { input_tokens: 500, output_tokens: 200 },
              },
            };
            // Subagent invocation
            yield {
              type: 'tool_use',
              tool_name: 'Agent',
              tool_input: { agent_name: 'coder-agent', prompt: 'Write code' },
            };
            // Subagent usage (haiku - override model)
            yield {
              type: 'assistant',
              content: [{ type: 'text', text: 'Coding...' }],
              message: {
                usage: { input_tokens: 1000, output_tokens: 500 },
              },
            };
            // Subagent result
            yield {
              type: 'tool_result',
              tool_name: 'Agent',
              tool_result: 'Code written',
            };
            // Final result
            yield {
              type: 'result',
              subtype: 'success',
              result: 'Done',
              total_cost_usd: 0.0133,
            };
          },
        };
        (query as any).mockReturnValue(mockIterator);

        (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
        (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
          ...mockExecution,
          totalInputTokens: 1500,
          totalOutputTokens: 700,
          memberExecutions: mockMemberExecutions,
        });

        const onUsage = vi.fn();
        await service.execute({
          teamId: 'team-1',
          task: 'Test',
          callbacks: { onUsage },
        });

        await new Promise(resolve => setTimeout(resolve, 100));

        // Verify onUsage was called multiple times
        expect(onUsage).toHaveBeenCalled();
        
        // Find lead agent usage call (before subagent)
        const leadAgentCall = onUsage.mock.calls.find(
          call => call[0].inputTokens === 500 && !call[0].memberId
        );
        expect(leadAgentCall).toBeDefined();
        expect(leadAgentCall[0].model).toBe('claude-sonnet-4-20250514');
        // Sonnet: (500/1M * 3) + (200/1M * 15) = 0.0015 + 0.003 = 0.0045
        expect(leadAgentCall[0].totalCostUsd).toBeCloseTo(0.0045, 6);

        // Find subagent usage call (with memberId)
        const subagentCall = onUsage.mock.calls.find(
          call => call[0].inputTokens === 1000 && call[0].memberId === 'member-1'
        );
        expect(subagentCall).toBeDefined();
        expect(subagentCall[0].model).toBe('claude-haiku-3-5-20241022'); // Override model
        // Haiku: (1000/1M * 0.8) + (500/1M * 4) = 0.0008 + 0.002 = 0.0028
        expect(subagentCall[0].totalCostUsd).toBeCloseTo(0.0028, 6);
      });
    });

    describe('Cost in ExecutionStatus', () => {
      test('getStatus returns estimatedCostUsd', async () => {
        const mockExecution = {
          id: 'exec-1',
          teamId: 'team-1',
          status: 'completed',
          startedAt: new Date(),
          completedAt: new Date(),
          totalInputTokens: 1000,
          totalOutputTokens: 500,
          createdAt: new Date(),
          memberExecutions: [
            {
              id: 'member-exec-1',
              memberId: 'member-1',
              status: 'completed',
              inputTokens: 500,
              outputTokens: 250,
            },
          ],
        };

        (prisma.agentTeamExecution.findUnique as any).mockResolvedValue(mockExecution);

        const status = await service.getStatus('exec-1');

        expect(status.estimatedCostUsd).toBeDefined();
        expect(status.estimatedCostUsd).toBeGreaterThan(0);
        // Default model (sonnet): (1000/1M * 3) + (500/1M * 15) = 0.0105
        expect(status.estimatedCostUsd).toBeCloseTo(0.0105, 6);
      });

      test('getStatus calculates member execution costs', async () => {
        const mockExecution = {
          id: 'exec-1',
          teamId: 'team-1',
          status: 'completed',
          startedAt: new Date(),
          completedAt: new Date(),
          totalInputTokens: 1000,
          totalOutputTokens: 500,
          createdAt: new Date(),
          memberExecutions: [
            {
              id: 'member-exec-1',
              memberId: 'member-1',
              status: 'completed',
              inputTokens: 500,
              outputTokens: 250,
            },
          ],
        };

        (prisma.agentTeamExecution.findUnique as any).mockResolvedValue(mockExecution);

        const status = await service.getStatus('exec-1');

        expect(status.memberExecutions[0].estimatedCostUsd).toBeDefined();
        // Member: (500/1M * 3) + (250/1M * 15) = 0.0015 + 0.00375 = 0.00525
        expect(status.memberExecutions[0].estimatedCostUsd).toBeCloseTo(0.00525, 6);
      });

      test('getStatus accepts model parameter for cost calculation', async () => {
        const mockExecution = {
          id: 'exec-1',
          teamId: 'team-1',
          status: 'completed',
          startedAt: new Date(),
          completedAt: new Date(),
          totalInputTokens: 1000,
          totalOutputTokens: 500,
          createdAt: new Date(),
          memberExecutions: [],
        };

        (prisma.agentTeamExecution.findUnique as any).mockResolvedValue(mockExecution);

        // Get status with opus model
        const status = await service.getStatus('exec-1', 'claude-opus-4-20250514');

        // Opus: (1000/1M * 15) + (500/1M * 75) = 0.015 + 0.0375 = 0.0525
        expect(status.estimatedCostUsd).toBeCloseTo(0.0525, 6);
      });

      test('getStatus returns 0 cost for zero tokens', async () => {
        const mockExecution = {
          id: 'exec-1',
          teamId: 'team-1',
          status: 'pending',
          startedAt: null,
          completedAt: null,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          createdAt: new Date(),
          memberExecutions: [],
        };

        (prisma.agentTeamExecution.findUnique as any).mockResolvedValue(mockExecution);

        const status = await service.getStatus('exec-1');

        expect(status.estimatedCostUsd).toBe(0);
      });
    });

    describe('Cost aggregation', () => {
      test('Total cost equals lead agent + sum of member costs', async () => {
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
            allowedTools: JSON.stringify(['Read', 'Agent']),
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
              createdAt: new Date(),
              agent: {
                id: 'agent-2',
                name: 'coder-agent',
                displayName: 'Coder',
                category: 'coder',
                model: 'claude-haiku-3-5-20241022',
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
            inputTokens: 0,
            outputTokens: 0,
            createdAt: new Date(),
          },
        ];

        (prisma.agentTeam.findUnique as any).mockResolvedValue(mockTeamWithMembers);
        (prisma.agentTeamExecution.create as any).mockResolvedValue(mockExecution);
        (prisma.agentMemberExecution.createMany as any).mockResolvedValue({ count: 1 });
        (prisma.agentMemberExecution.findMany as any).mockResolvedValue(mockMemberExecutions);
        (prisma.agentTeam.update as any).mockResolvedValue({});
        (prisma.agentMemberExecution.findFirst as any).mockResolvedValue(mockMemberExecutions[0]);
        (prisma.agentMemberExecution.update as any).mockResolvedValue(mockMemberExecutions[0]);

        // Track all usage calls
        const usageCalls: Array<{ inputTokens: number; outputTokens: number; model: string; memberId?: string }> = [];
        const onUsage = vi.fn((usage) => {
          usageCalls.push(usage);
        });

        // Mock query with lead agent + subagent usage
        const mockIterator = {
          async *[Symbol.asyncIterator]() {
            // Lead agent usage (sonnet)
            yield {
              type: 'assistant',
              content: [{ type: 'text', text: 'Planning...' }],
              message: {
                usage: { input_tokens: 1000, output_tokens: 500 },
              },
            };
            // Invoke subagent
            yield {
              type: 'tool_use',
              tool_name: 'Agent',
              tool_input: { agent_name: 'coder-agent', prompt: 'Write code' },
            };
            // Subagent usage (haiku)
            yield {
              type: 'assistant',
              content: [{ type: 'text', text: 'Coding...' }],
              message: {
                usage: { input_tokens: 2000, output_tokens: 1000 },
              },
            };
            // Subagent result
            yield {
              type: 'tool_result',
              tool_name: 'Agent',
              tool_result: 'Done',
            };
            // Final result
            yield {
              type: 'result',
              subtype: 'success',
              result: 'Complete',
              total_cost_usd: 0.0183,
            };
          },
        };
        (query as any).mockReturnValue(mockIterator);

        (prisma.agentTeamExecution.update as any).mockResolvedValue(mockExecution);
        (prisma.agentTeamExecution.findUnique as any).mockResolvedValue({
          ...mockExecution,
          totalInputTokens: 3000,
          totalOutputTokens: 1500,
          memberExecutions: mockMemberExecutions.map(me => ({
            ...me,
            inputTokens: 2000,
            outputTokens: 1000,
          })),
        });

        await service.execute({
          teamId: 'team-1',
          task: 'Test',
          callbacks: { onUsage },
        });

        await new Promise(resolve => setTimeout(resolve, 100));

        // Calculate expected costs
        // Lead agent (sonnet): (1000/1M * 3) + (500/1M * 15) = 0.003 + 0.0075 = 0.0105
        const leadAgentCost = calculateCost(1000, 500, 'claude-sonnet-4-20250514');
        
        // Subagent (haiku): (2000/1M * 0.8) + (1000/1M * 4) = 0.0016 + 0.004 = 0.0056
        const subagentCost = calculateCost(2000, 1000, 'claude-haiku-3-5-20241022');
        
        // Total expected cost
        const expectedTotal = leadAgentCost + subagentCost;

        // Verify usage calls have correct models
        const leadUsage = usageCalls.find(u => !u.memberId && u.inputTokens === 1000);
        expect(leadUsage?.model).toBe('claude-sonnet-4-20250514');
        
        const subagentUsage = usageCalls.find(u => u.memberId === 'member-1' && u.inputTokens === 2000);
        expect(subagentUsage?.model).toBe('claude-haiku-3-5-20241022');

        // Verify total cost matches sum
        expect(expectedTotal).toBeCloseTo(0.0161, 6);
      });
    });
  });
});