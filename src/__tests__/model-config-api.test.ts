import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  authenticateRequestEnhanced: vi.fn(),
  authErrorResponse: vi.fn(),
  authErrorResponseNested: vi.fn(),
  verifyToken: vi.fn(),
  hasPermission: vi.fn(),
  modelCreate: vi.fn(),
  modelFindMany: vi.fn(),
  modelFindUnique: vi.fn(),
  modelUpdate: vi.fn(),
  modelUpdateMany: vi.fn(),
  generateId: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateRequest: mocks.authenticateRequest,
  authenticateRequestEnhanced: mocks.authenticateRequestEnhanced,
  authErrorResponse: mocks.authErrorResponse,
  authErrorResponseNested: mocks.authErrorResponseNested,
  isAdmin: vi.fn(() => true),
}));

vi.mock('@/lib/auth', () => ({
  verifyToken: mocks.verifyToken,
  hasPermission: mocks.hasPermission,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    modelConfig: {
      create: mocks.modelCreate,
      findMany: mocks.modelFindMany,
      findUnique: mocks.modelFindUnique,
      update: mocks.modelUpdate,
      updateMany: mocks.modelUpdateMany,
    },
  },
}));

vi.mock('@/lib/id-generator', () => ({
  generateId: mocks.generateId,
}));

vi.mock('@/lib/tenant-filter', () => ({
  buildTenantFilter: vi.fn(() => ({})),
  getTenantIdForCreate: vi.fn(() => 'tenant-1'),
}));

vi.mock('@/types/permissions', () => ({
  PERMISSIONS: {},
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    access: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateOther: vi.fn(),
    permissionDenied: vi.fn(),
    errorNoUser: vi.fn(),
    list: vi.fn(),
  },
  LOG_MODULES: {
    MODEL: 'MODEL',
  },
}));

function authenticatedRequest(body: Record<string, unknown>, url = 'http://localhost/api/models') {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    },
    body: JSON.stringify(body),
  });
}

const baseModel = {
  id: 'model-1',
  userId: 'user-1',
  tenantId: 'tenant-1',
  name: 'Test Model',
  providerType: 'openai',
  apiBaseUrl: 'https://api.example.com',
  apiKey: 'sk-test',
  models: JSON.stringify(['test-model']),
  routeType: 'default',
  maxTokens: 65536,
  contextWindow: 130000,
  temperature: 0.3,
  isActive: true,
  isDefault: false,
  isPublic: false,
  createdAt: new Date('2026-06-01T00:00:00Z'),
  updatedAt: new Date('2026-06-01T00:00:00Z'),
};

