import { describe, it, expect, vi, beforeEach } from 'vitest';

interface WorkerInfo {
  id: string;
  nodeId: string;
  address: string;
  maxConcurrent: number;
  currentTasks: number;
  lastHeartbeat: number;
}

class MockCodeswarmDispatcher {
  private workers = new Map<string, WorkerInfo>();

  onHeartbeat(data: { nodeId: string; id: string; address: string; maxConcurrent: number; currentTasks?: number }) {
    const existing = this.workers.get(data.nodeId);
    const reportedTasks = data.currentTasks ?? 0;
    const currentTasks = Math.max(existing?.currentTasks || 0, reportedTasks);
    this.workers.set(data.nodeId, {
      id: data.id,
      nodeId: data.nodeId,
      address: data.address,
      maxConcurrent: data.maxConcurrent,
      currentTasks,
      lastHeartbeat: Date.now(),
    });
  }

  selectWorker(preferredNodeId?: string): WorkerInfo | null {
    if (preferredNodeId) {
      const preferred = this.workers.get(preferredNodeId);
      if (preferred) {
        const isHealthy = Date.now() - preferred.lastHeartbeat <= 90000;
        const hasCapacity = preferred.currentTasks < preferred.maxConcurrent;
        if (isHealthy && hasCapacity) return preferred;
      }
    }

    let best: WorkerInfo | null = null;
    for (const w of this.workers.values()) {
      if (Date.now() - w.lastHeartbeat > 90000) continue;
      if (w.currentTasks >= w.maxConcurrent) continue;
      if (!best || w.currentTasks < best.currentTasks) best = w;
    }
    return best;
  }

  onTaskCompleted(nodeId: string) {
    const worker = this.workers.get(nodeId);
    if (!worker) return;
    if (worker.currentTasks > 0) {
      worker.currentTasks--;
    }
  }

  addWorker(nodeId: string, maxConcurrent: number, currentTasks = 0) {
    this.workers.set(nodeId, {
      id: `worker-${nodeId}`,
      nodeId,
      address: `localhost:8080`,
      maxConcurrent,
      currentTasks,
      lastHeartbeat: Date.now(),
    });
  }

  removeWorker(nodeId: string) {
    this.workers.delete(nodeId);
  }

  getWorker(nodeId: string): WorkerInfo | undefined {
    return this.workers.get(nodeId);
  }
}

