import { describe, test, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { AgentDefinition, User, ModelConfig } from '@prisma/client';
import type { JWTPayload } from '@/lib/auth';

// Mock the prisma module
vi.mock('@/lib/prisma', () => ({
  prisma: {
    agentDefinition: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    modelConfig: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock the auth module
vi.mock('@/lib/auth', () => ({
  verifyToken: vi.fn(),
  hasPermission: vi.fn(),
}));

// Mock the api-auth module
vi.mock('@/lib/api-auth', () => ({
  authenticateRequest: vi.fn(),
  authErrorResponse: vi.fn(),
}));

// Import mocked modules after mocking
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';

// Helper to create mock request with authorization header
function createMockRequest(
  method: string,
  body?: Record<string, unknown>,
  token?: string
): NextRequest {
  const headers = new Headers();
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }

  return new NextRequest('http://localhost/api/agent-definitions', {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Helper to create mock JWT payload
function createMockPayload(
  userId: string = 'user-1',
  roles: string[] = ['user'],
  permissions: string[] = ['agent:read']
): JWTPayload {
  return {
    userId,
    username: 'testuser',
    email: 'test@example.com',
    roles,
    permissions,
  };
}

// Helper to create mock agent definition
function createMockAgentDefinition(
  overrides: Partial<AgentDefinition> = {}
): AgentDefinition {
  return {
    id: 'agent-1',
    userId: 'user-1',
    name: 'test-agent',
    displayName: 'Test Agent',
    description: 'A test agent',
    category: 'reviewer',
    modelConfigId: null,
    model: 'sonnet',
    systemPrompt: 'You are a code reviewer.',
    allowedTools: JSON.stringify(['Read', 'Glob', 'Grep']),
    skills: null,
    mcpServers: null,
    isActive: true,
    isBuiltin: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('AgentDefinition API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/agent-definitions', () => {
    test('returns list including built-in agents', async () => {
      const mockPayload = createMockPayload();
      const builtinAgent = createMockAgentDefinition({
        id: 'builtin-1',
        userId: null,
        name: 'builtin-reviewer',
        displayName: 'Built-in Reviewer',
        isBuiltin: true,
      });
      const customAgent = createMockAgentDefinition({
        id: 'custom-1',
        userId: 'user-1',
        name: 'custom-reviewer',
        displayName: 'Custom Reviewer',
        isBuiltin: false,
      });

      // Setup mocks
      (authenticateRequest as ReturnType<typeof vi.fn>).mockReturnValue({
        success: true,
        payload: mockPayload,
      });
      (hasPermission as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (prisma.agentDefinition.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        builtinAgent,
        customAgent,
      ]);

      // Import the route handler dynamically to use mocked modules
      const { GET } = await import('@/app/api/agent-definitions/route');
      const request = createMockRequest('GET', undefined, 'valid-token');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.agentDefinitions).toHaveLength(2);
      expect(data.agentDefinitions[0].isBuiltin).toBe(true);
      expect(data.agentDefinitions[1].isBuiltin).toBe(false);
      expect(prisma.agentDefinition.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { isBuiltin: true },
            { userId: 'user-1' },
          ],
        },
        orderBy: [{ isBuiltin: 'desc' }, { category: 'asc' }, { name: 'asc' }],
      });
    });

    test('returns 401 when unauthorized', async () => {
      (authenticateRequest as ReturnType<typeof vi.fn>).mockReturnValue({
        success: false,
        error: '未授权',
        statusCode: 401,
      });
      (authErrorResponse as ReturnType<typeof vi.fn>).mockReturnValue(
        new Response(JSON.stringify({ error: '未授权' }), { status: 401 })
      );

      const { GET } = await import('@/app/api/agent-definitions/route');
      const request = createMockRequest('GET');
      const response = await GET(request);

      expect(response.status).toBe(401);
      expect(authenticateRequest).toHaveBeenCalledWith(request);
    });
  });

  describe('POST /api/agent-definitions', () => {
    test('creates custom agent definition', async () => {
      const mockPayload = createMockPayload('user-1', ['user'], ['agent:read']);
      const newAgent = createMockAgentDefinition({
        id: 'new-agent-1',
        userId: 'user-1',
        name: 'my-custom-agent',
        displayName: 'My Custom Agent',
      });

      (authenticateRequest as ReturnType<typeof vi.fn>).mockReturnValue({
        success: true,
        payload: mockPayload,
      });
      (hasPermission as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (prisma.agentDefinition.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prisma.agentDefinition.create as ReturnType<typeof vi.fn>).mockResolvedValue(newAgent);

      const { POST } = await import('@/app/api/agent-definitions/route');
      const request = createMockRequest(
        'POST',
        {
          name: 'my-custom-agent',
          displayName: 'My Custom Agent',
          description: 'A custom agent',
          category: 'reviewer',
          model: 'sonnet',
          systemPrompt: 'You are a reviewer.',
        },
        'valid-token'
      );
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.agentDefinition.name).toBe('my-custom-agent');
      expect(data.agentDefinition.userId).toBe('user-1');
      expect(data.agentDefinition.isBuiltin).toBe(false);
      expect(prisma.agentDefinition.create).toHaveBeenCalledWith({
        data: {
          name: 'my-custom-agent',
          displayName: 'My Custom Agent',
          description: 'A custom agent',
          category: 'reviewer',
          model: 'sonnet',
          modelConfigId: null,
          systemPrompt: 'You are a reviewer.',
          allowedTools: null,
          skills: null,
          mcpServers: null,
          userId: 'user-1',
          isBuiltin: false,
          isActive: true,
        },
      });
    });

    test('returns 400 when missing required fields', async () => {
      const mockPayload = createMockPayload();

      (authenticateRequest as ReturnType<typeof vi.fn>).mockReturnValue({
        success: true,
        payload: mockPayload,
      });
      (hasPermission as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const { POST } = await import('@/app/api/agent-definitions/route');
      const request = createMockRequest(
        'POST',
        { name: 'incomplete-agent' }, // Missing displayName, description, category, model
        'valid-token'
      );
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('缺少必填字段');
    });

    test('returns 400 when name already exists', async () => {
      const mockPayload = createMockPayload();
      const existingAgent = createMockAgentDefinition({
        name: 'existing-agent',
        userId: 'user-1',
      });

      (authenticateRequest as ReturnType<typeof vi.fn>).mockReturnValue({
        success: true,
        payload: mockPayload,
      });
      (hasPermission as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (prisma.agentDefinition.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        existingAgent
      );

      const { POST } = await import('@/app/api/agent-definitions/route');
      const request = createMockRequest(
        'POST',
        {
          name: 'existing-agent',
          displayName: 'Existing Agent',
          description: 'Already exists',
          category: 'reviewer',
          model: 'sonnet',
        },
        'valid-token'
      );
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('已存在');
    });
  });

  describe('PATCH /api/agent-definitions/[id]', () => {
    test('updates custom agent definition (owner only)', async () => {
      const mockPayload = createMockPayload('user-1');
      const existingAgent = createMockAgentDefinition({
        id: 'agent-1',
        userId: 'user-1',
        name: 'my-agent',
      });
      const updatedAgent = createMockAgentDefinition({
        id: 'agent-1',
        userId: 'user-1',
        name: 'my-agent',
        displayName: 'Updated Agent',
        description: 'Updated description',
      });

      (authenticateRequest as ReturnType<typeof vi.fn>).mockReturnValue({
        success: true,
        payload: mockPayload,
      });
      (hasPermission as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (prisma.agentDefinition.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        existingAgent
      );
      (prisma.agentDefinition.update as ReturnType<typeof vi.fn>).mockResolvedValue(updatedAgent);

      const { PATCH } = await import('@/app/api/agent-definitions/[id]/route');
      const request = createMockRequest(
        'PATCH',
        {
          displayName: 'Updated Agent',
          description: 'Updated description',
        },
        'valid-token'
      );
      const response = await PATCH(request, { params: Promise.resolve({ id: 'agent-1' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.agentDefinition.displayName).toBe('Updated Agent');
      expect(prisma.agentDefinition.update).toHaveBeenCalledWith({
        where: { id: 'agent-1' },
        data: {
          displayName: 'Updated Agent',
          description: 'Updated description',
        },
      });
    });

    test('returns 403 when non-owner tries to update', async () => {
      const mockPayload = createMockPayload('user-2'); // Different user
      const existingAgent = createMockAgentDefinition({
        id: 'agent-1',
        userId: 'user-1', // Owned by user-1
        name: 'user1-agent',
      });

      (authenticateRequest as ReturnType<typeof vi.fn>).mockReturnValue({
        success: true,
        payload: mockPayload,
      });
      (hasPermission as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (prisma.agentDefinition.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        existingAgent
      );

      const { PATCH } = await import('@/app/api/agent-definitions/[id]/route');
      const request = createMockRequest(
        'PATCH',
        { displayName: 'Hacked Agent' },
        'valid-token'
      );
      const response = await PATCH(request, { params: Promise.resolve({ id: 'agent-1' }) });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain('禁止访问');
    });

    test('returns 404 when agent not found', async () => {
      const mockPayload = createMockPayload();

      (authenticateRequest as ReturnType<typeof vi.fn>).mockReturnValue({
        success: true,
        payload: mockPayload,
      });
      (hasPermission as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (prisma.agentDefinition.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const { PATCH } = await import('@/app/api/agent-definitions/[id]/route');
      const request = createMockRequest('PATCH', { displayName: 'Updated' }, 'valid-token');
      const response = await PATCH(request, { params: Promise.resolve({ id: 'nonexistent' }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toContain('不存在');
    });
  });

  describe('DELETE /api/agent-definitions/[id]', () => {
    test('cannot delete built-in agent (returns error)', async () => {
      const mockPayload = createMockPayload('user-1');
      const builtinAgent = createMockAgentDefinition({
        id: 'builtin-1',
        userId: null,
        name: 'builtin-reviewer',
        isBuiltin: true,
      });

      (authenticateRequest as ReturnType<typeof vi.fn>).mockReturnValue({
        success: true,
        payload: mockPayload,
      });
      (hasPermission as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (prisma.agentDefinition.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        builtinAgent
      );

      const { DELETE } = await import('@/app/api/agent-definitions/[id]/route');
      const request = createMockRequest('DELETE', undefined, 'valid-token');
      const response = await DELETE(request, { params: Promise.resolve({ id: 'builtin-1' }) });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain('内置 Agent');
      expect(prisma.agentDefinition.delete).not.toHaveBeenCalled();
    });

    test('deletes custom agent (owner only)', async () => {
      const mockPayload = createMockPayload('user-1');
      const customAgent = createMockAgentDefinition({
        id: 'custom-1',
        userId: 'user-1',
        name: 'my-custom-agent',
        isBuiltin: false,
      });

      (authenticateRequest as ReturnType<typeof vi.fn>).mockReturnValue({
        success: true,
        payload: mockPayload,
      });
      (hasPermission as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (prisma.agentDefinition.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        customAgent
      );
      (prisma.agentDefinition.delete as ReturnType<typeof vi.fn>).mockResolvedValue(customAgent);

      const { DELETE } = await import('@/app/api/agent-definitions/[id]/route');
      const request = createMockRequest('DELETE', undefined, 'valid-token');
      const response = await DELETE(request, { params: Promise.resolve({ id: 'custom-1' }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toContain('删除成功');
      expect(prisma.agentDefinition.delete).toHaveBeenCalledWith({
        where: { id: 'custom-1' },
      });
    });

    test('returns 403 when non-owner tries to delete', async () => {
      const mockPayload = createMockPayload('user-2'); // Different user
      const customAgent = createMockAgentDefinition({
        id: 'custom-1',
        userId: 'user-1', // Owned by user-1
        name: 'user1-agent',
        isBuiltin: false,
      });

      (authenticateRequest as ReturnType<typeof vi.fn>).mockReturnValue({
        success: true,
        payload: mockPayload,
      });
      (hasPermission as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (prisma.agentDefinition.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
        customAgent
      );

      const { DELETE } = await import('@/app/api/agent-definitions/[id]/route');
      const request = createMockRequest('DELETE', undefined, 'valid-token');
      const response = await DELETE(request, { params: Promise.resolve({ id: 'custom-1' }) });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain('禁止访问');
      expect(prisma.agentDefinition.delete).not.toHaveBeenCalled();
    });

    test('returns 401 when unauthorized', async () => {
      (authenticateRequest as ReturnType<typeof vi.fn>).mockReturnValue({
        success: false,
        error: '未授权',
        statusCode: 401,
      });
      (authErrorResponse as ReturnType<typeof vi.fn>).mockReturnValue(
        new Response(JSON.stringify({ error: '未授权' }), { status: 401 })
      );

      const { DELETE } = await import('@/app/api/agent-definitions/[id]/route');
      const request = createMockRequest('DELETE');
      const response = await DELETE(request, { params: Promise.resolve({ id: 'agent-1' }) });

      expect(response.status).toBe(401);
      expect(authenticateRequest).toHaveBeenCalledWith(request);
    });
  });
});