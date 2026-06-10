/**
 * Prometheus 指标暴露
 */
import client from 'prom-client';

// 创建 Registry（不使用默认全局）
const register = new client.Registry();

// 队列深度（排队任务数）
const queueDepth = new client.Gauge({
  name: 'codeswarm_queue_depth',
  help: 'Number of tasks in queued state',
  registers: [register],
});

// Worker 拓扑
const workersOnline = new client.Gauge({
  name: 'codeswarm_workers_online',
  help: 'Number of online workers',
  registers: [register],
});

const workersCapacityTotal = new client.Gauge({
  name: 'codeswarm_workers_capacity_total',
  help: 'Total task capacity across all workers',
  registers: [register],
});

const workersCapacityUsed = new client.Gauge({
  name: 'codeswarm_workers_capacity_used',
  help: 'Currently used task slots',
  registers: [register],
});

// 任务统计
const tasksCompletedTotal = new client.Counter({
  name: 'codeswarm_tasks_completed_total',
  help: 'Total completed tasks',
  registers: [register],
});

const tasksFailedTotal = new client.Counter({
  name: 'codeswarm_tasks_failed_total',
  help: 'Total failed tasks',
  registers: [register],
});

export const metrics = {
  queueDepth,
  workersOnline,
  workersCapacityTotal,
  workersCapacityUsed,
  tasksCompletedTotal,
  tasksFailedTotal,

  /** 更新所有 gauge 指标（从 DB 查询） */
  async updateFromDB() {
    const { prisma } = await import('../prisma.js');

    const [queued, onlineWorkers, workerStats] = await Promise.all([
      prisma.codeswarmTask.count({ where: { state: 'queued' } }),
      prisma.codeswarmWorker.count({ where: { status: 'online' } }),
      prisma.codeswarmWorker.aggregate({
        _sum: { maxConcurrent: true, currentTasks: true },
        where: { status: 'online' },
      }),
    ]);

    queueDepth.set(queued);
    workersOnline.set(onlineWorkers);
    workersCapacityTotal.set(workerStats._sum.maxConcurrent || 0);
    workersCapacityUsed.set(workerStats._sum.currentTasks || 0);
  },

  /** 返回 Prometheus 格式的指标文本 */
  async getMetrics(): Promise<string> {
    await this.updateFromDB();
    return register.metrics();
  },

  /** Content-Type for Prometheus scrape */
  get contentType(): string {
    return register.contentType;
  },
};
