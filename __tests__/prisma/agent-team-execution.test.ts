import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import type { AgentTeamExecution, AgentMemberExecution } from '@prisma/client';

describe('AgentTeamExecution and AgentMemberExecution Models', () => {
  const testUserId = 'test-user-for-team-exec';
  const testLeadAgentName = 'test-lead-exec-agent';
  const testMemberAgentName = 'test-member-exec-agent';
  const testTeamName = 'test-exec-team';

  beforeAll(async () => {
    // Create test user if not exists
    const existingUser = await prisma.user.findUnique({ where: { id: testUserId } });
    if (!existingUser) {
      await prisma.user.create({
        data: {
          id: testUserId,
          email: 'test-exec@example.com',
          username: 'test-exec-user',
          passwordHash: 'test-hash',
          name: 'Test Exec User',
        },
      });
    }

    // Create test lead agent if not exists
    const existingLeadAgent = await prisma.agentDefinition.findUnique({ where: { name: testLeadAgentName } });
    if (!existingLeadAgent) {
      await prisma.agentDefinition.create({
        data: {
          name: testLeadAgentName,
          displayName: 'Test Lead Exec Agent',
          description: 'A test lead agent for execution',
          category: 'reviewer',
          model: 'opus',
          userId: testUserId,
          systemPrompt: 'You are a lead agent.',
          isActive: true,
          isBuiltin: false,
        },
      });
    }

    // Create test member agent if not exists
    const existingMemberAgent = await prisma.agentDefinition.findUnique({ where: { name: testMemberAgentName } });
    if (!existingMemberAgent) {
      await prisma.agentDefinition.create({
        data: {
          name: testMemberAgentName,
          displayName: 'Test Member Exec Agent',
          description: 'A test member agent for execution',
          category: 'coder',
          model: 'sonnet',
          userId: testUserId,
          systemPrompt: 'You are a member agent.',
          isActive: true,
          isBuiltin: false,
        },
      });
    }

    // Create test team if not exists
    const leadAgent = await prisma.agentDefinition.findUnique({ where: { name: testLeadAgentName } });
    const existingTeam = await prisma.agentTeam.findFirst({ where: { name: testTeamName } });
    if (!existingTeam && leadAgent) {
      await prisma.agentTeam.create({
        data: {
          name: testTeamName,
          description: 'A test agent team for execution',
          userId: testUserId,
          leadAgentId: leadAgent.id,
          taskStrategy: 'parallel',
          maxTeammates: 5,
          status: 'idle',
        },
      });
    }

    // Create test team member if not exists
    const team = await prisma.agentTeam.findFirst({ where: { name: testTeamName } });
    const memberAgent = await prisma.agentDefinition.findUnique({ where: { name: testMemberAgentName } });
    const existingMember = await prisma.agentTeamMember.findFirst({
      where: { teamId: team?.id, agentId: memberAgent?.id },
    });
    if (!existingMember && team && memberAgent) {
      await prisma.agentTeamMember.create({
        data: {
          teamId: team.id,
          agentId: memberAgent.id,
          role: 'teammate-1',
        },
      });
    }
  });

  afterAll(async () => {
    // Cleanup test data - order matters due to relations
    await prisma.agentMemberExecution.deleteMany({
      where: { teamExecution: { team: { name: testTeamName } } },
    });
    await prisma.agentTeamExecution.deleteMany({
      where: { team: { name: testTeamName } },
    });
    await prisma.agentTeamMember.deleteMany({
      where: { agent: { name: { in: [testLeadAgentName, testMemberAgentName] } } },
    });
    await prisma.agentTeam.deleteMany({
      where: { name: testTeamName },
    });
    await prisma.agentDefinition.deleteMany({
      where: { name: { in: [testLeadAgentName, testMemberAgentName] } },
    });
    await prisma.user.deleteMany({
      where: { id: testUserId },
    });
  });

  test('AgentTeamExecution model can be created', async () => {
    const team = await prisma.agentTeam.findFirst({ where: { name: testTeamName } });
    expect(team).toBeDefined();

    const teamExecution = await prisma.agentTeamExecution.create({
      data: {
        teamId: team!.id,
        status: 'pending',
        totalInputTokens: 0,
        totalOutputTokens: 0,
      },
    });

    expect(teamExecution).toBeDefined();
    expect(teamExecution.id).toBeDefined();
    expect(teamExecution.teamId).toBe(team!.id);
    expect(teamExecution.evaluationId).toBeNull();
    expect(teamExecution.status).toBe('pending');
    expect(teamExecution.startedAt).toBeNull();
    expect(teamExecution.completedAt).toBeNull();
    expect(teamExecution.totalInputTokens).toBe(0);
    expect(teamExecution.totalOutputTokens).toBe(0);
    expect(teamExecution.createdAt).toBeDefined();
  });

  test('AgentTeamExecution can be queried with relations', async () => {
    const teamExecution = await prisma.agentTeamExecution.findFirst({
      where: { team: { name: testTeamName } },
      include: {
        team: true,
        memberExecutions: true,
      },
    });

    expect(teamExecution).toBeDefined();
    expect(teamExecution?.team).toBeDefined();
    expect(teamExecution?.team?.name).toBe(testTeamName);
    expect(teamExecution?.memberExecutions).toBeDefined();
    expect(teamExecution?.memberExecutions.length).toBe(0);
  });

  test('AgentMemberExecution model can be created', async () => {
    const teamExecution = await prisma.agentTeamExecution.findFirst({
      where: { team: { name: testTeamName } },
    });
    const teamMember = await prisma.agentTeamMember.findFirst({
      where: { team: { name: testTeamName } },
    });

    expect(teamExecution).toBeDefined();
    expect(teamMember).toBeDefined();

    const memberExecution = await prisma.agentMemberExecution.create({
      data: {
        teamExecutionId: teamExecution!.id,
        memberId: teamMember!.id,
        status: 'pending',
        inputTokens: 0,
        outputTokens: 0,
      },
    });

    expect(memberExecution).toBeDefined();
    expect(memberExecution.id).toBeDefined();
    expect(memberExecution.teamExecutionId).toBe(teamExecution!.id);
    expect(memberExecution.memberId).toBe(teamMember!.id);
    expect(memberExecution.status).toBe('pending');
    expect(memberExecution.startedAt).toBeNull();
    expect(memberExecution.completedAt).toBeNull();
    expect(memberExecution.inputTokens).toBe(0);
    expect(memberExecution.outputTokens).toBe(0);
    expect(memberExecution.createdAt).toBeDefined();
  });

  test('AgentMemberExecution can be queried with relations', async () => {
    const memberExecution = await prisma.agentMemberExecution.findFirst({
      where: { teamExecution: { team: { name: testTeamName } } },
      include: {
        teamExecution: {
          include: {
            team: true,
          },
        },
        member: true,
      },
    });

    expect(memberExecution).toBeDefined();
    expect(memberExecution?.teamExecution).toBeDefined();
    expect(memberExecution?.teamExecution?.team?.name).toBe(testTeamName);
    expect(memberExecution?.member).toBeDefined();
    expect(memberExecution?.member?.role).toBe('teammate-1');
  });

  test('AgentTeamExecution can be queried with memberExecutions', async () => {
    const teamExecution = await prisma.agentTeamExecution.findFirst({
      where: { team: { name: testTeamName } },
      include: {
        memberExecutions: {
          include: {
            member: true,
          },
        },
      },
    });

    expect(teamExecution).toBeDefined();
    expect(teamExecution?.memberExecutions.length).toBe(1);
    expect(teamExecution?.memberExecutions[0].status).toBe('pending');
    expect(teamExecution?.memberExecutions[0].member?.role).toBe('teammate-1');
  });

  test('AgentTeamExecution can be updated', async () => {
    const teamExecution = await prisma.agentTeamExecution.findFirst({
      where: { team: { name: testTeamName } },
    });

    const now = new Date();

    const updated = await prisma.agentTeamExecution.update({
      where: { id: teamExecution!.id },
      data: {
        status: 'running',
        startedAt: now,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
      },
    });

    expect(updated.status).toBe('running');
    expect(updated.startedAt).toBeDefined();
    expect(updated.totalInputTokens).toBe(1000);
    expect(updated.totalOutputTokens).toBe(500);
  });

  test('AgentMemberExecution can be updated', async () => {
    const memberExecution = await prisma.agentMemberExecution.findFirst({
      where: { teamExecution: { team: { name: testTeamName } } },
    });

    const now = new Date();

    const updated = await prisma.agentMemberExecution.update({
      where: { id: memberExecution!.id },
      data: {
        status: 'completed',
        startedAt: now,
        completedAt: now,
        inputTokens: 500,
        outputTokens: 300,
      },
    });

    expect(updated.status).toBe('completed');
    expect(updated.startedAt).toBeDefined();
    expect(updated.completedAt).toBeDefined();
    expect(updated.inputTokens).toBe(500);
    expect(updated.outputTokens).toBe(300);
  });

  test('AgentTeamExecution indexes work correctly', async () => {
    const team = await prisma.agentTeam.findFirst({ where: { name: testTeamName } });
    const teamExecution = await prisma.agentTeamExecution.findFirst({
      where: { team: { name: testTeamName } },
    });

    // Query by teamId index
    const byTeamId = await prisma.agentTeamExecution.findMany({
      where: { teamId: team!.id },
    });
    expect(byTeamId.length).toBeGreaterThan(0);

    // Query by status index
    const byStatus = await prisma.agentTeamExecution.findMany({
      where: { status: 'running' },
    });
    expect(byStatus.length).toBeGreaterThan(0);

    // Query by evaluationId index (null)
    const byEvaluationId = await prisma.agentTeamExecution.findMany({
      where: { evaluationId: null },
    });
    expect(byEvaluationId.length).toBeGreaterThan(0);
  });

  test('AgentMemberExecution indexes work correctly', async () => {
    const teamExecution = await prisma.agentTeamExecution.findFirst({
      where: { team: { name: testTeamName } },
    });
    const teamMember = await prisma.agentTeamMember.findFirst({
      where: { team: { name: testTeamName } },
    });

    // Query by teamExecutionId index
    const byTeamExecutionId = await prisma.agentMemberExecution.findMany({
      where: { teamExecutionId: teamExecution!.id },
    });
    expect(byTeamExecutionId.length).toBeGreaterThan(0);

    // Query by memberId index
    const byMemberId = await prisma.agentMemberExecution.findMany({
      where: { memberId: teamMember!.id },
    });
    expect(byMemberId.length).toBeGreaterThan(0);

    // Query by status index
    const byStatus = await prisma.agentMemberExecution.findMany({
      where: { status: 'completed' },
    });
    expect(byStatus.length).toBeGreaterThan(0);
  });

  test('AgentMemberExecution cascade delete works', async () => {
    // Create a new team execution for this test
    const team = await prisma.agentTeam.findFirst({ where: { name: testTeamName } });
    const teamMember = await prisma.agentTeamMember.findFirst({
      where: { team: { name: testTeamName } },
    });

    const newTeamExecution = await prisma.agentTeamExecution.create({
      data: {
        teamId: team!.id,
        status: 'pending',
      },
    });

    const newMemberExecution = await prisma.agentMemberExecution.create({
      data: {
        teamExecutionId: newTeamExecution.id,
        memberId: teamMember!.id,
        status: 'pending',
      },
    });

    // Verify member execution exists
    const memberCountBefore = await prisma.agentMemberExecution.count({
      where: { teamExecutionId: newTeamExecution.id },
    });
    expect(memberCountBefore).toBe(1);

    // Delete team execution - member executions should cascade delete
    await prisma.agentTeamExecution.delete({
      where: { id: newTeamExecution.id },
    });

    // Verify member executions are deleted
    const memberCountAfter = await prisma.agentMemberExecution.count({
      where: { teamExecutionId: newTeamExecution.id },
    });
    expect(memberCountAfter).toBe(0);

    // Verify team execution is deleted
    const deletedTeamExecution = await prisma.agentTeamExecution.findUnique({
      where: { id: newTeamExecution.id },
    });
    expect(deletedTeamExecution).toBeNull();
  });

  test('AgentTeamExecution with default values', async () => {
    const team = await prisma.agentTeam.findFirst({ where: { name: testTeamName } });

    const teamExecutionWithDefaults = await prisma.agentTeamExecution.create({
      data: {
        teamId: team!.id,
        // status not specified - should default to 'pending'
        // totalInputTokens not specified - should default to 0
        // totalOutputTokens not specified - should default to 0
      },
    });

    expect(teamExecutionWithDefaults.status).toBe('pending');
    expect(teamExecutionWithDefaults.totalInputTokens).toBe(0);
    expect(teamExecutionWithDefaults.totalOutputTokens).toBe(0);
    expect(teamExecutionWithDefaults.startedAt).toBeNull();
    expect(teamExecutionWithDefaults.completedAt).toBeNull();

    // Cleanup
    await prisma.agentTeamExecution.delete({
      where: { id: teamExecutionWithDefaults.id },
    });
  });

  test('AgentMemberExecution with default values', async () => {
    const team = await prisma.agentTeam.findFirst({ where: { name: testTeamName } });
    const teamMember = await prisma.agentTeamMember.findFirst({
      where: { team: { name: testTeamName } },
    });

    const teamExecution = await prisma.agentTeamExecution.create({
      data: {
        teamId: team!.id,
      },
    });

    const memberExecutionWithDefaults = await prisma.agentMemberExecution.create({
      data: {
        teamExecutionId: teamExecution.id,
        memberId: teamMember!.id,
        // status not specified - should default to 'pending'
        // inputTokens not specified - should default to 0
        // outputTokens not specified - should default to 0
      },
    });

    expect(memberExecutionWithDefaults.status).toBe('pending');
    expect(memberExecutionWithDefaults.inputTokens).toBe(0);
    expect(memberExecutionWithDefaults.outputTokens).toBe(0);
    expect(memberExecutionWithDefaults.startedAt).toBeNull();
    expect(memberExecutionWithDefaults.completedAt).toBeNull();

    // Cleanup
    await prisma.agentMemberExecution.delete({
      where: { id: memberExecutionWithDefaults.id },
    });
    await prisma.agentTeamExecution.delete({
      where: { id: teamExecution.id },
    });
  });
});