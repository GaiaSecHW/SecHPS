import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticateRequest = vi.fn();
const mockAuthErrorResponse = vi.fn();
const mockTaskFindUnique = vi.fn();
const mockTaskUpdateMany = vi.fn();
const mockTaskUpdate = vi.fn();
const mockTaskLogDeleteMany = vi.fn();
const mockAgentAppFindUnique = vi.fn();

vi.mock('@/lib/api-auth', () => ({
  authenticateRequest: mockAuthenticateRequest,
  authErrorResponse: mockAuthErrorResponse,
}));

vi.mock('@/types/permissions', () => ({
  PERMISSIONS: {
    SESSION_CREATE: 'SESSION_CREATE',
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskInstance: {
      findUnique: mockTaskFindUnique,
      updateMany: mockTaskUpdateMany,
      update: mockTaskUpdate,
    },
    taskExecutionLog: {
      deleteMany: mockTaskLogDeleteMany,
    },
    agentApp: {
      findUnique: mockAgentAppFindUnique,
    },
  },
  withRetry: async <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  LOG_MODULES: {
    AGENT: 'AGENT',
  },
}));

vi.mock('@/lib/event-bus', () => ({
  default: {
    emit: vi.fn(),
  },
}));

vi.mock('@/services/codeswarm-dispatcher', () => ({
  codeswarmDispatcher: {
    isAvailable: true,
    init: vi.fn(),
    submitTask: vi.fn(),
  },
}));

vi.mock('@/lib/task-creation', () => ({
  copyAgentHarnessFromLocal: vi.fn(),
}));

describe('POST /api/task-builder/tasks/[id]/execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockAuthenticateRequest.mockReturnValue({
      success: true,
      payload: { userId: 'user-1', roles: [] },
    });
  });

  it('任务文件已清理时返回 400', async () => {
    mockTaskFindUnique.mockResolvedValue({
      id: 'task-1',
      userId: 'user-1',
      status: 'completed',
      filesCleanedAt: new Date('2026-05-01T00:00:00Z'),
    });

    const { POST } = await import('@/app/api/task-builder/tasks/[id]/execute/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'task-1' }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: '任务文件已被清理，请重新创建任务并上传文件' });
    expect(mockTaskUpdateMany).not.toHaveBeenCalled();
  });

  it('并发条件不满足时返回 409', async () => {
    mockTaskFindUnique.mockResolvedValue({
      id: 'task-2',
      userId: 'user-1',
      status: 'completed',
      filesCleanedAt: null,
      agentId: 'agent-1',
      agentName: 'agent',
      mergedSkills: null,
      skills: null,
      mergedScripts: null,
      scripts: null,
      modelName: null,
      ModelConfig: null,
      notes: null,
      targetProduct: null,
      projectPath: '/data/shared-workspace/task-2',
    });
    mockAgentAppFindUnique.mockResolvedValue({
      engine: 'opencode',
      name: 'app',
      defaultAgentName: 'default-agent',
      startCommand: null,
    });
    mockTaskUpdateMany.mockResolvedValue({ count: 0 });

    const { POST } = await import('@/app/api/task-builder/tasks/[id]/execute/route');
    const response = await POST({} as any, { params: Promise.resolve({ id: 'task-2' }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: '任务状态已变更，无法执行' });
    expect(mockTaskLogDeleteMany).not.toHaveBeenCalled();
    expect(mockTaskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ filesCleanedAt: null }),
    }));
  });
});
