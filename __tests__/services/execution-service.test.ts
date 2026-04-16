import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentTeamExecutionService, SAFETY_LIMITS, ExecutionCallbacks, ExecuteParams, createAgentTeamExecutionService } from '@/services/agent-team/execution-service';
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
});