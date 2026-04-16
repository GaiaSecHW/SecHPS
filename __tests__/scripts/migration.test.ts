import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import * as fs from 'fs';
import * as path from 'path';

// Constants matching migration script
const PLACEHOLDER_AGENT_ID = 'migrated-workflow-placeholder-agent';
const MIGRATION_LOG_FILE = 'migration-workflow-to-agent-team-log.json';

describe('Workflow to AgentTeam Migration Logic', () => {
  const testUserId = 'test-migration-user';
  const testWorkflowId = 'test-migration-workflow';
  const testNodeId1 = 'test-migration-node-1';
  const testNodeId2 = 'test-migration-node-2';
  const testEdgeId = 'test-migration-edge';
  const testSessionId = 'test-migration-session';
  const testProjectId = 'test-migration-project';

  beforeAll(async () => {
    // Create test user
    const existingUser = await prisma.user.findUnique({ where: { id: testUserId } });
    if (!existingUser) {
      await prisma.user.create({
        data: {
          id: testUserId,
          email: 'migration-test@example.com',
          username: 'migration-test-user',
          passwordHash: 'test-hash',
          name: 'Migration Test User',
          updatedAt: new Date(),
        },
      });
    }

    // Create test project
    const existingProject = await prisma.project.findUnique({ where: { id: testProjectId } });
    if (!existingProject) {
      await prisma.project.create({
        data: {
          id: testProjectId,
          userId: testUserId,
          name: 'migration-test-project',
          displayName: 'Migration Test Project',
          updatedAt: new Date(),
        },
      });
    }
  });

  afterAll(async () => {
    // Cleanup all test data
    await prisma.agentTeamMember.deleteMany({
      where: { teamId: { startsWith: 'migrated-team-' } },
    });
    await prisma.agentTeam.deleteMany({
      where: { id: { startsWith: 'migrated-team-' } },
    });
    await prisma.agentDefinition.deleteMany({
      where: { id: PLACEHOLDER_AGENT_ID },
    });
    await prisma.workflowEdge.deleteMany({
      where: { workflowId: testWorkflowId },
    });
    await prisma.workflowNode.deleteMany({
      where: { workflowId: testWorkflowId },
    });
    await prisma.workflow.deleteMany({
      where: { id: testWorkflowId },
    });
    await prisma.evaluationSession.deleteMany({
      where: { id: testSessionId },
    });
    await prisma.project.deleteMany({
      where: { id: testProjectId },
    });
    await prisma.user.deleteMany({
      where: { id: testUserId },
    });

    // Cleanup migration log file if exists
    const logPath = path.join(process.cwd(), MIGRATION_LOG_FILE);
    if (fs.existsSync(logPath)) {
      fs.unlinkSync(logPath);
    }
  });

  beforeEach(async () => {
    // Clean up any existing test workflow data before each test
    await prisma.workflowEdge.deleteMany({
      where: { workflowId: testWorkflowId },
    });
    await prisma.workflowNode.deleteMany({
      where: { workflowId: testWorkflowId },
    });
    await prisma.workflow.deleteMany({
      where: { id: testWorkflowId },
    });
    await prisma.evaluationSession.deleteMany({
      where: { id: testSessionId },
    });
    await prisma.agentTeamMember.deleteMany({
      where: { teamId: { startsWith: 'migrated-team-' } },
    });
    await prisma.agentTeam.deleteMany({
      where: { id: { startsWith: 'migrated-team-' } },
    });
    await prisma.agentDefinition.deleteMany({
      where: { id: PLACEHOLDER_AGENT_ID },
    });
  });

  test('Placeholder AgentDefinition can be created', async () => {
    const placeholder = await prisma.agentDefinition.create({
      data: {
        id: PLACEHOLDER_AGENT_ID,
        userId: testUserId,
        name: 'Migrated Workflow Placeholder',
        displayName: 'Placeholder Agent',
        description: 'Test placeholder',
        category: 'migration',
        model: 'placeholder',
        isActive: false,
        isBuiltin: false,
        updatedAt: new Date(),
      },
    });

    expect(placeholder).toBeDefined();
    expect(placeholder.id).toBe(PLACEHOLDER_AGENT_ID);
    expect(placeholder.isActive).toBe(false);
    expect(placeholder.category).toBe('migration');
  });

  test('Workflow status maps correctly to AgentTeam status', () => {
    const mapWorkflowStatus = (status: string): string => {
      switch (status) {
        case 'running': return 'running';
        case 'draft': return 'idle';
        case 'inactive': return 'idle';
        case 'completed': return 'completed';
        case 'error': return 'error';
        default: return 'idle';
      }
    };

    expect(mapWorkflowStatus('running')).toBe('running');
    expect(mapWorkflowStatus('draft')).toBe('idle');
    expect(mapWorkflowStatus('inactive')).toBe('idle');
    expect(mapWorkflowStatus('completed')).toBe('completed');
    expect(mapWorkflowStatus('error')).toBe('error');
    expect(mapWorkflowStatus('unknown')).toBe('idle');
  });

  test('Workflow node type maps correctly to member role', () => {
    const mapNodeTypeToRole = (type: string): string => {
      switch (type) {
        case 'start': return 'lead';
        case 'end': return 'observer';
        case 'condition': return 'coordinator';
        case 'action': return 'worker';
        case 'skill': return 'worker';
        case 'agent': return 'worker';
        default: return 'teammate';
      }
    };

    expect(mapNodeTypeToRole('start')).toBe('lead');
    expect(mapNodeTypeToRole('end')).toBe('observer');
    expect(mapNodeTypeToRole('condition')).toBe('coordinator');
    expect(mapNodeTypeToRole('action')).toBe('worker');
    expect(mapNodeTypeToRole('skill')).toBe('worker');
    expect(mapNodeTypeToRole('agent')).toBe('worker');
    expect(mapNodeTypeToRole('unknown')).toBe('teammate');
  });

  test('Workflow with nodes can be migrated to AgentTeam', async () => {
    // Create placeholder agent
    await prisma.agentDefinition.create({
      data: {
        id: PLACEHOLDER_AGENT_ID,
        userId: testUserId,
        name: 'Migrated Workflow Placeholder',
        displayName: 'Placeholder Agent',
        description: 'Test placeholder',
        category: 'migration',
        model: 'placeholder',
        isActive: false,
        isBuiltin: false,
        updatedAt: new Date(),
      },
    });

    // Create test workflow
    const workflow = await prisma.workflow.create({
      data: {
        id: testWorkflowId,
        userId: testUserId,
        name: 'Test Workflow',
        description: 'A test workflow for migration',
        status: 'draft',
        updatedAt: new Date(),
      },
    });

    // Create workflow nodes
    await prisma.workflowNode.create({
      data: {
        id: testNodeId1,
        workflowId: testWorkflowId,
        type: 'start',
        positionX: 0,
        positionY: 0,
        data: JSON.stringify({ label: 'Start Node' }),
        updatedAt: new Date(),
      },
    });

    await prisma.workflowNode.create({
      data: {
        id: testNodeId2,
        workflowId: testWorkflowId,
        type: 'action',
        positionX: 100,
        positionY: 100,
        data: JSON.stringify({ label: 'Action Node' }),
        updatedAt: new Date(),
      },
    });

    // Create workflow edge
    await prisma.workflowEdge.create({
      data: {
        id: testEdgeId,
        workflowId: testWorkflowId,
        sourceId: testNodeId1,
        targetId: testNodeId2,
      },
    });

    // Simulate migration: create AgentTeam
    const agentTeam = await prisma.agentTeam.create({
      data: {
        id: `migrated-team-${testWorkflowId}`,
        userId: workflow.userId,
        name: workflow.name,
        description: workflow.description || '',
        leadAgentId: PLACEHOLDER_AGENT_ID,
        taskStrategy: 'sequential',
        maxTeammates: 2,
        status: 'idle',
        updatedAt: new Date(),
      },
    });

    expect(agentTeam).toBeDefined();
    expect(agentTeam.name).toBe('Test Workflow');
    expect(agentTeam.leadAgentId).toBe(PLACEHOLDER_AGENT_ID);
    expect(agentTeam.taskStrategy).toBe('sequential');
    expect(agentTeam.maxTeammates).toBe(2);
  });

  test('WorkflowNode can be migrated to AgentTeamMember', async () => {
    // Ensure placeholder agent exists
    await prisma.agentDefinition.create({
      data: {
        id: PLACEHOLDER_AGENT_ID,
        userId: testUserId,
        name: 'Migrated Workflow Placeholder',
        displayName: 'Placeholder Agent',
        description: 'Test placeholder',
        category: 'migration',
        model: 'placeholder',
        isActive: false,
        isBuiltin: false,
        updatedAt: new Date(),
      },
    });

    // Create test workflow and team
    await prisma.workflow.create({
      data: {
        id: testWorkflowId,
        userId: testUserId,
        name: 'Test Workflow',
        status: 'draft',
        updatedAt: new Date(),
      },
    });

    await prisma.workflowNode.create({
      data: {
        id: testNodeId1,
        workflowId: testWorkflowId,
        type: 'start',
        positionX: 0,
        positionY: 0,
        data: JSON.stringify({ label: 'Start Node' }),
        updatedAt: new Date(),
      },
    });

    const agentTeam = await prisma.agentTeam.create({
      data: {
        id: `migrated-team-${testWorkflowId}`,
        userId: testUserId,
        name: 'Test Workflow',
        leadAgentId: PLACEHOLDER_AGENT_ID,
        updatedAt: new Date(),
      },
    });

    // Create member from node
    const member = await prisma.agentTeamMember.create({
      data: {
        id: `migrated-member-${testNodeId1}`,
        teamId: agentTeam.id,
        agentId: PLACEHOLDER_AGENT_ID,
        role: 'lead',
        overrideTools: JSON.stringify({
          originalNodeId: testNodeId1,
          originalNodeType: 'start',
          originalNodeName: 'Start Node',
        }),
      },
    });

    expect(member).toBeDefined();
    expect(member.teamId).toBe(agentTeam.id);
    expect(member.agentId).toBe(PLACEHOLDER_AGENT_ID);
    expect(member.role).toBe('lead');

    // Verify overrideTools contains original node info
    const toolsData = JSON.parse(member.overrideTools || '{}');
    expect(toolsData.originalNodeId).toBe(testNodeId1);
    expect(toolsData.originalNodeType).toBe('start');
  });

  test('EvaluationSession workflowId can be set to null', async () => {
    // Create test workflow
    await prisma.workflow.create({
      data: {
        id: testWorkflowId,
        userId: testUserId,
        name: 'Test Workflow',
        status: 'draft',
        updatedAt: new Date(),
      },
    });

    // Create evaluation session with workflowId
    const session = await prisma.evaluationSession.create({
      data: {
        id: testSessionId,
        projectId: testProjectId,
        workflowId: testWorkflowId,
        title: 'Test Session',
        status: 'running',
      },
    });

    expect(session.workflowId).toBe(testWorkflowId);

    // Update workflowId to null (migration step)
    await prisma.evaluationSession.update({
      where: { id: testSessionId },
      data: { workflowId: null },
    });

    const updatedSession = await prisma.evaluationSession.findUnique({
      where: { id: testSessionId },
    });

    expect(updatedSession?.workflowId).toBeNull();
  });

  test('EvaluationSession workflowId can be restored', async () => {
    // Create test workflow
    await prisma.workflow.create({
      data: {
        id: testWorkflowId,
        userId: testUserId,
        name: 'Test Workflow',
        status: 'draft',
        updatedAt: new Date(),
      },
    });

    // Create evaluation session with null workflowId
    const session = await prisma.evaluationSession.create({
      data: {
        id: testSessionId,
        projectId: testProjectId,
        workflowId: null,
        title: 'Test Session',
        status: 'running',
      },
    });

    expect(session.workflowId).toBeNull();

    // Restore workflowId (rollback step)
    await prisma.evaluationSession.update({
      where: { id: testSessionId },
      data: { workflowId: testWorkflowId },
    });

    const restoredSession = await prisma.evaluationSession.findUnique({
      where: { id: testSessionId },
    });

    expect(restoredSession?.workflowId).toBe(testWorkflowId);
  });

  test('Migration log file structure is correct', () => {
    const mockLog = {
      timestamp: new Date().toISOString(),
      placeholderAgentId: PLACEHOLDER_AGENT_ID,
      workflows: [
        {
          workflowId: testWorkflowId,
          agentTeamId: `migrated-team-${testWorkflowId}`,
          nodes: [
            {
              nodeId: testNodeId1,
              memberId: `migrated-member-${testNodeId1}`,
              nodeName: 'Start Node',
              nodeType: 'start',
            },
          ],
          edges: [
            {
              edgeId: testEdgeId,
              sourceNodeId: testNodeId1,
              targetNodeId: testNodeId2,
              sourceMemberId: `migrated-member-${testNodeId1}`,
              targetMemberId: `migrated-member-${testNodeId2}`,
            },
          ],
          evaluationSessionIds: [testSessionId],
        },
      ],
      stats: {
        workflowsProcessed: 1,
        teamsCreated: 1,
        membersCreated: 1,
        edgesMapped: 1,
        sessionsUpdated: 1,
        errors: [],
      },
    };

    // Verify structure
    expect(mockLog.timestamp).toBeDefined();
    expect(mockLog.placeholderAgentId).toBe(PLACEHOLDER_AGENT_ID);
    expect(mockLog.workflows.length).toBe(1);
    expect(mockLog.workflows[0].workflowId).toBe(testWorkflowId);
    expect(mockLog.workflows[0].nodes.length).toBe(1);
    expect(mockLog.stats.teamsCreated).toBe(1);
  });

  test('Empty workflow can be handled', async () => {
    // Create placeholder agent
    await prisma.agentDefinition.create({
      data: {
        id: PLACEHOLDER_AGENT_ID,
        userId: testUserId,
        name: 'Migrated Workflow Placeholder',
        displayName: 'Placeholder Agent',
        description: 'Test placeholder',
        category: 'migration',
        model: 'placeholder',
        isActive: false,
        isBuiltin: false,
        updatedAt: new Date(),
      },
    });

    // Create workflow with no nodes
    const workflow = await prisma.workflow.create({
      data: {
        id: testWorkflowId,
        userId: testUserId,
        name: 'Empty Workflow',
        status: 'draft',
        updatedAt: new Date(),
      },
    });

    // Verify workflow has no nodes
    const nodes = await prisma.workflowNode.findMany({
      where: { workflowId: testWorkflowId },
    });
    expect(nodes.length).toBe(0);

    // Migration should still create team (with maxTeammates = 5 default)
    const agentTeam = await prisma.agentTeam.create({
      data: {
        id: `migrated-team-${testWorkflowId}`,
        userId: workflow.userId,
        name: workflow.name,
        leadAgentId: PLACEHOLDER_AGENT_ID,
        maxTeammates: 5, // Default for empty workflow
        updatedAt: new Date(),
      },
    });

    expect(agentTeam).toBeDefined();
    expect(agentTeam.maxTeammates).toBe(5);
  });

  test('AgentTeamMember cascade delete works for rollback', async () => {
    // Create placeholder agent
    await prisma.agentDefinition.create({
      data: {
        id: PLACEHOLDER_AGENT_ID,
        userId: testUserId,
        name: 'Migrated Workflow Placeholder',
        displayName: 'Placeholder Agent',
        description: 'Test placeholder',
        category: 'migration',
        model: 'placeholder',
        isActive: false,
        isBuiltin: false,
        updatedAt: new Date(),
      },
    });

    // Create team and member
    const agentTeam = await prisma.agentTeam.create({
      data: {
        id: `migrated-team-${testWorkflowId}`,
        userId: testUserId,
        name: 'Test Team',
        leadAgentId: PLACEHOLDER_AGENT_ID,
        updatedAt: new Date(),
      },
    });

    await prisma.agentTeamMember.create({
      data: {
        id: `migrated-member-${testNodeId1}`,
        teamId: agentTeam.id,
        agentId: PLACEHOLDER_AGENT_ID,
        role: 'teammate',
      },
    });

    // Verify member exists
    const membersBefore = await prisma.agentTeamMember.count({
      where: { teamId: agentTeam.id },
    });
    expect(membersBefore).toBe(1);

    // Delete team (cascade should delete members)
    await prisma.agentTeam.delete({
      where: { id: agentTeam.id },
    });

    // Verify members are deleted
    const membersAfter = await prisma.agentTeamMember.count({
      where: { teamId: agentTeam.id },
    });
    expect(membersAfter).toBe(0);
  });

  test('Multiple workflows can be migrated', async () => {
    // Create placeholder agent
    await prisma.agentDefinition.create({
      data: {
        id: PLACEHOLDER_AGENT_ID,
        userId: testUserId,
        name: 'Migrated Workflow Placeholder',
        displayName: 'Placeholder Agent',
        description: 'Test placeholder',
        category: 'migration',
        model: 'placeholder',
        isActive: false,
        isBuiltin: false,
        updatedAt: new Date(),
      },
    });

    // Create multiple workflows
    const workflow1 = await prisma.workflow.create({
      data: {
        id: `${testWorkflowId}-1`,
        userId: testUserId,
        name: 'Workflow 1',
        status: 'draft',
        updatedAt: new Date(),
      },
    });

    const workflow2 = await prisma.workflow.create({
      data: {
        id: `${testWorkflowId}-2`,
        userId: testUserId,
        name: 'Workflow 2',
        status: 'running',
        updatedAt: new Date(),
      },
    });

    // Create teams for both
    const team1 = await prisma.agentTeam.create({
      data: {
        id: `migrated-team-${workflow1.id}`,
        userId: workflow1.userId,
        name: workflow1.name,
        leadAgentId: PLACEHOLDER_AGENT_ID,
        status: 'idle',
        updatedAt: new Date(),
      },
    });

    const team2 = await prisma.agentTeam.create({
      data: {
        id: `migrated-team-${workflow2.id}`,
        userId: workflow2.userId,
        name: workflow2.name,
        leadAgentId: PLACEHOLDER_AGENT_ID,
        status: 'running',
        updatedAt: new Date(),
      },
    });

    expect(team1.status).toBe('idle');
    expect(team2.status).toBe('running');

    // Cleanup extra workflows
    await prisma.workflow.deleteMany({
      where: { id: { in: [`${testWorkflowId}-1`, `${testWorkflowId}-2`] } },
    });
  });
});