describe('model config API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.authenticateRequest.mockReturnValue({
      success: true,
      payload: { userId: 'user-1', roles: ['admin'] },
    });
    mocks.authenticateRequestEnhanced.mockReturnValue({
      success: true,
      payload: { userId: 'user-1', roles: ['admin'] },
      tenant: { tenantId: 'tenant-1', isIcsTenant: true, isPlatformAdmin: true },
    });
    mocks.verifyToken.mockReturnValue({ userId: 'user-1', roles: ['admin'] });
    mocks.hasPermission.mockReturnValue(true);
    mocks.generateId.mockReturnValue('model-1');
    mocks.modelCreate.mockResolvedValue(baseModel);
    mocks.modelFindMany.mockResolvedValue([baseModel]);
    mocks.modelFindUnique.mockResolvedValue({ ...baseModel, User: { email: 'owner@example.com' } });
    mocks.modelUpdate.mockResolvedValue({
      ...baseModel,
      maxTokens: 8192,
      contextWindow: 200000,
      temperature: 0.8,
    });
    mocks.modelUpdateMany.mockResolvedValue({ count: 0 });
  });

  it('creates a model with token parameter defaults when omitted', async () => {
    const { POST } = await import('@/app/api/models/route');

    const response = await POST(authenticatedRequest({
      name: 'Test Model',
      providerType: 'openai',
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      models: ['test-model'],
    }));

    expect(response.status).toBe(201);
    expect(mocks.modelCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        maxTokens: 65536,
        temperature: 0.3,
        contextWindow: 130000,
      }),
    }));
  });

  it('creates a model with user-provided token parameters', async () => {
    const { POST } = await import('@/app/api/models/route');

    const response = await POST(authenticatedRequest({
      name: 'Test Model',
      providerType: 'openai',
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      models: ['test-model'],
      maxTokens: 8192,
      temperature: 0.8,
      contextWindow: 200000,
    }));

    expect(response.status).toBe(201);
    expect(mocks.modelCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        maxTokens: 8192,
        temperature: 0.8,
        contextWindow: 200000,
      }),
    }));
  });

  it('rejects invalid user context window on create', async () => {
    const { POST } = await import('@/app/api/models/route');

    const response = await POST(authenticatedRequest({
      name: 'Test Model',
      providerType: 'openai',
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      models: ['test-model'],
      contextWindow: 1000001,
    }));

    expect(response.status).toBe(400);
    expect(mocks.modelCreate).not.toHaveBeenCalled();
  });

  it('rejects non-integer user max tokens on create', async () => {
    const { POST } = await import('@/app/api/models/route');

    const response = await POST(authenticatedRequest({
      name: 'Test Model',
      providerType: 'openai',
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      models: ['test-model'],
      maxTokens: 8192.5,
    }));

    expect(response.status).toBe(400);
    expect(mocks.modelCreate).not.toHaveBeenCalled();
  });

  it('updates user-provided token parameters', async () => {
    const { PUT } = await import('@/app/api/models/[id]/route');

    const request = new Request('http://localhost/api/models/model-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maxTokens: 8192,
        temperature: 0.8,
        contextWindow: 200000,
      }),
    });
    const response = await PUT(request, { params: Promise.resolve({ id: 'model-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.modelUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'model-1' },
      data: expect.objectContaining({
        maxTokens: 8192,
        temperature: 0.8,
        contextWindow: 200000,
      }),
    }));
  });

  it('rejects invalid user context window on update', async () => {
    const { PUT } = await import('@/app/api/models/[id]/route');

    const request = new Request('http://localhost/api/models/model-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contextWindow: -1 }),
    });
    const response = await PUT(request, { params: Promise.resolve({ id: 'model-1' }) });

    expect(response.status).toBe(400);
    expect(mocks.modelUpdate).not.toHaveBeenCalled();
  });

  it('creates an admin model with token parameter defaults when omitted', async () => {
    const { POST } = await import('@/app/api/admin/models/route');

    const response = await POST(authenticatedRequest({
      name: 'Test Model',
      providerType: 'openai',
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      models: ['test-model'],
    }, 'http://localhost/api/admin/models'));

    expect(response.status).toBe(201);
    expect(mocks.modelCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        maxTokens: 65536,
        temperature: 0.3,
        contextWindow: 130000,
      }),
    }));
  });

  it('creates an admin model with user-provided token parameters', async () => {
    const { POST } = await import('@/app/api/admin/models/route');

    const response = await POST(authenticatedRequest({
      name: 'Test Model',
      providerType: 'openai',
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      models: ['test-model'],
      maxTokens: 8192,
      temperature: 0,
      contextWindow: 200000,
    }, 'http://localhost/api/admin/models'));

    expect(response.status).toBe(201);
    expect(mocks.modelCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        maxTokens: 8192,
        temperature: 0,
        contextWindow: 200000,
      }),
    }));
  });

  it('rejects invalid admin token parameters on create', async () => {
    const { POST } = await import('@/app/api/admin/models/route');

    const response = await POST(authenticatedRequest({
      name: 'Test Model',
      providerType: 'openai',
      apiBaseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      models: ['test-model'],
      temperature: 3,
    }, 'http://localhost/api/admin/models'));

    expect(response.status).toBe(400);
    expect(mocks.modelCreate).not.toHaveBeenCalled();
  });

  it('updates admin user-provided token parameters', async () => {
    const { PUT } = await import('@/app/api/admin/models/[id]/route');

    const request = authenticatedRequest({
      maxTokens: 8192,
      temperature: 0.8,
      contextWindow: 200000,
    }, 'http://localhost/api/admin/models/model-1');
    const response = await PUT(request, { params: Promise.resolve({ id: 'model-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.modelUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'model-1' },
      data: expect.objectContaining({
        maxTokens: 8192,
        temperature: 0.8,
        contextWindow: 200000,
      }),
    }));
  });

  it('rejects invalid admin token parameters on update', async () => {
    const { PUT } = await import('@/app/api/admin/models/[id]/route');

    const request = authenticatedRequest({ contextWindow: 1000000.5 }, 'http://localhost/api/admin/models/model-1');
    const response = await PUT(request, { params: Promise.resolve({ id: 'model-1' }) });

    expect(response.status).toBe(400);
    expect(mocks.modelUpdate).not.toHaveBeenCalled();
  });
});
