import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkerDaemon } from './daemon.js';

test('copies INPUT_DIR contents into workspace vlu_scan_code before agent runs', async () => {
  const { prepareInputDirSnapshot } = await import('./daemon.js');
  const root = await mkdtemp(join(tmpdir(), 'codeswarm-input-copy-'));
  const inputDir = join(root, 'input');
  const workspace = join(root, 'workspace');
  await mkdir(join(inputDir, 'nested'), { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(join(inputDir, 'a.txt'), 'alpha');
  await writeFile(join(inputDir, 'nested', 'b.txt'), 'beta');

  await prepareInputDirSnapshot('task-input-copy', workspace, { INPUT_DIR: inputDir });

  assert.equal(await readFile(join(workspace, 'vlu_scan_code', 'a.txt'), 'utf8'), 'alpha');
  assert.equal(await readFile(join(workspace, 'vlu_scan_code', 'nested', 'b.txt'), 'utf8'), 'beta');
});

test('does not create vlu_scan_code when INPUT_DIR is not provided', async () => {
  const { prepareInputDirSnapshot } = await import('./daemon.js');
  const root = await mkdtemp(join(tmpdir(), 'codeswarm-input-none-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });

  const copied = await prepareInputDirSnapshot('task-no-input', workspace, undefined);

  assert.equal(copied, false);
});

test('fails when configured INPUT_DIR does not exist', async () => {
  const { prepareInputDirSnapshot } = await import('./daemon.js');
  const root = await mkdtemp(join(tmpdir(), 'codeswarm-input-missing-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });

  await assert.rejects(
    () => prepareInputDirSnapshot('task-missing-input', workspace, { INPUT_DIR: join(root, 'missing') }),
    /INPUT_DIR does not exist or is not a directory/,
  );
});

test('copies INPUT_DIR into workspace before calling runAgent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codeswarm-prerun-copy-'));
  const inputDir = join(root, 'input');
  const workspace = join(root, 'workspace');
  await mkdir(inputDir, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(join(inputDir, 'source.txt'), 'scan source');

  const daemon = new WorkerDaemon({
    nodeId: 'node-test',
    port: 0,
    maxConcurrent: 1,
    schedulerUrl: 'http://scheduler.test',
    taskTimeoutMs: 1000,
    gracefulShutdownTimeoutMs: 1000,
  });

  let runAgentSawCopiedFile = false;
  let reportedStatus: string | undefined;

  const daemonInternals = daemon as any;
  daemonInternals.envFactory = {
    build: async () => ({
      workspacePath: workspace,
      agent: 'build',
      instruction: '执行任务',
      commandTemplate: undefined,
    }),
  };
  daemonInternals.processMgr = {
    runAgent: async () => {
      const copied = await readFile(join(workspace, 'vlu_scan_code', 'source.txt'), 'utf8');
      assert.equal(copied, 'scan source');
      runAgentSawCopiedFile = true;
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    },
    terminate: async () => {},
  };
  daemonInternals.postEvent = async () => {};
  daemonInternals.postResult = async (_payload: unknown, result: { status: string }) => {
    reportedStatus = result.status;
  };

  await daemonInternals.executeTask({
    taskId: 'task-prerun-copy',
    engine: 'claudecode',
    agent: 'build',
    instruction: '执行任务',
    env: { INPUT_DIR: inputDir },
    skills: [],
    scripts: [],
    mcps: [],
  });

  assert.equal(runAgentSawCopiedFile, true);
  assert.equal(reportedStatus, 'completed');
});

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
