import Redis from 'ioredis';
import { prisma } from '@/lib/prisma';

const STREAM_KEY = 'codeswarm:task:queue';
const CONSUMER_GROUP = 'dispatcher';
const CONSUMER_NAME = `dispatcher-${process.pid}`;

interface WorkerInfo {
  id: string;
  nodeId: string;
  address: string;
  maxConcurrent: number;
  currentTasks: number;
  lastHeartbeat: number;
}

class CodeswarmDispatcher {
  private workers = new Map<string, WorkerInfo>();
  private redis: Redis | null = null;
  private publisher: Redis | null = null;
  private running = false;
  private initialized = false;
  private offlineCheckTimer: ReturnType<typeof setInterval> | null = null;
  private timeoutCheckTimer: ReturnType<typeof setInterval> | null = null;

  async init() {
    if (this.initialized) return;

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      console.warn('[CodeSwarm] REDIS_URL 未配置，调度器未启动（降级为 DB 轮询模式）');
      return;
    }

    try {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: null,
        retryStrategy: (times) => {
          if (times > 3) {
            console.warn('[CodeSwarm] Redis 重连超过 3 次，停止重试');
            return null;
          }
          return Math.min(times * 1000, 5000);
        },
        lazyConnect: true,
      });
      this.redis.on('error', () => {}); // 静默处理连接错误事件

      this.publisher = new Redis(redisUrl, {
        retryStrategy: () => null,
        lazyConnect: true,
      });
      this.publisher.on('error', () => {});

      try {
        await this.redis.ping();
      } catch {
        throw new Error('Redis 连接失败');
      }

      // 创建消费者组（如果不存在）
      try {
        await this.redis.xgroup('CREATE', STREAM_KEY, CONSUMER_GROUP, '0', 'MKSTREAM');
      } catch (e: any) {
        if (!e.message.includes('BUSYGROUP')) throw e;
      }

      // 从 DB 恢复 Worker 拓扑
      await this.recoverWorkersFromDB();

      this.running = true;
      this.initialized = true;
      console.log('[CodeSwarm] 调度器已启动，等待任务...');

      // 启动消费循环
      this.dispatchLoop();
      // 启动掉线检测 + 超时扫描
      this.startHealthChecks();
    } catch (e) {
      console.warn('[CodeSwarm] Redis 不可用，降级为 DB 轮询模式');
      console.warn('[CodeSwarm] 错误详情:', e);
      console.warn('[CodeSwarm] REDIS_URL:', redisUrl);
      this.teardownRedis();
    }
  }

  get isAvailable(): boolean {
    return this.initialized && this.redis !== null;
  }

  // 提交任务到 Redis Stream
  async submitTask(dbTaskId: string): Promise<boolean> {
    if (!this.redis) return false;

    try {
      await this.redis.xadd(STREAM_KEY, '*', 'dbTaskId', dbTaskId);
      return true;
    } catch (e) {
      console.error('[CodeSwarm] XADD 失败:', e);
      return false;
    }
  }

  // 统一的分发方法：向 Worker 发送任务并更新 DB
  async sendTaskToWorker(task: any, worker: { id: string; address: string }): Promise<boolean> {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    try {
      const resp = await fetch(`http://${worker.address}/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task.taskId,
          instruction: task.instruction,
          projectPath: task.projectPath || '',
          workspacePath: task.workspacePath || undefined,
          skills: task.skills ? JSON.parse(task.skills) : undefined,
          scripts: task.scripts ? JSON.parse(task.scripts) : undefined,
          mcps: task.mcps ? JSON.parse(task.mcps) : undefined,
          model: task.model || undefined,
          apiKey: task.apiKey || undefined,
          timeoutSec: task.timeoutSec || undefined,
          callbackUrl: baseUrl,
          gitUrl: task.gitUrl || undefined,
          gitRef: task.gitRef || undefined,
          agent: task.agent || undefined,
defaultAgentName: task.defaultAgentName || undefined,
          startCommand: task.startCommand || undefined,
          preferredWorkerNodeId: task.preferredWorkerNodeId || undefined,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!resp.ok) return false;

      await prisma.codeswarmTask.update({
        where: { id: task.id },
        data: { state: 'dispatched', workerId: worker.id, startedAt: new Date(), updatedAt: new Date() },
      });
      await prisma.codeswarmWorker.update({
        where: { id: worker.id },
        data: { currentTasks: { increment: 1 } },
      });

      console.log(`[CodeSwarm] Task ${task.taskId} dispatched to ${worker.id}`);
      return true;
    } catch (error) {
      console.error(`[CodeSwarm] Dispatch error for task ${task.taskId}:`, error);
      return false;
    }
  }

  // Worker 心跳：更新内存拓扑
  onHeartbeat(data: { nodeId: string; id: string; address: string; maxConcurrent: number; currentTasks?: number }) {
    const existing = this.workers.get(data.nodeId);
    this.workers.set(data.nodeId, {
      id: data.id,
      nodeId: data.nodeId,
      address: data.address,
      maxConcurrent: data.maxConcurrent,
      // 编排器追踪的 currentTasks 优先，首次注册时用 Worker 上报的值
      currentTasks: existing?.currentTasks ?? (data.currentTasks || 0),
      lastHeartbeat: Date.now(),
    });
  }

  // 任务完成：释放 Worker 槽位
  onTaskCompleted(nodeId: string) {
    const worker = this.workers.get(nodeId);
    if (worker && worker.currentTasks > 0) {
      worker.currentTasks--;
    }
  }

  // 消费循环
  private async dispatchLoop() {
    if (!this.redis || !this.running) return;

    while (this.running) {
      try {
        const messages = await this.redis.xreadgroup(
          'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
          'COUNT', 5,
          'BLOCK', 5000,
          'STREAMS', STREAM_KEY, '>'
        ) as [string, [string, string[]][]][] | null;

        if (!messages || messages.length === 0) continue;

        for (const [, msgs] of messages) {
          for (const [msgId, fields] of msgs) {
            const dbTaskId = fields[1]; // fields = ['dbTaskId', value]
            if (!dbTaskId) continue;

            const dispatched = await this.dispatchOne(dbTaskId);

            if (dispatched) {
              await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, msgId);
            }
            // 分发失败不 ACK，消息会在一段时间后被重新投递
          }
        }
      } catch (e) {
        console.error('[CodeSwarm] 消费循环错误:', e);
        await this.sleep(2000);
      }
    }
  }

  // 分发单个任务
  private async dispatchOne(dbTaskId: string): Promise<boolean> {
    try {
      const task = await prisma.codeswarmTask.findUnique({ where: { id: dbTaskId } });
      if (!task || task.state !== 'queued') return true;

      // 优先使用指定的 Worker，否则自动分配
      let worker = this.selectWorker(task.preferredWorkerNodeId);
      if (!worker) {
        console.log('[CodeSwarm] 指定 Worker 不可用，尝试自动分配...');
        worker = this.selectWorker();
      }
      if (!worker) {
        console.log('[CodeSwarm] 无可用 Worker，任务保持排队:', task.taskId);
        return false;
      }

      const success = await this.sendTaskToWorker(task, worker);
      if (!success) return false;

      // 注册超时
      if (task.timeoutSec) {
        await this.registerTaskTimeout(dbTaskId, task.timeoutSec);
      }

      // 更新内存
      worker.currentTasks++;

      console.log(`[CodeSwarm] 任务 ${task.taskId} 已分发到 ${worker.nodeId}${task.preferredWorkerNodeId ? ' (手动选择)' : ' (自动分配)'}`);
      return true;
    } catch (e) {
      console.error('[CodeSwarm] 分发失败:', dbTaskId, e);
      return false;
    }
  }

  // 最少负载优先选择 Worker，可指定优先节点
  private selectWorker(preferredNodeId?: string): WorkerInfo | null {
    // 如果指定了优先节点，且该节点可用，直接使用
    if (preferredNodeId) {
      const preferred = this.workers.get(preferredNodeId);
      if (preferred) {
        const isHealthy = Date.now() - preferred.lastHeartbeat <= 90000;
        const hasCapacity = preferred.currentTasks < preferred.maxConcurrent;
        if (isHealthy && hasCapacity) {
          console.log(`[CodeSwarm] 使用手动选择的 Worker: ${preferredNodeId}`);
          return preferred;
        }
        console.warn(`[CodeSwarm] 指定的 Worker ${preferredNodeId} 不可用 (健康=${isHealthy}, 容量=${hasCapacity})`);
      } else {
        console.warn(`[CodeSwarm] 指定的 Worker ${preferredNodeId} 未注册`);
      }
    }

    // 自动分配：最少负载优先
    let best: WorkerInfo | null = null;
    for (const w of this.workers.values()) {
      if (Date.now() - w.lastHeartbeat > 90000) continue; // 90s 无心跳视为离线
      if (w.currentTasks >= w.maxConcurrent) continue;
      if (!best || w.currentTasks < best.currentTasks) best = w;
    }
    return best;
  }

  // 发布任务状态变更事件（给 Task Builder 等订阅者）
  async publishTaskEvent(taskId: string, event: { type: string; status?: string; data?: any }) {
    if (!this.publisher) return;
    try {
      await this.publisher.publish(`codeswarm:task:${taskId}`, JSON.stringify(event));
    } catch { /* non-critical */ }
  }

  // 从 DB 恢复 Worker 拓扑
  private async recoverWorkersFromDB() {
    try {
      const workers = await prisma.codeswarmWorker.findMany({
        where: { status: 'online' },
        take: 200,
      });
      for (const w of workers) {
        this.workers.set(w.nodeId, {
          id: w.id,
          nodeId: w.nodeId,
          address: w.address,
          maxConcurrent: w.maxConcurrent,
          currentTasks: w.currentTasks,
          lastHeartbeat: w.lastHeartbeat.getTime(),
        });
      }
      console.log(`[CodeSwarm] 从 DB 恢复 ${workers.length} 个 Worker`);
    } catch (e) {
      console.error('[CodeSwarm] 恢复 Worker 失败:', e);
    }
  }

  private sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ---- Phase 3: 健壮性增强 ----

  // 启动定时任务：掉线检测 + 超时扫描
  private startHealthChecks() {
    // 每 60 秒检测掉线 Worker
    this.offlineCheckTimer = setInterval(() => this.checkOfflineWorkers(), 60_000);
    // 每 30 秒扫描超时任务
    this.timeoutCheckTimer = setInterval(() => this.checkTimeoutTasks(), 30_000);
  }

  // 3.1 Worker 掉线检测 + 任务重调度
  private async checkOfflineWorkers() {
    const now = Date.now();
    for (const [nodeId, worker] of this.workers) {
      if (now - worker.lastHeartbeat > 90_000) {
        console.warn(`[CodeSwarm] Worker ${nodeId} 掉线（90s 无心跳），currentTasks=${worker.currentTasks}`);

        const hadTasks = worker.currentTasks > 0;
        worker.currentTasks = 0;
        this.workers.delete(nodeId);

        if (hadTasks) {
          try {
            await fetch(`http://${worker.address}/task/cancel`, {
              method: 'POST',
              signal: AbortSignal.timeout(5000),
            });
          } catch { /* Worker 可能已离线 */ }
          this.rescheduleWorkerTasks(worker).catch(e =>
            console.error('[CodeSwarm] 重调度任务失败:', e)
          );
        } else {
          await prisma.codeswarmWorker.update({
            where: { id: worker.id },
            data: { status: 'offline', currentTasks: 0 },
          }).catch(() => {});
        }
      }
    }

    // 同时检查 DB 中状态为 online 但心跳过期的 workers（处理重启后遗漏的）
    try {
      const dbOfflineWorkers = await prisma.codeswarmWorker.findMany({
        where: {
          status: 'online',
          lastHeartbeat: { lt: new Date(now - 90_000) },
        },
        select: { id: true, nodeId: true, currentTasks: true },
      });

      for (const w of dbOfflineWorkers) {
        console.warn(`[CodeSwarm] DB Worker ${w.nodeId} 标记为 offline`);
        await prisma.codeswarmWorker.update({
          where: { id: w.id },
          data: { status: 'offline', currentTasks: 0 },
        });

        if (w.currentTasks > 0) {
          this.rescheduleWorkerTasksById(w.id).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[CodeSwarm] 检查 DB offline workers 失败:', e);
    }
  }

  private async rescheduleWorkerTasksById(workerId: string) {
    try {
      const stuckTasks = await prisma.codeswarmTask.findMany({
        where: {
          workerId,
          state: { in: ['dispatched', 'running'] },
        },
        select: { id: true, taskId: true },
      });

      for (const task of stuckTasks) {
        await prisma.codeswarmTask.update({
          where: { id: task.id },
          data: { state: 'queued', workerId: null, updatedAt: new Date() },
        });

        if (this.redis) {
          await this.redis.xadd(STREAM_KEY, '*', 'dbTaskId', task.id);
        }

        console.log(`[CodeSwarm] 任务 ${task.taskId} 已重新入队`);
      }
    } catch (e) {
      console.error('[CodeSwarm] rescheduleWorkerTasksById 异常:', e);
    }
  }

  private async rescheduleWorkerTasks(worker: WorkerInfo) {
    try {
      // 更新 DB：Worker 离线
      await prisma.codeswarmWorker.update({
        where: { id: worker.id },
        data: { status: 'offline', currentTasks: 0 },
      });

      // 查找该 Worker 上未完成的任务
      const stuckTasks = await prisma.codeswarmTask.findMany({
        where: {
          workerId: worker.id,
          state: { in: ['dispatched', 'running'] },
        },
        select: { id: true, taskId: true },
      });

      for (const task of stuckTasks) {
        // 改回 queued
        await prisma.codeswarmTask.update({
          where: { id: task.id },
          data: { state: 'queued', workerId: null, updatedAt: new Date() },
        });

        // 重新提交到 Redis Stream
        if (this.redis) {
          await this.redis.xadd(STREAM_KEY, '*', 'dbTaskId', task.id);
        }

        console.log(`[CodeSwarm] 任务 ${task.taskId} 已重新入队`);
      }
    } catch (e) {
      console.error('[CodeSwarm] rescheduleWorkerTasks 异常:', e);
    }
  }

  // 3.2 任务超时处理
  private async checkTimeoutTasks() {
    if (!this.redis) return;

    try {
      const now = Date.now();
      // 查询超时的任务 ID
      const timeouted = await this.redis.zrangebyscore('codeswarm:task:timeouts', 0, now);
      if (timeouted.length === 0) return;

      for (const dbTaskId of timeouted) {
        const task = await prisma.codeswarmTask.findUnique({
          where: { id: dbTaskId },
          select: { taskId: true, state: true, workerId: true },
        });

        if (!task || ['completed', 'failed'].includes(task.state)) {
          // 已结束，移除超时记录
          await this.redis.zrem('codeswarm:task:timeouts', dbTaskId);
          continue;
        }

        console.warn(`[CodeSwarm] 任务 ${task.taskId} 超时，标记为 failed`);

        await prisma.codeswarmTask.update({
          where: { id: dbTaskId },
          data: {
            state: 'failed',
            error: 'Task timeout',
            completedAt: new Date(),
            updatedAt: new Date(),
          },
        });

        // 释放 Worker 槽位
        if (task.workerId) {
          const workerEntry = [...this.workers.values()].find(w => w.id === task.workerId);
          if (workerEntry && workerEntry.currentTasks > 0) {
            workerEntry.currentTasks--;
          }
          await prisma.codeswarmWorker.update({
            where: { id: task.workerId },
            data: { currentTasks: { decrement: 1 } },
          }).catch(() => {});
        }

        // 发布超时事件
        await this.publishTaskEvent(task.taskId, { type: 'task_timeout', status: 'failed' });

        // 移除超时记录
        await this.redis.zrem('codeswarm:task:timeouts', dbTaskId);
      }
    } catch (e) {
      console.error('[CodeSwarm] 超时扫描异常:', e);
    }
  }

  // 注册任务超时（任务分发时调用）
  async registerTaskTimeout(dbTaskId: string, timeoutSec: number) {
    if (!this.redis || !timeoutSec) return;
    const deadline = Date.now() + timeoutSec * 1000;
    await this.redis.zadd('codeswarm:task:timeouts', deadline, dbTaskId);
  }

  private teardownRedis() {
    if (this.redis) {
      this.redis.removeAllListeners();
      this.redis.disconnect();
    }
    if (this.publisher) {
      this.publisher.removeAllListeners();
      this.publisher.disconnect();
    }
    this.redis = null;
    this.publisher = null;
  }

  // 优雅关闭
  async shutdown() {
    this.running = false;
    if (this.offlineCheckTimer) clearInterval(this.offlineCheckTimer);
    if (this.timeoutCheckTimer) clearInterval(this.timeoutCheckTimer);
    this.teardownRedis();
  }
}

export const codeswarmDispatcher = new CodeswarmDispatcher();
