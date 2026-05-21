import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Semaphore } from '../../codeswarm/packages/worker/dist/semaphore.js';

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

class MockWorkerDaemon {
  private readonly config: { nodeId: string; port: number; maxConcurrent: number; orchestratorUrl: string };
  private readonly server: FastifyInstance;
  private readonly semaphore: Semaphore;
  private readonly activeTasks = new Map<string, TaskPayload>();
  private readonly cancelledTasks = new Set<string>();
  private readonly taskDelays = new Map<string, number>();

  constructor(config: { nodeId: string; port: number; maxConcurrent: number; orchestratorUrl: string }) {
    this.config = config;
    this.server = Fastify({ logger: false });
    this.semaphore = new Semaphore(config.maxConcurrent);
  }

  async start() {
    this.server.post('/task', async (request, reply) => {
      const payload = request.body as TaskPayload;
      if (!payload || !payload.taskId) {
        return reply.status(400).send({ error: 'Invalid task payload' });
      }

      if (!this.semaphore.tryAcquire()) {
        return reply.status(503).send({ error: 'Worker at capacity' });
      }

      if (this.activeTasks.has(payload.taskId)) {
        this.semaphore.release();
        return reply.status(409).send({ error: 'Task already being executed', taskId: payload.taskId });
      }

      this.activeTasks.set(payload.taskId, payload);

      this.mockExecuteTask(payload)
        .catch(() => {})
        .finally(() => {
          this.activeTasks.delete(payload.taskId);
          this.cancelledTasks.delete(payload.taskId);
          this.semaphore.release();
        });

      return reply.status(202).send({ taskId: payload.taskId, message: 'Task accepted' });
    });

    this.server.get('/health', async () => ({
      nodeId: this.config.nodeId,
      available: this.semaphore.available,
      maxConcurrent: this.config.maxConcurrent,
    }));

    this.server.get('/', async () => ({
      service: 'codeswarm-worker',
      nodeId: this.config.nodeId,
      status: 'running',
      available: this.semaphore.available,
      maxConcurrent: this.config.maxConcurrent,
    }));

    this.server.post('/task/cancel', async (request, reply) => {
      const body = request.body as { taskId?: string };
      if (!body?.taskId) {
        return reply.status(400).send({ error: 'Missing taskId' });
      }
      const payload = this.activeTasks.get(body.taskId);
      if (!payload) {
        return reply.status(404).send({ error: 'Task not active', taskId: body.taskId });
      }
      this.cancelledTasks.add(body.taskId);
      this.taskDelays.set(body.taskId, 0);
      return reply.status(200).send({ taskId: body.taskId, message: 'Task cancelled successfully' });
    });

    await this.server.listen({ port: this.config.port, host: '0.0.0.0' });
  }

  async stop() {
    this.taskDelays.clear();
    for (const [taskId] of this.activeTasks) {
      this.taskDelays.set(taskId, 0);
    }
    await new Promise(resolve => setTimeout(resolve, 200));
    await this.server.close();
  }

  async waitForAllTasks(): Promise<void> {
    while (this.activeTasks.size > 0) {
      this.taskDelays.clear();
      for (const [taskId] of this.activeTasks) {
        this.taskDelays.set(taskId, 0);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  private async mockExecuteTask(payload: TaskPayload): Promise<void> {
    const delay = this.taskDelays.get(payload.taskId) ?? (payload.timeoutSec ? Math.min(payload.timeoutSec * 10, 2000) : 500);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  get available() { return this.semaphore.available; }
}

describe('WorkerDaemon 5并发 HTTP 测试', () => {
  let daemon: MockWorkerDaemon;
  const port = 18089;

  async function postTask(taskId: string, extra?: Partial<TaskPayload>): Promise<{ status: number; body: any }> {
    const resp = await fetch(`http://localhost:${port}/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, instruction: 'test', ...extra }),
    });
    return { status: resp.status, body: await resp.json() };
  }

  async function getHealth(): Promise<{ status: number; body: any }> {
    const resp = await fetch(`http://localhost:${port}/health`);
    return { status: resp.status, body: await resp.json() };
  }

  beforeAll(async () => {
    daemon = new MockWorkerDaemon({
      nodeId: 'test-node-5con',
      port,
      maxConcurrent: 5,
      orchestratorUrl: 'http://localhost:3000',
    });
    await daemon.start();
  });

  afterAll(async () => {
    await daemon.stop();
  });

  afterEach(async () => {
    await daemon.waitForAllTasks();
  });

  it('初始健康检查: available=5, maxConcurrent=5', async () => {
    const { body } = await getHealth();
    expect(body.available).toBe(5);
    expect(body.maxConcurrent).toBe(5);
    expect(body.nodeId).toBe('test-node-5con');
  });

  it('提交5个任务全部接受(202)，第6个被拒绝(503)', async () => {
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await postTask(`task-fill-${i}`));
    }
    for (const r of results) {
      expect(r.status).toBe(202);
      expect(r.body.message).toBe('Task accepted');
    }

    const health = await getHealth();
    expect(health.body.available).toBe(0);

    const r6 = await postTask('task-fill-overflow');
    expect(r6.status).toBe(503);
    expect(r6.body.error).toBe('Worker at capacity');
  });

  it('任务完成后槽位释放，可再接受新任务', async () => {
    await daemon.waitForAllTasks();
    const health = await getHealth();
    expect(health.body.available).toBe(5);

    const r = await postTask('task-after-release');
    expect(r.status).toBe(202);
  });

  it('重复taskId被拒绝(409)', async () => {
    const r1 = await postTask('task-dup-1');
    expect(r1.status).toBe(202);

    const r2 = await postTask('task-dup-1');
    expect(r2.status).toBe(409);
    expect(r2.body.error).toBe('Task already being executed');
  });

  it('取消任务后槽位释放', async () => {
    const r = await postTask('task-cancel-1');
    expect(r.status).toBe(202);

    const healthBefore = await getHealth();
    expect(healthBefore.body.available).toBe(4);

    const cancelResp = await fetch(`http://localhost:${port}/task/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: 'task-cancel-1' }),
    });
    expect(cancelResp.status).toBe(200);

    await daemon.waitForAllTasks();
    const healthAfter = await getHealth();
    expect(healthAfter.body.available).toBe(5);
  });

  it('取消不存在任务返回404', async () => {
    const resp = await fetch(`http://localhost:${port}/task/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: 'nonexistent-task' }),
    });
    expect(resp.status).toBe(404);
  });

  it('无效payload返回400', async () => {
    const resp = await fetch(`http://localhost:${port}/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'no taskId' }),
    });
    expect(resp.status).toBe(400);
  });

  it('跑满5并发 → 部分释放 → 再接受 → 拒绝溢出', async () => {
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await postTask(`task-partial-${i}`));
    }
    for (const r of results) expect(r.status).toBe(202);
    expect((await getHealth()).body.available).toBe(0);

    await daemon.waitForAllTasks();

    const availAfter = (await getHealth()).body.available;
    expect(availAfter).toBe(5);

    for (let i = 0; i < 5; i++) {
      const r = await postTask(`task-partial-extra-${i}`);
      expect(r.status).toBe(202);
    }
    expect((await getHealth()).body.available).toBe(0);

    const overflow = await postTask('task-partial-overflow');
    expect(overflow.status).toBe(503);
  });

  it('根路径 / 返回 worker 状态信息', async () => {
    const resp = await fetch(`http://localhost:${port}/`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.service).toBe('codeswarm-worker');
    expect(body.nodeId).toBe('test-node-5con');
    expect(body.status).toBe('running');
    expect(body.maxConcurrent).toBe(5);
  });
});