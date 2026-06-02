import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecuteRaw = vi.fn();
const mockTransaction = vi.fn();
const mockTaskInstanceFindFirst = vi.fn();
const mockTaskInstanceUpdate = vi.fn();
const mockTaskExecutionLogUpsert = vi.fn();
const mockCodeswarmTaskFindUnique = vi.fn();
const mockCodeswarmTaskFindUniqueInTx = vi.fn();
const mockCodeswarmWorkerUpdateMany = vi.fn();
const mockEventEmit = vi.fn();
const mockDecrementWorkerMemoryLoad = vi.fn();
const mockTryDispatchNext = vi.fn();
const mockPublishTaskEvent = vi.fn();

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  LOG_MODULES: { CODESWARM: 'CODESWARM' },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: (fn: any) =>
      mockTransaction(fn) ??
      fn({
        $executeRaw: mockExecuteRaw,
        codeswarmTask: {
          findUnique: mockCodeswarmTaskFindUniqueInTx,
        },
        codeswarmWorker: {
          updateMany: mockCodeswarmWorkerUpdateMany,
        },
        taskInstance: {
          findFirst: mockTaskInstanceFindFirst,
          update: mockTaskInstanceUpdate,
        },
      }),
    $executeRaw: mockExecuteRaw,
    taskExecutionLog: { upsert: mockTaskExecutionLogUpsert },
    taskInstance: { findFirst: mockTaskInstanceFindFirst },
    codeswarmTask: { findUnique: mockCodeswarmTaskFindUnique },
  },
}));

vi.mock('@/lib/event-bus', () => ({
  default: { emit: mockEventEmit },
}));

vi.mock('@/services/codeswarm-dispatcher', () => ({
  codeswarmDispatcher: {
    decrementWorkerMemoryLoad: mockDecrementWorkerMemoryLoad,
    tryDispatchNext: mockTryDispatchNext,
    publishTaskEvent: mockPublishTaskEvent,
  },
}));

vi.mock('@/lib/minio-vulnerability', () => ({
  findReportFolder: vi.fn(),
  uploadReportFolder: vi.fn(),
  processVulnerabilityRawReports: vi.fn(),
}));

vi.mock('@/lib/inner-skills', () => ({
  copyInnerSkillsToWorkspace: vi.fn(() => ({ success: 0, copiedSkills: [] })),
  buildReportParseInstruction: vi.fn(() => null),
}));

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/codeswarm/worker/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('worker/result POST finalState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteRaw.mockResolvedValue(1);
    mockTaskInstanceFindFirst.mockResolvedValue(null);
    mockTaskInstanceUpdate.mockResolvedValue(undefined);
    mockTaskExecutionLogUpsert.mockResolvedValue(undefined);
    mockCodeswarmTaskFindUnique.mockResolvedValue(null);
    mockCodeswarmTaskFindUniqueInTx.mockResolvedValue({ id: 'db-1', workerId: 'worker-1' });
    mockCodeswarmWorkerUpdateMany.mockResolvedValue({ count: 1 });
    mockDecrementWorkerMemoryLoad.mockReturnValue(undefined);
    mockTryDispatchNext.mockResolvedValue(undefined);
    mockPublishTaskEvent.mockResolvedValue(undefined);
    mockTransaction.mockImplementation(() => undefined);
  });

  it('trusts Worker status=completed', async () => {
    const { POST } = await import('@/app/api/codeswarm/worker/result/route');
    const res = await POST(
      buildRequest({ taskId: 't-1', status: 'completed', reportContent: 'AUDIT_REPORT body' })
    );
    const json = await res.json();
    expect(json).toMatchObject({ success: true, taskId: 't-1', status: 'completed' });
  });

  it('does NOT promote failed→completed when reportContent exists (regression)', async () => {
    const { POST } = await import('@/app/api/codeswarm/worker/result/route');
    const res = await POST(
      buildRequest({
        taskId: 't-2',
        status: 'failed',
        reportContent: 'partial draft report',
        error: null,
      })
    );
    const json = await res.json();
    expect(json).toMatchObject({ success: true, taskId: 't-2', status: 'failed' });
  });

  it('treats unknown status as failed', async () => {
    const { POST } = await import('@/app/api/codeswarm/worker/result/route');
    const res = await POST(
      buildRequest({ taskId: 't-3', status: 'something-else', reportContent: 'x' })
    );
    const json = await res.json();
    expect(json.status).toBe('failed');
  });

  it('treats missing status as failed even with reportContent and no error', async () => {
    const { POST } = await import('@/app/api/codeswarm/worker/result/route');
    const res = await POST(
      buildRequest({ taskId: 't-4', reportContent: 'x', error: null })
    );
    const json = await res.json();
    expect(json.status).toBe('failed');
  });
});
