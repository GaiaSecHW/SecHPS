import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import type { AgentTeam, AgentTeamMember } from '@prisma/client';

describe('AgentTeam and AgentTeamMember Models', () => {
  const testUserId = 'test-user-for-agent-team';
  const testLeadAgentName = 'test-lead-agent';
  const testMemberAgentName = 'test-member-agent';
  const testTeamName = 'test-agent-team';

  beforeAll(async () => {
    // Create test user if not exists
    const existingUser = await prisma.user.findUnique({ where: { id: testUserId } });
    if (!existingUser) {
      await prisma.user.create({
        data: {
          id: testUserId,
          email: 'test-team@example.com',
          username: 'test-team-user',
          passwordHash: 'test-hash',
          name: 'Test Team User',
        },
      });
    }

    // Create test lead agent if not exists
    const existingLeadAgent = await prisma.agentDefinition.findUnique({ where: { name: testLeadAgentName } });
    if (!existingLeadAgent) {
      await prisma.agentDefinition.create({
        data: {
          name: testLeadAgentName,
          displayName: 'Test Lead Agent',
          description: 'A test lead agent',
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
          displayName: 'Test Member Agent',
          description: 'A test member agent',
          category: 'coder',
          model: 'sonnet',
          userId: testUserId,
          systemPrompt: 'You are a member agent.',
          isActive: true,
          isBuiltin: false,
        },
      });
    }
  });

  afterAll(async () => {
    // Cleanup test data - order matters due to relations
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

  test('AgentTeam model can be created', async () => {
    const leadAgent = await prisma.agentDefinition.findUnique({ where: { name: testLeadAgentName } });
    expect(leadAgent).toBeDefined();

    const team = await prisma.agentTeam.create({
      data: {
        name: testTeamName,
        description: 'A test agent team',
        userId: testUserId,
        leadAgentId: leadAgent!.id,
        taskStrategy: 'parallel',
        maxTeammates: 5,
        status: 'idle',
      },
    });

    expect(team).toBeDefined();
    expect(team.id).toBeDefined();
    expect(team.name).toBe(testTeamName);
    expect(team.description).toBe('A test agent team');
    expect(team.userId).toBe(testUserId);
    expect(team.leadAgentId).toBe(leadAgent!.id);
    expect(team.taskStrategy).toBe('parallel');
    expect(team.maxTeammates).toBe(5);
    expect(team.status).toBe('idle');
    expect(team.createdAt).toBeDefined();
    expect(team.updatedAt).toBeDefined();
  });

  test('AgentTeam can be queried with relations', async () => {
    const team = await prisma.agentTeam.findFirst({
      where: { name: testTeamName },
      include: {
        user: true,
        leadAgent: true,
        members: true,
      },
    });

    expect(team).toBeDefined();
    expect(team?.user).toBeDefined();
    expect(team?.user?.id).toBe(testUserId);
    expect(team?.leadAgent).toBeDefined();
    expect(team?.leadAgent?.name).toBe(testLeadAgentName);
    expect(team?.members).toBeDefined();
    expect(team?.members.length).toBe(0);
  });

  test('AgentTeamMember model can be created', async () => {
    const team = await prisma.agentTeam.findFirst({ where: { name: testTeamName } });
    const memberAgent = await prisma.agentDefinition.findUnique({ where: { name: testMemberAgentName } });

    expect(team).toBeDefined();
    expect(memberAgent).toBeDefined();

    const teamMember = await prisma.agentTeamMember.create({
      data: {
        teamId: team!.id,
        agentId: memberAgent!.id,
        role: 'teammate-1',
        overrideModel: 'haiku',
        overrideTools: JSON.stringify(['Read', 'Glob']),
      },
    });

    expect(teamMember).toBeDefined();
    expect(teamMember.id).toBeDefined();
    expect(teamMember.teamId).toBe(team!.id);
    expect(teamMember.agentId).toBe(memberAgent!.id);
    expect(teamMember.role).toBe('teammate-1');
    expect(teamMember.overrideModel).toBe('haiku');
    expect(teamMember.overrideTools).toBe(JSON.stringify(['Read', 'Glob']));
    expect(teamMember.createdAt).toBeDefined();
  });

  test('AgentTeamMember can be queried with relations', async () => {
    // First get the team by name to ensure we query the correct team's member
    const team = await prisma.agentTeam.findFirst({
      where: { name: testTeamName },
    });
    expect(team).toBeDefined();

    const teamMember = await prisma.agentTeamMember.findFirst({
      where: { 
        teamId: team!.id,
        role: 'teammate-1' 
      },
      include: {
        team: true,
        agent: true,
      },
    });

    expect(teamMember).toBeDefined();
    expect(teamMember?.team).toBeDefined();
    expect(teamMember?.team?.name).toBe(testTeamName);
    expect(teamMember?.agent).toBeDefined();
    expect(teamMember?.agent?.name).toBe(testMemberAgentName);
  });

  test('AgentTeam can be queried with members', async () => {
    const team = await prisma.agentTeam.findFirst({
      where: { name: testTeamName },
      include: {
        members: {
          include: {
            agent: true,
          },
        },
      },
    });

    expect(team).toBeDefined();
    expect(team?.members.length).toBe(1);
    expect(team?.members[0].role).toBe('teammate-1');
    expect(team?.members[0].agent?.name).toBe(testMemberAgentName);
  });

  test('AgentTeam can be updated', async () => {
    const team = await prisma.agentTeam.findFirst({ where: { name: testTeamName } });
    
    const updated = await prisma.agentTeam.update({
      where: { id: team!.id },
      data: {
        description: 'Updated team description',
        taskStrategy: 'sequential',
        maxTeammates: 10,
        status: 'running',
      },
    });

    expect(updated.description).toBe('Updated team description');
    expect(updated.taskStrategy).toBe('sequential');
    expect(updated.maxTeammates).toBe(10);
    expect(updated.status).toBe('running');
  });

  test('AgentTeamMember can be updated', async () => {
    const teamMember = await prisma.agentTeamMember.findFirst({ where: { role: 'teammate-1' } });
    
    const updated = await prisma.agentTeamMember.update({
      where: { id: teamMember!.id },
      data: {
        role: 'reviewer',
        overrideModel: 'sonnet',
        overrideTools: JSON.stringify(['Read', 'Glob', 'Grep']),
      },
    });

    expect(updated.role).toBe('reviewer');
    expect(updated.overrideModel).toBe('sonnet');
    expect(updated.overrideTools).toBe(JSON.stringify(['Read', 'Glob', 'Grep']));
  });

  test('AgentTeam indexes work correctly', async () => {
    const team = await prisma.agentTeam.findFirst({ where: { name: testTeamName } });
    
    // Query by userId index
    const byUserId = await prisma.agentTeam.findMany({
      where: { userId: testUserId },
    });
    expect(byUserId.length).toBeGreaterThan(0);

    // Query by status index
    const byStatus = await prisma.agentTeam.findMany({
      where: { status: 'running' },
    });
    expect(byStatus.length).toBeGreaterThan(0);

    // Query by leadAgentId index
    const byLeadAgent = await prisma.agentTeam.findMany({
      where: { leadAgentId: team!.leadAgentId },
    });
    expect(byLeadAgent.length).toBeGreaterThan(0);
  });

  test('AgentTeamMember indexes work correctly', async () => {
    const team = await prisma.agentTeam.findFirst({ where: { name: testTeamName } });
    const memberAgent = await prisma.agentDefinition.findUnique({ where: { name: testMemberAgentName } });
    
    // Query by teamId index
    const byTeamId = await prisma.agentTeamMember.findMany({
      where: { teamId: team!.id },
    });
    expect(byTeamId.length).toBeGreaterThan(0);

    // Query by agentId index
    const byAgentId = await prisma.agentTeamMember.findMany({
      where: { agentId: memberAgent!.id },
    });
    expect(byAgentId.length).toBeGreaterThan(0);
  });

  test('AgentTeamMember cascade delete works', async () => {
    const team = await prisma.agentTeam.findFirst({ where: { name: testTeamName } });
    const memberCountBefore = await prisma.agentTeamMember.count({
      where: { teamId: team!.id },
    });
    expect(memberCountBefore).toBe(1);

    // Delete team - members should cascade delete
    await prisma.agentTeam.delete({
      where: { id: team!.id },
    });

    // Verify members are deleted
    const memberCountAfter = await prisma.agentTeamMember.count({
      where: { teamId: team!.id },
    });
    expect(memberCountAfter).toBe(0);

    // Verify team is deleted
    const deletedTeam = await prisma.agentTeam.findFirst({
      where: { name: testTeamName },
    });
    expect(deletedTeam).toBeNull();
  });

  test('AgentTeam with null taskStrategy (default)', async () => {
    const leadAgent = await prisma.agentDefinition.findUnique({ where: { name: testLeadAgentName } });
    
    const teamWithDefaultStrategy = await prisma.agentTeam.create({
      data: {
        name: 'test-team-default-strategy',
        description: 'Team with default strategy',
        userId: testUserId,
        leadAgentId: leadAgent!.id,
        // taskStrategy not specified - should default to 'parallel'
        maxTeammates: 3,
      },
    });

    expect(teamWithDefaultStrategy.taskStrategy).toBe('parallel');
    expect(teamWithDefaultStrategy.status).toBe('idle');

    // Cleanup
    await prisma.agentTeam.delete({
      where: { id: teamWithDefaultStrategy.id },
    });
  });
});