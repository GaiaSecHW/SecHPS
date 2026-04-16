import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import type { AgentDefinition } from '@prisma/client';

describe('AgentDefinition Model', () => {
  const testAgentName = 'test-agent-definition';
  const testUserId = 'test-user-for-agent';
  const testModelConfigId = 'test-model-config-for-agent';

  beforeAll(async () => {
    // Create test user if not exists
    const existingUser = await prisma.user.findUnique({ where: { id: testUserId } });
    if (!existingUser) {
      await prisma.user.create({
        data: {
          id: testUserId,
          email: 'test-agent@example.com',
          username: 'test-agent-user',
          passwordHash: 'test-hash',
          name: 'Test Agent User',
        },
      });
    }

    // Create test model config if not exists
    const existingConfig = await prisma.modelConfig.findUnique({ where: { id: testModelConfigId } });
    if (!existingConfig) {
      await prisma.modelConfig.create({
        data: {
          id: testModelConfigId,
          userId: testUserId,
          name: 'Test Model Config',
          providerType: 'openai',
          apiBaseUrl: 'https://api.example.com',
          apiKey: 'test-key',
          models: 'gpt-4',
        },
      });
    }
  });

  afterAll(async () => {
    // Cleanup test data
    await prisma.agentDefinition.deleteMany({
      where: { name: testAgentName },
    });
    await prisma.modelConfig.deleteMany({
      where: { id: testModelConfigId },
    });
    await prisma.user.deleteMany({
      where: { id: testUserId },
    });
  });

  test('AgentDefinition model can be created', async () => {
    const agent = await prisma.agentDefinition.create({
      data: {
        name: testAgentName,
        displayName: 'Test Agent',
        description: 'A test agent definition',
        category: 'reviewer',
        model: 'sonnet',
        userId: testUserId,
        modelConfigId: testModelConfigId,
        systemPrompt: 'You are a code reviewer.',
        allowedTools: JSON.stringify(['Read', 'Glob', 'Grep']),
        skills: JSON.stringify(['skill-1', 'skill-2']),
        mcpServers: JSON.stringify(['mcp-server-1']),
        isActive: true,
        isBuiltin: false,
      },
    });

    expect(agent).toBeDefined();
    expect(agent.id).toBeDefined();
    expect(agent.name).toBe(testAgentName);
    expect(agent.displayName).toBe('Test Agent');
    expect(agent.category).toBe('reviewer');
    expect(agent.model).toBe('sonnet');
    expect(agent.isActive).toBe(true);
    expect(agent.isBuiltin).toBe(false);
    expect(agent.createdAt).toBeDefined();
    expect(agent.updatedAt).toBeDefined();
  });

  test('AgentDefinition can be queried with relations', async () => {
    const agent = await prisma.agentDefinition.findUnique({
      where: { name: testAgentName },
      include: {
        user: true,
        modelConfig: true,
      },
    });

    expect(agent).toBeDefined();
    expect(agent?.user).toBeDefined();
    expect(agent?.user?.id).toBe(testUserId);
    expect(agent?.modelConfig).toBeDefined();
    expect(agent?.modelConfig?.id).toBe(testModelConfigId);
  });

  test('AgentDefinition can be updated', async () => {
    const updated = await prisma.agentDefinition.update({
      where: { name: testAgentName },
      data: {
        displayName: 'Updated Test Agent',
        category: 'coder',
        isActive: false,
      },
    });

    expect(updated.displayName).toBe('Updated Test Agent');
    expect(updated.category).toBe('coder');
    expect(updated.isActive).toBe(false);
  });

  test('AgentDefinition indexes work correctly', async () => {
    // Query by category index
    const byCategory = await prisma.agentDefinition.findMany({
      where: { category: 'coder' },
    });
    expect(byCategory.length).toBeGreaterThan(0);

    // Query by isActive index
    const byActive = await prisma.agentDefinition.findMany({
      where: { isActive: false },
    });
    expect(byActive.length).toBeGreaterThan(0);

    // Query by name unique index
    const byName = await prisma.agentDefinition.findUnique({
      where: { name: testAgentName },
    });
    expect(byName).toBeDefined();
  });

  test('AgentDefinition can be deleted', async () => {
    await prisma.agentDefinition.delete({
      where: { name: testAgentName },
    });

    const deleted = await prisma.agentDefinition.findUnique({
      where: { name: testAgentName },
    });
    expect(deleted).toBeNull();
  });

  test('AgentDefinition with null userId (built-in agent)', async () => {
    const builtinAgent = await prisma.agentDefinition.create({
      data: {
        name: 'builtin-reviewer',
        displayName: 'Built-in Reviewer',
        description: 'A built-in agent',
        category: 'reviewer',
        model: 'opus',
        userId: null, // Built-in agent has no user
        systemPrompt: 'You are a built-in reviewer.',
        isActive: true,
        isBuiltin: true,
      },
    });

    expect(builtinAgent.userId).toBeNull();
    expect(builtinAgent.isBuiltin).toBe(true);

    // Cleanup
    await prisma.agentDefinition.delete({
      where: { name: 'builtin-reviewer' },
    });
  });
});