import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'path';

const mockFindMany = vi.fn();
const mockUpdateMany = vi.fn();
const mockRemoveObject = vi.fn();
const mockExistsSync = vi.fn();
const mockRm = vi.fn();

vi.mock('minio', () => {
  class MockClient {
    removeObject = mockRemoveObject;
  }

  return {
    Client: MockClient,
  };
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskInstance: {
      findMany: mockFindMany,
      updateMany: mockUpdateMany,
    },
  },
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
}));

vi.mock('fs/promises', () => ({
  rm: mockRm,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  LOG_MODULES: {
    CODESWARM: 'CODESWARM',
  },
}));

describe('cleanupExpiredTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.NFS_MOUNT_PATH = '/data/shared-workspace';
    delete process.env.SHARED_WORKSPACE_PATH;
    delete process.env.TASK_CLEANUP_RETENTION_DAYS;
  });

  it('忽略不存在的 MinIO 对象并清理 NFS 目录', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'task-1', projectPath: '/data/shared-workspace/task-1' },
    ]);
    mockRemoveObject.mockRejectedValue({ code: 'NoSuchKey' });
    mockExistsSync.mockReturnValue(true);
    mockRm.mockResolvedValue(undefined);
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const { cleanupExpiredTasks } = await import('@/lib/task-cleanup');
    const result = await cleanupExpiredTasks();

    expect(result).toEqual({ cleaned: 1, errors: 0 });
    expect(mockRemoveObject).toHaveBeenCalledWith('workspace', 'workspaces/task-1.tar.gz');
    expect(mockRm).toHaveBeenCalledWith(resolve('/data/shared-workspace', 'task-1'), { recursive: true, force: true });
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('MinIO 删除失败时不标记 filesCleanedAt', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'task-2', projectPath: '/data/shared-workspace/task-2' },
    ]);
    mockRemoveObject.mockRejectedValue(new Error('minio unavailable'));
    mockExistsSync.mockReturnValue(true);

    const { cleanupExpiredTasks } = await import('@/lib/task-cleanup');
    const result = await cleanupExpiredTasks();

    expect(result).toEqual({ cleaned: 0, errors: 1 });
    expect(mockRm).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('拒绝清理共享工作区之外的 projectPath', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'task-3', projectPath: '/tmp/task-3' },
    ]);
    mockRemoveObject.mockRejectedValue({ code: 'NoSuchBucket' });

    const { cleanupExpiredTasks } = await import('@/lib/task-cleanup');
    const result = await cleanupExpiredTasks();

    expect(result).toEqual({ cleaned: 0, errors: 1 });
    expect(mockRm).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});
