import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}));

describe('codeswarm cleanup scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.REDIS_URL;
    delete process.env.TASK_CLEANUP_HOUR;
  });

  afterEach(async () => {
    const { codeswarmDispatcher } = await import('@/services/codeswarm-dispatcher');
    await codeswarmDispatcher.shutdown();
    vi.useRealTimers();
  });

  it('startHealthChecks 会启动 cleanup scheduler', async () => {
    const { codeswarmDispatcher } = await import('@/services/codeswarm-dispatcher');
    const dispatcher = codeswarmDispatcher as any;
    const spy = vi.spyOn(dispatcher, 'startCleanupScheduler');

    dispatcher.startHealthChecks();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('startCleanupScheduler 重复调用时只注册一个 timer', async () => {
    const { codeswarmDispatcher } = await import('@/services/codeswarm-dispatcher');
    const dispatcher = codeswarmDispatcher as any;
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    dispatcher.startCleanupScheduler();
    dispatcher.startCleanupScheduler();

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
  });
});
