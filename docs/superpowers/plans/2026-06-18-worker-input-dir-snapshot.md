# Worker INPUT_DIR Snapshot Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Worker 启动 agent 前，把任务 `env.INPUT_DIR` 目录内容复制到本次 run 工作区的 `vlu_scan_code/` 目录。

**Architecture:** 在 `packages/worker/src/daemon.ts` 中新增一个小型、可单测的工作区准备函数，并在 `envFactory.build(...)` 完成后、`processMgr.runAgent(...)` 前调用。该函数只负责 INPUT_DIR → workspace/vlu_scan_code 的目录复制，不修改调度器 payload、不改变引擎调用参数、不清理任务工作区。

**Tech Stack:** TypeScript ESM、Node.js `node:fs/promises`、`node:path`、内置 `node:test` + `node:assert/strict`。

---

## File Structure

- Modify: `packages/worker/src/daemon.ts`
  - 引入 `node:fs/promises` 和 `node:path`。
  - 导出 `prepareInputDirSnapshot(...)` 便于单测。
  - 在 `executeTask(...)` 中，`envFactory.build(...)` 完成、`runAgent(...)` 前调用。
- Modify: `packages/worker/src/daemon.test.ts`
  - 添加 INPUT_DIR 复制行为测试。
  - 添加缺失 INPUT_DIR 不复制测试。
  - 添加配置了不存在 INPUT_DIR 时失败测试。

## Chunk 1: INPUT_DIR snapshot helper

### Task 1: Add failing tests for INPUT_DIR snapshot behavior

**Files:**
- Modify: `packages/worker/src/daemon.test.ts`
- Modify later: `packages/worker/src/daemon.ts`

- [ ] **Step 1: Add imports for temp test utilities**

Add these imports near the top of `packages/worker/src/daemon.test.ts`:

```ts
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
```

- [ ] **Step 2: Write failing test for recursive INPUT_DIR copy**

Add this test to `packages/worker/src/daemon.test.ts`:

```ts
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
```

- [ ] **Step 3: Write failing test for no INPUT_DIR no-op**

Add this test:

```ts
test('does not create vlu_scan_code when INPUT_DIR is not provided', async () => {
  const { prepareInputDirSnapshot } = await import('./daemon.js');
  const root = await mkdtemp(join(tmpdir(), 'codeswarm-input-none-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });

  const copied = await prepareInputDirSnapshot('task-no-input', workspace, undefined);

  assert.equal(copied, false);
});
```

- [ ] **Step 4: Write failing test for missing INPUT_DIR**

Add this test:

```ts
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
```

- [ ] **Step 5: Run tests to verify RED**

Run:

```bash
pnpm exec tsx packages/worker/src/daemon.test.ts
```

Expected: FAIL because `prepareInputDirSnapshot` is not exported from `daemon.js`.

### Task 2: Implement the INPUT_DIR snapshot helper

**Files:**
- Modify: `packages/worker/src/daemon.ts`

- [ ] **Step 1: Add Node imports**

At the top of `packages/worker/src/daemon.ts`, add:

```ts
import { cp, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
```

If `path` or fs imports already exist, merge with existing imports instead of duplicating.

- [ ] **Step 2: Add exported helper near existing top-level helpers**

Add near existing helper functions before `export class WorkerDaemon`:

```ts
export async function prepareInputDirSnapshot(
  taskId: string,
  workspacePath: string,
  env?: Record<string, string>,
): Promise<boolean> {
  const inputDir = env?.INPUT_DIR?.trim();
  if (!inputDir) return false;

  let inputStat;
  try {
    inputStat = await stat(inputDir);
  } catch {
    throw new Error(`INPUT_DIR does not exist or is not a directory: ${inputDir}`);
  }

  if (!inputStat.isDirectory()) {
    throw new Error(`INPUT_DIR does not exist or is not a directory: ${inputDir}`);
  }

  const targetDir = path.join(workspacePath, 'vlu_scan_code');
  await mkdir(targetDir, { recursive: true });
  await cp(inputDir, targetDir, { recursive: true, force: true });
  logger.taskInfo(taskId, LOG_MODULES.DAEMON, `Copied INPUT_DIR to workspace: ${inputDir} -> ${targetDir}`);
  return true;
}
```

- [ ] **Step 3: Run tests to verify helper GREEN**

Run:

```bash
pnpm exec tsx packages/worker/src/daemon.test.ts
```

Expected: all existing daemon tests plus new helper tests PASS.

## Chunk 2: Wire helper into Worker execution flow

### Task 3: Add failing integration-style daemon test for pre-run copy timing

**Files:**
- Modify: `packages/worker/src/daemon.test.ts`
- Modify later: `packages/worker/src/daemon.ts`

- [ ] **Step 1: Add test that runAgent sees copied files**

Add this test to `packages/worker/src/daemon.test.ts`:

```ts
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
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    },
    terminate: async () => {},
  };
  daemonInternals.postEvent = async () => {};
  daemonInternals.postResult = async () => {};

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
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
pnpm exec tsx packages/worker/src/daemon.test.ts
```

Expected: FAIL because `runAgent` is called before any INPUT_DIR copy happens.

### Task 4: Call helper before agent execution

**Files:**
- Modify: `packages/worker/src/daemon.ts`

- [ ] **Step 1: Insert call after environment build completes**

In `executeTask(...)`, after environment build and before `const agentName = ...`, insert:

```ts
      const copiedInputDir = await prepareInputDirSnapshot(taskId, workspacePath, env);
      if (copiedInputDir) {
        onEvent({
          type: 'phase_complete',
          phase: 'input_snapshot',
          success: true,
          message: `INPUT_DIR 已复制到工作区: ${path.join(workspacePath, 'vlu_scan_code')}`,
          timestamp: new Date().toISOString(),
        });
      }
```

Recommended exact location: immediately after the existing log lines:

```ts
      logger.taskInfo(taskId, LOG_MODULES.DAEMON, `Step 1 DONE: commandTemplate="${commandTemplate?.substring(0, 100)}..."`);
      this.server.log.info({ taskId, workspace: workspacePath, agent }, 'Workspace built');
```

and before:

```ts
      // agentName: resolved from opencode.json > payload.agent > fallback 'build'
```

- [ ] **Step 2: Run daemon tests to verify GREEN**

Run:

```bash
pnpm exec tsx packages/worker/src/daemon.test.ts
```

Expected: all daemon tests PASS.

## Chunk 3: Verify package correctness

### Task 5: Typecheck and build Worker

**Files:**
- No code changes expected.

- [ ] **Step 1: Typecheck Worker package**

Run:

```bash
pnpm --filter @codeswarm/worker typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 2: Build Worker package**

Run:

```bash
pnpm --filter @codeswarm/worker build
```

Expected: PASS.

- [ ] **Step 3: Review changed files**

Run:

```bash
git diff -- packages/worker/src/daemon.ts packages/worker/src/daemon.test.ts
```

Expected: only the helper, wiring, and tests are changed.

- [ ] **Step 4: Optional commit if requested by Boss**

Only if Boss explicitly asks to commit:

```bash
git add packages/worker/src/daemon.ts packages/worker/src/daemon.test.ts docs/superpowers/plans/2026-06-18-worker-input-dir-snapshot.md
git commit -m "feat(worker): copy input dir into run workspace"
```

Commit message must include:

```text
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```
