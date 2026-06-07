import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildModelConfig } from '../../codeswarm/packages/worker/src/environment';

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

const txMock = {
  $executeRaw: vi.fn(async () => 1),
  codeswarmTask: {
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (callback) => callback(txMock)),
  },
}));

describe('opencode model limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '',
    })));
  });

  it('injects context and output limits for custom OpenAI-compatible providers', () => {
    const config = buildModelConfig(
      'MiniMax/MiniMax-M2.5',
      'sk-test',
      'https://api.example.com/v1',
      { contextWindow: 130000, maxTokens: 65536 }
    );

    expect(config).toEqual({
      model: 'custom-MiniMax/MiniMax/MiniMax-M2.5',
      provider: {
        'custom-MiniMax': {
          npm: '@ai-sdk/openai-compatible',
          name: 'MiniMax',
          models: {
            'MiniMax/MiniMax-M2.5': {
              name: 'MiniMax-M2.5',
              limit: {
                context: 130000,
                output: 65536,
              },
            },
          },
          options: {
            apiKey: 'sk-test',
            baseURL: 'https://api.example.com/v1',
          },
        },
      },
    });
  });

  it('injects custom provider limits even when apiKey is omitted', () => {
    const config = buildModelConfig(
      'MiniMax/MiniMax-M2.5',
      undefined,
      'https://api.example.com/v1',
      { contextWindow: 130000, maxTokens: 65536 }
    );

    expect(config.provider?.['custom-MiniMax']).toMatchObject({
      models: {
        'MiniMax/MiniMax-M2.5': {
          name: 'MiniMax-M2.5',
          limit: {
            context: 130000,
            output: 65536,
          },
        },
      },
      options: {
        baseURL: 'https://api.example.com/v1',
      },
    });
  });

  it('passes model limits from CodeswarmTask to worker payload', async () => {
    const { codeswarmDispatcher } = await import('@/services/codeswarm-dispatcher');

    const result = await codeswarmDispatcher.sendTaskToWorker({
      id: 'db-task-1',
      taskId: 'task-1',
      instruction: 'run task',
      model: 'MiniMax/MiniMax-M2.5',
      apiKey: 'sk-test',
      apiBaseUrl: 'https://api.example.com/v1',
      maxTokens: 65536,
      contextWindow: 130000,
      skills: JSON.stringify(['skill-a']),
      scripts: null,
      mcps: null,
      timeoutSec: 3600,
      engine: 'opencode',
      agent: 'default',
    }, {
      id: 'worker-1',
      nodeId: 'node-1',
      address: '127.0.0.1:8080',
      maxConcurrent: 2,
      currentTasks: 0,
      lastHeartbeat: Date.now(),
    });

    expect(result).toBe(true);
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({
      model: 'MiniMax/MiniMax-M2.5',
      apiBaseUrl: 'https://api.example.com/v1',
      maxTokens: 65536,
      contextWindow: 130000,
    });
  });
});
