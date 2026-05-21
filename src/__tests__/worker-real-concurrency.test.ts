import { describe, it, expect } from 'vitest';

const WORKER1_URL = 'http://localhost:8090';
const WORKER2_URL = 'http://localhost:8091';

interface TaskPayload {
  taskId: string;
  instruction?: string;
  projectPath?: string;
  workspacePath?: string;
  skills?: string[];
  scripts?: string[];
  mcps?: unknown[];
  model?: string;
  apiKey?: string;
  apiBaseUrl?: string;
  timeoutSec?: number;
  env?: Record<string, string>;
  engine?: 'opencode' | 'claudecode';
  agent?: string;
  preferredWorkerNodeId?: string;
  targetProduct?: string;
  callbackUrl?: string;
}

const uid = () => `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function postTask(baseUrl: string, taskId: string, extra?: Partial<TaskPayload>): Promise<{ status: number; body: any }> {
  const resp = await fetch(`${baseUrl}/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, instruction: 'test-concurrency', workspacePath: '/tmp/worker-test-dummy', ...extra }),
  });
  return { status: resp.status, body: await resp.json() };
}

async function getHealth(baseUrl: string): Promise<any> {
  const resp = await fetch(`${baseUrl}/health`);
  return await resp.json();
}

async function cancelTask(baseUrl: string, taskId: string): Promise<{ status: number; body: any }> {
  const resp = await fetch(`${baseUrl}/task/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId }),
  });
  return { status: resp.status, body: await resp.json() };
}

async function waitForSlots(baseUrl: string, target: number, timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const h = await getHealth(baseUrl);
    if (h.available >= target) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`waitForSlots timeout: available=${(await getHealth(baseUrl)).available}, target=${target}`);
}

async function cancelAndWait(baseUrl: string, taskIds: string[]): Promise<void> {
  for (const id of taskIds) {
    await cancelTask(baseUrl, id);
  }
  await waitForSlots(baseUrl, 5, 60000);
}

describe('Worker-1 (8090) 5并发真实测试', () => {
  it('健康检查: available=5, maxConcurrent=5, nodeId=worker-1', async () => {
    const h = await getHealth(WORKER1_URL);
    expect(h.nodeId).toBe('worker-1');
    expect(h.available).toBe(5);
    expect(h.maxConcurrent).toBe(5);
  }, 60000);

  it('提交5个任务全部接受(202)，第6个被拒绝(503)', async () => {
    const p = uid();
    const ids = [];
    const results = [];
    for (let i = 0; i < 5; i++) {
      ids.push(`${p}-${i}`);
      results.push(await postTask(WORKER1_URL, `${p}-${i}`));
    }
    for (const r of results) {
      expect(r.status).toBe(202);
      expect(r.body.message).toBe('Task accepted');
    }
    expect((await getHealth(WORKER1_URL)).available).toBe(0);

    const r6 = await postTask(WORKER1_URL, `${p}-overflow`);
    expect(r6.status).toBe(503);
    expect(r6.body.error).toBe('Worker at capacity');

    await cancelAndWait(WORKER1_URL, ids);
  }, 120000);

  it('重复taskId被拒绝(409)，重复不影响槽位', async () => {
    await waitForSlots(WORKER1_URL, 5);
    const p = uid();
    const r1 = await postTask(WORKER1_URL, `${p}-dup`);
    expect(r1.status).toBe(202);
    expect((await getHealth(WORKER1_URL)).available).toBe(4);

    const r2 = await postTask(WORKER1_URL, `${p}-dup`);
    expect(r2.status).toBe(409);
    expect(r2.body.error).toBe('Task already being executed');
    expect((await getHealth(WORKER1_URL)).available).toBe(4);

    await cancelAndWait(WORKER1_URL, [`${p}-dup`]);
  }, 120000);

  it('取消任务后槽位立即释放', async () => {
    await waitForSlots(WORKER1_URL, 5);
    const p = uid();
    const r = await postTask(WORKER1_URL, `${p}-cancel`);
    expect(r.status).toBe(202);
    expect((await getHealth(WORKER1_URL)).available).toBe(4);

    const c = await cancelTask(WORKER1_URL, `${p}-cancel`);
    expect(c.status).toBe(200);

    await waitForSlots(WORKER1_URL, 5);
  }, 120000);

  it('取消不存在任务返回404', async () => {
    const c = await cancelTask(WORKER1_URL, 'nonexistent-task-xxx');
    expect(c.status).toBe(404);
  }, 10000);

  it('跑满→全部取消→跑满第二轮→再取消', async () => {
    await waitForSlots(WORKER1_URL, 5);
    const p1 = uid();
    const ids1 = [];
    for (let i = 0; i < 5; i++) {
      ids1.push(`${p1}-${i}`);
      const r = await postTask(WORKER1_URL, `${p1}-${i}`);
      expect(r.status).toBe(202);
    }
    expect((await getHealth(WORKER1_URL)).available).toBe(0);
    await cancelAndWait(WORKER1_URL, ids1);
    expect((await getHealth(WORKER1_URL)).available).toBe(5);

    const p2 = uid();
    const ids2 = [];
    for (let i = 0; i < 5; i++) {
      ids2.push(`${p2}-${i}`);
      const r = await postTask(WORKER1_URL, `${p2}-${i}`);
      expect(r.status).toBe(202);
    }
    expect((await getHealth(WORKER1_URL)).available).toBe(0);
    await cancelAndWait(WORKER1_URL, ids2);
  }, 120000);

  it('根路径返回状态信息', async () => {
    await waitForSlots(WORKER1_URL, 5);
    const resp = await fetch(`${WORKER1_URL}/`);
    const body = await resp.json();
    expect(body.service).toBe('codeswarm-worker');
    expect(body.nodeId).toBe('worker-1');
    expect(body.status).toBe('running');
    expect(body.maxConcurrent).toBe(5);
  }, 10000);
});

describe('Worker-2 (8091) 5并发真实测试', () => {
  it('健康检查: available=5, nodeId=worker-2', async () => {
    const h = await getHealth(WORKER2_URL);
    expect(h.nodeId).toBe('worker-2');
    expect(h.available).toBe(5);
    expect(h.maxConcurrent).toBe(5);
  }, 10000);

  it('提交5个任务全部接受(202)，第6个被拒绝(503)', async () => {
    const p = uid();
    const ids = [];
    const results = [];
    for (let i = 0; i < 5; i++) {
      ids.push(`${p}-${i}`);
      results.push(await postTask(WORKER2_URL, `${p}-${i}`));
    }
    for (const r of results) expect(r.status).toBe(202);
    expect((await getHealth(WORKER2_URL)).available).toBe(0);

    const r6 = await postTask(WORKER2_URL, `${p}-overflow`);
    expect(r6.status).toBe(503);

    await cancelAndWait(WORKER2_URL, ids);
  }, 120000);
});

describe('双Worker并发交互', () => {
  it('同时跑满两个Worker(各5)，各自拒绝溢出', async () => {
    await waitForSlots(WORKER1_URL, 5);
    await waitForSlots(WORKER2_URL, 5);

    const p = uid();
    const w1Ids = [];
    const w2Ids = [];
    for (let i = 0; i < 5; i++) {
      w1Ids.push(`${p}-w1-${i}`);
      const r = await postTask(WORKER1_URL, `${p}-w1-${i}`);
      expect(r.status).toBe(202);
    }
    for (let i = 0; i < 5; i++) {
      w2Ids.push(`${p}-w2-${i}`);
      const r = await postTask(WORKER2_URL, `${p}-w2-${i}`);
      expect(r.status).toBe(202);
    }

    expect((await getHealth(WORKER1_URL)).available).toBe(0);
    expect((await getHealth(WORKER2_URL)).available).toBe(0);

    expect((await postTask(WORKER1_URL, `${p}-w1-over`)).status).toBe(503);
    expect((await postTask(WORKER2_URL, `${p}-w2-over`)).status).toBe(503);

    await cancelAndWait(WORKER1_URL, w1Ids);
    await cancelAndWait(WORKER2_URL, w2Ids);
  }, 120000);

  it('Worker-1跑满后溢出任务可接受到Worker-2', async () => {
    await waitForSlots(WORKER1_URL, 5);
    await waitForSlots(WORKER2_URL, 5);

    const p = uid();
    const w1Ids = [];
    for (let i = 0; i < 5; i++) {
      w1Ids.push(`${p}-w1-${i}`);
      await postTask(WORKER1_URL, `${p}-w1-${i}`);
    }
    expect((await getHealth(WORKER1_URL)).available).toBe(0);

    const r2 = await postTask(WORKER2_URL, `${p}-w2-spill`);
    expect(r2.status).toBe(202);
    expect((await getHealth(WORKER2_URL)).available).toBe(4);

    await cancelAndWait(WORKER1_URL, w1Ids);
    await cancelAndWait(WORKER2_URL, [`${p}-w2-spill`]);
  }, 120000);

  it('交叉取消: 取消Worker-1任务不影响Worker-2槽位', async () => {
    await waitForSlots(WORKER1_URL, 5);
    await waitForSlots(WORKER2_URL, 5);

    const p = uid();
    await postTask(WORKER1_URL, `${p}-w1c`);
    await postTask(WORKER2_URL, `${p}-w2a`);

    expect((await getHealth(WORKER1_URL)).available).toBe(4);
    expect((await getHealth(WORKER2_URL)).available).toBe(4);

    await cancelTask(WORKER1_URL, `${p}-w1c`);

    await waitForSlots(WORKER1_URL, 5);
    expect((await getHealth(WORKER2_URL)).available).toBeGreaterThanOrEqual(3);

    await cancelAndWait(WORKER2_URL, [`${p}-w2a`]);
  }, 120000);
});