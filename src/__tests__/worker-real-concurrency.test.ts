import { describe, it, expect } from 'vitest';

const W1 = 'http://localhost:8090';
const W2 = 'http://localhost:8091';
const CB = 'http://localhost:3000';
const uid = () => `r-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;

async function post(baseUrl: string, taskId: string, withCb = true) {
  const resp = await fetch(`${baseUrl}/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, instruction: 'test', ...(withCb ? { callbackUrl: CB } : {}) }),
  });
  return { status: resp.status, body: await resp.json() };
}

async function health(baseUrl: string) {
  return await (await fetch(`${baseUrl}/health`)).json();
}

async function cancel(baseUrl: string, taskId: string) {
  const resp = await fetch(`${baseUrl}/task/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId }),
  });
  return { status: resp.status, body: await resp.json() };
}

async function waitFree(baseUrl: string, n: number, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await health(baseUrl)).available >= n) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

describe('真实 Worker 5并发验证', () => {
  it('W1/W2 健康检查正常', async () => {
    const h1 = await health(W1);
    expect(h1.nodeId).toBe('worker-1');
    expect(h1.available).toBe(5);
    expect(h1.maxConcurrent).toBe(5);
    const h2 = await health(W2);
    expect(h2.nodeId).toBe('worker-2');
    expect(h2.available).toBe(5);
    expect(h2.maxConcurrent).toBe(5);
  });

  it('单任务: 202接受 + 秒级释放(修复验证)', async () => {
    const id = uid();
    const r = await post(W1, id);
    expect(r.status).toBe(202);
    expect(r.body.taskId).toBe(id);
    const released = await waitFree(W1, 5, 3000);
    expect(released).toBe(true);
  });

  it('并行5任务全202，槽位秒级释放', async () => {
    const p = uid();
    const ids = Array.from({ length: 5 }, (_, i) => `${p}-${i}`);
    const results = await Promise.all(ids.map(id => post(W1, id)));
    expect(results.every(r => r.status === 202)).toBe(true);
    const released = await waitFree(W1, 5, 5000);
    expect(released).toBe(true);
  });

  it('跑满→取消→第二轮跑满→取消(两轮)', async () => {
    const p1 = uid();
    const ids1 = Array.from({ length: 5 }, (_, i) => `${p1}-${i}`);
    const r1 = await Promise.all(ids1.map(id => post(W1, id, false)));
    expect(r1.every(r => r.status === 202)).toBe(true);
    for (const id of ids1) await cancel(W1, id);
    expect(await waitFree(W1, 5, 5000)).toBe(true);

    const p2 = uid();
    const ids2 = Array.from({ length: 5 }, (_, i) => `${p2}-${i}`);
    const r2 = await Promise.all(ids2.map(id => post(W1, id, false)));
    expect(r2.every(r => r.status === 202)).toBe(true);
    for (const id of ids2) await cancel(W1, id);
    expect(await waitFree(W1, 5, 5000)).toBe(true);
  });

  it('取消不存在 → 404', async () => {
    expect((await cancel(W1, 'no-exist')).status).toBe(404);
  });

  it('双Worker并行10任务', async () => {
    const p = uid();
    const w1Ids = Array.from({ length: 5 }, (_, i) => `${p}-a-${i}`);
    const w2Ids = Array.from({ length: 5 }, (_, i) => `${p}-b-${i}`);
    const [r1, r2] = await Promise.all([
      Promise.all(w1Ids.map(id => post(W1, id))),
      Promise.all(w2Ids.map(id => post(W2, id))),
    ]);
    expect(r1.every(r => r.status === 202)).toBe(true);
    expect(r2.every(r => r.status === 202)).toBe(true);
    expect(await waitFree(W1, 5, 5000)).toBe(true);
    expect(await waitFree(W2, 5, 5000)).toBe(true);
  });

  it('/ 根路径状态信息', async () => {
    const b = await (await fetch(`${W1}/`)).json();
    expect(b.service).toBe('codeswarm-worker');
    expect(b.nodeId).toBe('worker-1');
    expect(b.maxConcurrent).toBe(5);
  });
});