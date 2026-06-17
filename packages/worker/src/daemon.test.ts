import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkerDaemon } from './daemon.js';

test('passes resolved work key to runAgent instead of original task apiKey', async () => {
  const originalWorkKeysUrl = process.env.AIGW_WORK_KEYS_URL;
  const originalFetch = globalThis.fetch;
  process.env.AIGW_WORK_KEYS_URL = 'https://aigw.example.com';

  const daemon = new WorkerDaemon({
    nodeId: 'node-test',
    port: 0,
    maxConcurrent: 1,
    schedulerUrl: 'http://scheduler.test',
    taskTimeoutMs: 1000,
    gracefulShutdownTimeoutMs: 1000,
  });

  let runAgentApiKey: string | undefined;
  const daemonInternals = daemon as any;
  daemonInternals.envFactory = {
    build: async () => ({
      workspacePath: '/workspace/task-virtual-key',
      agent: 'build',
      instruction: '执行任务',
      commandTemplate: undefined,
    }),
  };
  daemonInternals.processMgr = {
    runAgent: async (_taskId: string, _workspace: string, _engine: string, _agent: string, apiKey: string | undefined) => {
      runAgentApiKey = apiKey;
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    },
    terminate: async () => {},
  };
  daemonInternals.postEvent = async () => {};
  daemonInternals.postResult = async () => {};

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), 'https://aigw.example.com/api/aigw/work-keys');
    assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, 'Bearer task-api-key');
    return new Response(JSON.stringify({ secret: 'virtual-api-key' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await daemonInternals.executeTask({
      taskId: 'task-virtual-key',
      engine: 'claudecode',
      agent: 'build',
      apiKey: 'task-api-key',
      instruction: '执行任务',
      skills: [],
      scripts: [],
      mcps: [],
    });
  } finally {
    if (originalWorkKeysUrl === undefined) {
      delete process.env.AIGW_WORK_KEYS_URL;
    } else {
      process.env.AIGW_WORK_KEYS_URL = originalWorkKeysUrl;
    }
    globalThis.fetch = originalFetch;
  }

  assert.equal(runAgentApiKey, 'virtual-api-key');
});
