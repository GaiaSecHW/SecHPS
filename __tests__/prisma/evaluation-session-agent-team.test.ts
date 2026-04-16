import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';

describe('EvaluationSession agentTeamId Field', () => {
  const testUserId = 'test-user-for-eval-agent-team';
  const testProjectId = 'test-project-for-eval-agent-team';
  const testLeadAgentId = 'test-lead-agent-id-for-eval';
  const testLeadAgentName = 'test-lead-agent-for-eval';
  const testTeamId = 'test-agent-team-id-for-eval';
  const testTeamName = 'test-agent-team-for-eval';

  beforeAll(async () => {
    // Create test user if not exists
    const existingUser = await prisma.user.findUnique({ where: { id: testUserId } });
    if (!existingUser) {
      await prisma.user.create({
        data: {
          id: testUserId,
          email: 'test-eval-team@example.com',
          username: 'test-eval-team-user',
          passwordHash: 'test-hash',
          name: 'Test Eval Team User',
          updatedAt: new Date(),
        },
      });
    }

    // Create test project if not exists
    const existingProject = await prisma.project.findUnique({ where: { id: testProjectId } });
    if (!existingProject) {
      await prisma.project.create({
        data: {
          id: testProjectId,
          name: 'Test Project for Eval Agent Team',
          userId: testUserId,
          projectPath: '/tmp/test-project',
          updatedAt: new Date(),
        },
      });
    }

    // Create test lead agent if not exists
    const existingLeadAgent = await prisma.agentDefinition.findUnique({ where: { id: testLeadAgentId } });
    if (!existingLeadAgent) {
      await prisma.agentDefinition.create({
        data: {
          id: testLeadAgentId,
          name: testLeadAgentName,
          displayName: 'Test Lead Agent for Eval',
          description: 'A test lead agent for evaluation',
          category: 'reviewer',
          model: 'opus',
          userId: testUserId,
          systemPrompt: 'You are a lead agent.',
          isActive: true,
          isBuiltin: false,
          updatedAt: new Date(),
        },
      });
    }

    // Create test agent team if not exists
    const existingTeam = await prisma.agentTeam.findUnique({ where: { id: testTeamId } });
    if (!existingTeam) {
      await prisma.agentTeam.create({
        data: {
          id: testTeamId,
          name: testTeamName,
          description: 'A test agent team for evaluation',
          userId: testUserId,
          leadAgentId: testLeadAgentId,
          taskStrategy: 'parallel',
          maxTeammates: 5,
          status: 'idle',
          updatedAt: new Date(),
        },
      });
    }
  });

  afterAll(async () => {
    // Cleanup test data - order matters due to relations
    await prisma.evaluationSession.deleteMany({
      where: { projectId: testProjectId },
    });
    await prisma.agentTeam.deleteMany({
      where: { id: testTeamId },
    });
    await prisma.agentDefinition.deleteMany({
      where: { id: testLeadAgentId },
    });
    await prisma.project.deleteMany({
      where: { id: testProjectId },
    });
    await prisma.user.deleteMany({
      where: { id: testUserId },
    });
  });

  test('EvaluationSession can be created with agentTeamId', async () => {
    const evaluation = await prisma.evaluationSession.create({
      data: {
        id: 'test-eval-1',
        projectId: testProjectId,
        agentTeamId: testTeamId,
        status: 'running',
        provider: 'claude',
      },
    });

    expect(evaluation).toBeDefined();
    expect(evaluation.id).toBe('test-eval-1');
    expect(evaluation.agentTeamId).toBe(testTeamId);
    expect(evaluation.status).toBe('running');
  });

  test('EvaluationSession can be created without agentTeamId', async () => {
    const evaluation = await prisma.evaluationSession.create({
      data: {
        id: 'test-eval-2',
        projectId: testProjectId,
        status: 'running',
        provider: 'claude',
      },
    });

    expect(evaluation).toBeDefined();
    expect(evaluation.agentTeamId).toBeNull();
  });

  test('EvaluationSession can be queried with AgentTeam relation', async () => {
    const evaluation = await prisma.evaluationSession.findFirst({
      where: { agentTeamId: testTeamId },
      include: {
        AgentTeam: true,
      },
    });

    expect(evaluation).toBeDefined();
    expect(evaluation?.AgentTeam).toBeDefined();
    expect(evaluation?.AgentTeam?.name).toBe(testTeamName);
  });

  test('AgentTeam can be queried with EvaluationSessions relation', async () => {
    const team = await prisma.agentTeam.findUnique({
      where: { id: testTeamId },
      include: {
        EvaluationSessions: true,
      },
    });

    expect(team).toBeDefined();
    expect(team?.EvaluationSessions).toBeDefined();
    expect(team?.EvaluationSessions.length).toBeGreaterThan(0);
  });

  test('EvaluationSession agentTeamId index works correctly', async () => {
    // Query by agentTeamId index
    const byAgentTeamId = await prisma.evaluationSession.findMany({
      where: { agentTeamId: testTeamId },
    });
    expect(byAgentTeamId.length).toBeGreaterThan(0);
  });

  test('EvaluationSession can be updated to change agentTeamId', async () => {
    const evaluation = await prisma.evaluationSession.findFirst({
      where: { id: 'test-eval-2' },
    });
    expect(evaluation).toBeDefined();

    const updated = await prisma.evaluationSession.update({
      where: { id: evaluation!.id },
      data: {
        agentTeamId: testTeamId,
      },
    });

    expect(updated.agentTeamId).toBe(testTeamId);
  });

  test('EvaluationSession can have null agentTeamId', async () => {
    const evaluation = await prisma.evaluationSession.create({
      data: {
        id: 'test-eval-3',
        projectId: testProjectId,
        status: 'running',
        provider: 'claude',
      },
    });

    expect(evaluation).toBeDefined();
    expect(evaluation.agentTeamId).toBeNull();
  });
});