describe('Dispatcher 5并发调度逻辑', () => {
  let dispatcher: MockCodeswarmDispatcher;

  beforeEach(() => {
    dispatcher = new MockCodeswarmDispatcher();
  });

  it('单个Worker maxConcurrent=5: 跑满时 selectWorker 返回 null', () => {
    dispatcher.addWorker('node-1', 5, 0);
    expect(dispatcher.selectWorker()).toBeTruthy();
    expect(dispatcher.selectWorker()!.nodeId).toBe('node-1');

    dispatcher.onHeartbeat({ nodeId: 'node-1', id: 'worker-node-1', address: 'localhost:8080', maxConcurrent: 5, currentTasks: 5 });
    expect(dispatcher.selectWorker()).toBeNull();
  });

  it('跑满5后逐个完成: 每完成一个 currentTasks 减1，selectWorker 重新可用', () => {
    dispatcher.addWorker('node-1', 5, 5);
    expect(dispatcher.selectWorker()).toBeNull();

    dispatcher.onTaskCompleted('node-1');
    expect(dispatcher.getWorker('node-1')!.currentTasks).toBe(4);
    expect(dispatcher.selectWorker()).toBeTruthy();

    dispatcher.onTaskCompleted('node-1');
    dispatcher.onTaskCompleted('node-1');
    dispatcher.onTaskCompleted('node-1');
    dispatcher.onTaskCompleted('node-1');
    expect(dispatcher.getWorker('node-1')!.currentTasks).toBe(0);
  });

  it('currentTasks 不会减到负数（幂等保护）', () => {
    dispatcher.addWorker('node-1', 5, 0);
    dispatcher.onTaskCompleted('node-1');
    dispatcher.onTaskCompleted('node-1');
    expect(dispatcher.getWorker('node-1')!.currentTasks).toBe(0);
  });

  it('多Worker最少负载优先分配', () => {
    dispatcher.addWorker('node-1', 5, 3);
    dispatcher.addWorker('node-2', 5, 1);
    dispatcher.addWorker('node-3', 5, 0);

    const selected = dispatcher.selectWorker();
    expect(selected!.nodeId).toBe('node-3');
  });

  it('2个Worker都跑满时返回 null', () => {
    dispatcher.addWorker('node-1', 5, 5);
    dispatcher.addWorker('node-2', 5, 5);
    expect(dispatcher.selectWorker()).toBeNull();
  });

  it('1个跑满 + 1个有空: 分配到有空Worker', () => {
    dispatcher.addWorker('node-1', 5, 5);
    dispatcher.addWorker('node-2', 5, 2);

    const selected = dispatcher.selectWorker();
    expect(selected!.nodeId).toBe('node-2');
  });

  it('指定优先节点且可用时使用该节点', () => {
    dispatcher.addWorker('node-1', 5, 2);
    dispatcher.addWorker('node-2', 5, 0);

    const selected = dispatcher.selectWorker('node-1');
    expect(selected!.nodeId).toBe('node-1');
  });

  it('指定优先节点但已跑满时回退到自动选择', () => {
    dispatcher.addWorker('node-1', 5, 5);
    dispatcher.addWorker('node-2', 5, 0);

    const selected = dispatcher.selectWorker('node-1');
    expect(selected!.nodeId).toBe('node-2');
  });

  it('心跳超过90s的Worker被视为离线，不参与选择', () => {
    dispatcher.addWorker('node-1', 5, 0);
    const worker = dispatcher.getWorker('node-1');
    worker!.lastHeartbeat = Date.now() - 100_000;

    dispatcher.addWorker('node-2', 5, 0);

    const selected = dispatcher.selectWorker();
    expect(selected!.nodeId).toBe('node-2');
  });

  it('心跳更新同步 currentTasks (取 max 防覆盖)', () => {
    dispatcher.addWorker('node-1', 5, 3);
    dispatcher.onHeartbeat({ nodeId: 'node-1', id: 'worker-node-1', address: 'localhost:8080', maxConcurrent: 5, currentTasks: 2 });
    expect(dispatcher.getWorker('node-1')!.currentTasks).toBe(3);

    dispatcher.onHeartbeat({ nodeId: 'node-1', id: 'worker-node-1', address: 'localhost:8080', maxConcurrent: 5, currentTasks: 4 });
    expect(dispatcher.getWorker('node-1')!.currentTasks).toBe(4);
  });

  it('模拟完整5并发调度流程: 5任务→跑满→完成→再调度', () => {
    dispatcher.addWorker('node-1', 5, 0);

    for (let i = 0; i < 5; i++) {
      const w = dispatcher.selectWorker();
      expect(w).toBeTruthy();
      w!.currentTasks++;
    }

    expect(dispatcher.selectWorker()).toBeNull();
    expect(dispatcher.getWorker('node-1')!.currentTasks).toBe(5);

    for (let i = 0; i < 5; i++) {
      dispatcher.onTaskCompleted('node-1');
    }

    expect(dispatcher.getWorker('node-1')!.currentTasks).toBe(0);
    expect(dispatcher.selectWorker()).toBeTruthy();
  });

  it('多Worker负载均衡: 交替分配到负载最低的', () => {
    dispatcher.addWorker('node-1', 5, 0);
    dispatcher.addWorker('node-2', 5, 0);

    const assignments: string[] = [];
    for (let i = 0; i < 10; i++) {
      const w = dispatcher.selectWorker();
      if (w) {
        assignments.push(w.nodeId);
        w.currentTasks++;
      }
    }

    const node1Count = assignments.filter(a => a === 'node-1').length;
    const node2Count = assignments.filter(a => a === 'node-2').length;
    expect(node1Count).toBe(5);
    expect(node2Count).toBe(5);
  });
});