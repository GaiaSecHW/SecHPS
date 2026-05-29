import Redis, { Command } from 'ioredis';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

const STREAM_KEY = 'codeswarm:task:queue';
const CONSUMER_GROUP = 'dispatcher';
const CONSUMER_NAME = `dispatcher-${process.pid}`;

function safeJsonParse(str: string): any | null {
  try { return JSON.parse(str); } catch { return null; }
}

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
  private pendingRetryTimer: ReturnType<typeof setInterval> | null = null;
  private streamCleanupTimer: ReturnType<typeof setInterval> | null = null;

  async init() {
    if (this.initialized) return;

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      logger.warn(LOG_MODULES.CODESWARM, 'REDIS_URL 未配置，调度器未启动（降级为 DB 轮询模式）');
      this.startCleanupScheduler();
      return;
    }

    try {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: null,
        retryStrategy: (times) => {
          if (times > 3) {
            logger.warn(LOG_MODULES.CODESWARM, 'Redis 重连超过 3 次，停止重试');
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

      // 验证 Redis 数据库编号，防止 URL 解析错误导致连接到错误数据库
      try {
        const clientInfo = await this.redis.client('INFO');
        const dbMatch = clientInfo.match(/db=(\d+)/);
        const expectedDb = this.parseDbFromUrl(redisUrl);
        const actualDb = dbMatch ? parseInt(dbMatch[1]) : 0;
        if (expectedDb !== null && actualDb !== expectedDb) {
          logger.warn(LOG_MODULES.CODESWARM, `Redis 数据库不匹配: URL 指定 db=${expectedDb}, 实际连接 db=${actualDb}, 执行 SELECT ${expectedDb}`);
          await this.redis.select(expectedDb);
        }
        logger.info(LOG_MODULES.CODESWARM, `Redis 已连接 db=${actualDb}`);
      } catch (e) {
        logger.warn(LOG_MODULES.CODESWARM, 'Redis 数据库验证失败（非致命）', { details: { error: e instanceof Error ? e.message : String(e) } });
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
      logger.info(LOG_MODULES.CODESWARM, '调度器已启动，等待任务...');

      // 启动消费循环
      this.dispatchLoop();
      // 恢复可能卡在 pending 的消息（进程重启等场景）
      this.recoverPendingMessages();
      // 启动掉线检测 + 超时扫描
      this.startHealthChecks();
    } catch (e) {
      logger.warn(LOG_MODULES.CODESWARM, 'Redis 不可用，降级为 DB 轮询模式');
      logger.warn(LOG_MODULES.CODESWARM, '错误详情', { details: { error: e instanceof Error ? e.message : String(e) } });
      logger.warn(LOG_MODULES.CODESWARM, 'REDIS_URL', { details: { redisUrl } });
      this.teardownRedis();
      this.startCleanupScheduler();
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
      logger.error(LOG_MODULES.CODESWARM, 'XADD 失败', { details: { error: e instanceof Error ? e.message : String(e) } });
      return false;
    }
  }

  // 统一的分发方法：向 Worker 发送任务并更新 DB
  // 使用两阶段提交确保原子性：
  // 1. 先更新 DB 为 dispatched（Worker 收到任务后不会重复分发）
  // 2. 再发送 HTTP 请求（如果失败，DB 已是 dispatched 状态，下次调度会跳过）
  async sendTaskToWorker(task: any, worker: { id: string; address: string }): Promise<boolean> {
    // 处理逗号分隔的地址列表，按可达性优先排序（172.x > localhost > 其他 > 198.18.x）
    const addresses = worker.address.split(',').map(a => a.trim()).filter(Boolean);

    // 判断 Worker 是否本地：只看首个地址（WORKER_ADDRESS 配置的主地址）
    // address 格式："外部IP:port,172.x:port" — 首个是 Worker 主地址
    const primaryAddr = addresses[0].trim();
    const isLocalWorker = primaryAddr.startsWith('localhost') || primaryAddr.startsWith('127.');
    const callbackUrl = isLocalWorker ? 'http://localhost:3000' : (process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000');
    if (addresses.length === 0) {
      logger.error(LOG_MODULES.CODESWARM, 'Worker has no valid address', { details: { id: worker.id } });
      return false;
    }
    // Sort addresses: externally-configured addresses (from WORKER_ADDRESS) first,
    // then reachable private IPs, then Docker-internal IPs, then localhost/loopback last.
    // Docker 172.x IPs are unreachable in cross-server deployment, so deprioritize them.
    const sorted = [...addresses].sort((a, b) => {
      const score = (addr: string) => {
        if (addr.startsWith('localhost') || addr.startsWith('127.')) return 4;
        if (addr.startsWith('198.18.')) return 5;
        // Docker bridge 172.17/172.18/172.19/172.20/172.21 — usually unreachable cross-server
        if (/^172\.(17|18|19|20|21)\./.test(addr)) return 3;
        // Other 172.x (AWS VPC etc.) — may be reachable depending on network
        if (addr.startsWith('172.')) return 2;
        // Everything else (public IPs, VPN IPs, WORKER_ADDRESS) — highest priority
        return 1;
      };
      return score(a.trim()) - score(b.trim());
    });

    // 阶段 1：先更新 DB 状态（乐观锁，防止重复分发）
    // updateMany 支持 where 中带非唯一字段做条件更新
    const updateResult = await prisma.codeswarmTask.updateMany({
      where: { id: task.id, state: 'queued' },
      data: { state: 'dispatched', workerId: worker.id, startedAt: new Date(), updatedAt: new Date() },
    });
    if (updateResult.count === 0) {
      logger.info(LOG_MODULES.CODESWARM, `Task ${task.taskId} is no longer queued, skipping`);
      return true;
    }

    // 阶段 2：依次尝试多个地址发送 HTTP 请求
const taskPayload = JSON.stringify({
      taskId: task.taskId,
      instruction: task.instruction || undefined,
      projectPath: task.projectPath || undefined,
      workspacePath: task.workspacePath || undefined,
      skills: task.skills ? safeJsonParse(task.skills) : undefined,
      scripts: task.scripts ? safeJsonParse(task.scripts) : undefined,
      mcps: task.mcps ? safeJsonParse(task.mcps) : undefined,
      model: task.model || undefined,
      apiKey: task.apiKey || undefined,
      apiBaseUrl: task.apiBaseUrl || undefined,
      timeoutSec: task.timeoutSec || undefined,
      callbackUrl,
      engine: task.engine || undefined,
      agent: task.agent || undefined,
      preferredWorkerNodeId: task.preferredWorkerNodeId || undefined,
      targetProduct: task.targetProduct || undefined,
    });

    for (const addr of sorted) {
      try {
        const resp = await fetch(`http://${addr}/task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: taskPayload,
          signal: AbortSignal.timeout(10000),
        });

        if (resp.ok) {
          await prisma.codeswarmWorker.update({
            where: { id: worker.id },
            data: { currentTasks: { increment: 1 } },
          });
          logger.info(LOG_MODULES.CODESWARM, `Task ${task.taskId} dispatched to ${worker.id} via ${addr}`);
          return true;
        }

        const respBody = await resp.text().catch(() => '');
        // Worker reports task is already being executed (dedup)
        if (resp.status === 409) {
          logger.info(LOG_MODULES.CODESWARM, `Task ${task.taskId} already executing on worker, skipping duplicate`);
          return true;
        }
        if (resp.status === 400) {
          logger.error(LOG_MODULES.CODESWARM, `Task ${task.taskId} payload validation failed (400), marking as failed`, { details: { body: respBody.substring(0, 200) } });
          await prisma.codeswarmTask.update({
            where: { id: task.id },
            data: { state: 'failed', CodeswarmWorker: { disconnect: true }, error: `Payload validation failed: ${respBody.substring(0, 500)}`, updatedAt: new Date() },
          }).catch(e => logger.error(LOG_MODULES.CODESWARM, '标记任务 failed 失败', { details: { error: e instanceof Error ? e.message : String(e) } }));
          return true;
        }

        logger.warn(LOG_MODULES.CODESWARM, `Worker ${worker.id} at ${addr} returned ${resp.status}, trying next address`);
      } catch (err) {
        logger.warn(LOG_MODULES.CODESWARM, `Worker ${worker.id} at ${addr} unreachable`, { details: { error: err instanceof Error ? err.message : String(err) } });
      }
    }

// 所有地址都失败，回滚 DB 状态（仅当任务仍为 dispatched 时回滚，避免覆盖 running/completed）
    logger.error(LOG_MODULES.CODESWARM, 'All addresses failed for worker', { details: { id: worker.id, addresses: sorted.join(', ') } });
    const rollbackResult = await prisma.codeswarmTask.updateMany({
      where: { id: task.id, state: 'dispatched' },
      data: { state: 'queued', CodeswarmWorker: { disconnect: true }, updatedAt: new Date() },
    }).catch(e => { logger.error(LOG_MODULES.CODESWARM, '回滚任务状态失败', { details: { error: e instanceof Error ? e.message : String(e) } }); return { count: 0 }; });
    if (rollbackResult.count === 0) {
      logger.info(LOG_MODULES.CODESWARM, `Task ${task.taskId} rollback skipped — task no longer in dispatched state`);
    }
    return false;
  }

  // Worker 心跳：更新内存拓扑
  onHeartbeat(data: { nodeId: string; id: string; address: string; maxConcurrent: number; currentTasks?: number }) {
    const existing = this.workers.get(data.nodeId);
    // Worker 上报的 currentTasks 是权威值（Worker 自身最清楚实际运行数）
    // 直接使用上报值，不取 max：
    // 1. 避免 dispatcher 侧 phantom increment 导致的残留虚高无法被纠正
    // 2. 已分发但 Worker 尚未确认的短暂窗口（<30s）在下一次心跳自然修正
    const reportedTasks = data.currentTasks ?? 0;
    const currentTasks = reportedTasks;
    this.workers.set(data.nodeId, {
      id: data.id,
      nodeId: data.nodeId,
      address: data.address,
      maxConcurrent: data.maxConcurrent,
      currentTasks,
      lastHeartbeat: Date.now(),
    });
  }

  // 任务完成：释放 Worker 槽位（内存 + DB 同步递减，幂等性检查）
  async onTaskCompleted(nodeId: string) {
    const worker = this.workers.get(nodeId);
    if (!worker) return;

    // 内存递减：幂等性检查，避免负数
    if (worker.currentTasks > 0) {
      worker.currentTasks--;
    }

    // DB 递减：使用条件更新避免负数（与超时处理保持一致）
    await prisma.codeswarmWorker.updateMany({
      where: {
        id: worker.id,
        currentTasks: { gt: 0 },
      },
      data: { currentTasks: { decrement: 1 } },
    }).catch(() => {});
  }

  /** 同步 Worker 负载到内存（DB fallback 路径使用） */
  syncWorkerLoad(nodeId: string, currentTasks: number) {
    const worker = this.workers.get(nodeId);
    if (worker) {
      worker.currentTasks = Math.max(worker.currentTasks, currentTasks);
    }
  }

  /** 从内存拓扑中移除 Worker（地址冲突检测等场景使用） */
  removeWorker(nodeId: string) {
    const worker = this.workers.get(nodeId);
    if (worker && worker.currentTasks > 0) {
      logger.warn(LOG_MODULES.CODESWARM, `移除 Worker ${nodeId}，其 ${worker.currentTasks} 个任务将由 checkOfflineWorkers 重调度`);
    }
    this.workers.delete(nodeId);
  }

  /** 恢复卡在 pending 的消息（进程重启、之前分发失败等场景） */
  private async recoverPendingMessages() {
    if (!this.redis) return;

    try {
      // 读取当前消费者 pending 的消息（'0' 表示读取 pending 而非新消息）
      const pending = await this.redis.xreadgroup(
        'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
        'COUNT', 50,
        'STREAMS', STREAM_KEY, '0'
      ) as [string, [string, string[]][]][] | null;

      if (!pending || pending.length === 0) return;

      let recovered = 0;
      for (const [, msgs] of pending) {
        for (const [msgId, fields] of msgs) {
          const dbTaskId = fields[1];
          if (!dbTaskId) continue;

          const task = await prisma.codeswarmTask.findUnique({ where: { id: dbTaskId } });
          // 任务已非 queued 状态（已分发/完成），直接 ACK 清理
          if (!task || task.state !== 'queued') {
            await this.redis!.xack(STREAM_KEY, CONSUMER_GROUP, msgId);
            continue;
          }

          const dispatched = await this.dispatchOne(dbTaskId);
          await this.redis!.xack(STREAM_KEY, CONSUMER_GROUP, msgId);

          if (!dispatched) {
            // 分发失败，重新入队
            await this.redis!.xadd(STREAM_KEY, '*', 'dbTaskId', dbTaskId);
          }
          recovered++;
        }
      }

      if (recovered > 0) {
        logger.info(LOG_MODULES.CODESWARM, `恢复了 ${recovered} 条 pending 消息`);
      }
    } catch (e) {
      logger.error(LOG_MODULES.CODESWARM, '恢复 pending 消息失败', { details: { error: e instanceof Error ? e.message : String(e) } });
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
          await Promise.allSettled(
            msgs.map(async ([msgId, fields]) => {
              const dbTaskId = fields[1];
              if (!dbTaskId) return;

              const dispatched = await this.dispatchOne(dbTaskId);

              await this.redis!.xack(STREAM_KEY, CONSUMER_GROUP, msgId);

              if (!dispatched) {
                // Worker 全满，任务保持 queued，等待事件驱动或兜底轮询触发
                // 重新入队，让 tryDispatchNext 或兜底轮询可以捡起
                await this.redis!.xadd(STREAM_KEY, '*', 'dbTaskId', dbTaskId);
              }
            })
          );
        }
      } catch (e: any) {
        const errMsg = e?.message || String(e);
        if (errMsg.includes('NOGROUP')) {
          logger.warn(LOG_MODULES.CODESWARM, 'NOGROUP 错误，尝试重建 Consumer Group...');
          const rebuilt = await this.ensureConsumerGroup();
          if (rebuilt) {
            logger.info(LOG_MODULES.CODESWARM, 'Consumer Group 重建成功，继续消费');
          }
          await this.sleep(2000);
        } else if (errMsg.includes('too many clients') || errMsg.includes('Too many database connections')) {
          logger.warn(LOG_MODULES.CODESWARM, 'DB 连接耗尽，等待 15 秒后重试...');
          await this.sleep(15000);
        } else {
          logger.error(LOG_MODULES.CODESWARM, '消费循环错误', { details: { error: errMsg } });
          await this.sleep(2000);
        }
      }
    }
  }

  // 分发单个任务
  private async dispatchOne(dbTaskId: string): Promise<boolean> {
    try {
      const task = await prisma.codeswarmTask.findUnique({ where: { id: dbTaskId } });
      if (!task || task.state !== 'queued') return true;

      // 优先使用指定的 Worker，否则自动分配
      let worker = this.selectWorker(task.preferredWorkerNodeId ?? undefined);
      if (!worker) {
        logger.info(LOG_MODULES.CODESWARM, '指定 Worker 不可用，尝试自动分配...');
        worker = this.selectWorker();
      }
      if (!worker) {
        logger.info(LOG_MODULES.CODESWARM, '无可用 Worker，任务保持排队', { details: { taskId: task.taskId } });
        return false;
      }

      // 乐观递增：防止并行分发时多个任务选中同一 Worker
      worker.currentTasks++;
      let success = false;
      try {
        success = await this.sendTaskToWorker(task, worker);
      } catch (e) {
        worker.currentTasks--;
        throw e;
      }
      if (!success) {
        worker.currentTasks--;
        return false;
      }

      // 注册超时
      if (task.timeoutSec) {
        await this.registerTaskTimeout(dbTaskId, task.timeoutSec);
      }

      logger.info(LOG_MODULES.CODESWARM, `任务 ${task.taskId} 已分发到 ${worker.nodeId}${task.preferredWorkerNodeId ? ' (手动选择)' : ' (自动分配)'}`);
      return true;
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      if (errMsg.includes('too many clients') || errMsg.includes('Too many database connections')) {
        logger.warn(LOG_MODULES.CODESWARM, 'DB 连接耗尽，任务暂时跳过', { details: { dbTaskId } });
        this.lastDbErrorTaskId = dbTaskId;
      } else {
        logger.error(LOG_MODULES.CODESWARM, '分发失败', { details: { dbTaskId, error: e instanceof Error ? e.message : String(e) } });
      }
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
          logger.info(LOG_MODULES.CODESWARM, `使用手动选择的 Worker: ${preferredNodeId}`);
          return preferred;
        }
        logger.warn(LOG_MODULES.CODESWARM, `指定的 Worker ${preferredNodeId} 不可用`, { details: { healthy: isHealthy, capacity: hasCapacity } });
      } else {
        logger.warn(LOG_MODULES.CODESWARM, `指定的 Worker ${preferredNodeId} 未注册`);
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

  // 从 DB 恢复 Worker 拓扑（含启动时健康验证）
  private async recoverWorkersFromDB() {
    try {
      const workers = await prisma.codeswarmWorker.findMany({
        where: { status: 'online' },
        take: 200,
      });

      const onlineCount = 0;
      const offlineCount = 0;

      for (const w of workers) {
        const reachable = await this.pingWorker(w.address);
        if (reachable) {
          this.workers.set(w.nodeId, {
            id: w.id,
            nodeId: w.nodeId,
            address: w.address,
            maxConcurrent: w.maxConcurrent,
            currentTasks: w.currentTasks,
            lastHeartbeat: w.lastHeartbeat.getTime(),
          });
        } else {
          logger.warn(LOG_MODULES.CODESWARM, `Worker ${w.nodeId} at ${w.address} 启动健康检查不可达，标记 offline`);
          await prisma.codeswarmWorker.update({
            where: { id: w.id },
            data: { status: 'offline', currentTasks: 0 },
          }).catch(e => logger.error(LOG_MODULES.CODESWARM, '标记 Worker offline 失败', { details: { error: e instanceof Error ? e.message : String(e) } }));
          if (w.currentTasks > 0) {
            this.rescheduleWorkerTasksById(w.id).catch(e =>
              logger.error(LOG_MODULES.CODESWARM, 'rescheduleWorkerTasksById 失败', { details: { error: e instanceof Error ? e.message : String(e) } })
            );
          }
        }
      }

      logger.info(LOG_MODULES.CODESWARM, `从 DB 恢复 Worker: ${this.workers.size} 个可达, ${workers.length - this.workers.size} 个不可达已标记 offline`);
    } catch (e) {
      logger.error(LOG_MODULES.CODESWARM, '恢复 Worker 失败', { details: { error: e instanceof Error ? e.message : String(e) } });
    }
  }

  // 快速健康检查：向 Worker /health 端点发送 GET 请求
  private async pingWorker(address: string): Promise<boolean> {
    try {
      const resp = await fetch(`http://${address}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  private sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
  }

  private parseDbFromUrl(url: string): number | null {
    try {
      const match = url.match(/\/(\d+)(?:\?|$)/);
      return match ? parseInt(match[1]) : null;
    } catch {
      return null;
    }
  }

  private async ensureConsumerGroup(): Promise<boolean> {
    if (!this.redis) return false;
    try {
      await this.redis.xgroup('CREATE', STREAM_KEY, CONSUMER_GROUP, '0', 'MKSTREAM');
      logger.info(LOG_MODULES.CODESWARM, 'Consumer Group 已重建');
      return true;
    } catch (e: any) {
      if (e.message.includes('BUSYGROUP')) return true;
      logger.error(LOG_MODULES.CODESWARM, '重建 Consumer Group 失败', { details: { error: e instanceof Error ? e.message : String(e) } });
      return false;
    }
  }

  private lastDbErrorTaskId: string | null = null;
  private fallbackPollTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupSchedulerActive = false;

  private isDbConnectionError(dbTaskId: string): boolean {
    if (this.lastDbErrorTaskId === dbTaskId) {
      this.lastDbErrorTaskId = null;
      return true;
    }
    return false;
  }

  private redisExec(...args: (string | number | Buffer)[]): Promise<any> {
    const command = new Command(args[0] as string, args.slice(1));
    return this.redis!.sendCommand(command) as Promise<any>;
  }

  private async cleanupStaleConsumers() {
    if (!this.redis) return;

    try {
      const consumers = await this.redisExec('XINFO', 'CONSUMERS', STREAM_KEY, CONSUMER_GROUP) as any[];
      let deletedCount = 0;
      let claimedCount = 0;

      // ioredis XINFO CONSUMERS 返回扁平数组：[name, value, name, value, ...]
      for (let i = 0; i < consumers.length; i += 10) {
        const name = consumers[i + 1];
        const pending = Number(consumers[i + 3]);
        const idle = Number(consumers[i + 5]);
        const nameStr = typeof name === 'string' ? name : name?.toString() || '';

        if (nameStr === CONSUMER_NAME) continue;

        if (idle > 600_000) {
          if (pending > 0) {
            try {
              const pendingInfo = await this.redisExec(
                'XPENDING', STREAM_KEY, CONSUMER_GROUP, nameStr, '-', '+', String(pending)
              ) as any[];

              for (let j = 0; j < pendingInfo.length; j += 4) {
                const msgId = pendingInfo[j];
                if (!msgId) continue;
                const idStr = typeof msgId === 'string' ? msgId : msgId.toString();

                await this.redisExec('XCLAIM', STREAM_KEY, CONSUMER_GROUP, CONSUMER_NAME, '0', idStr);
                await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, idStr);
                claimedCount++;
              }
            } catch (claimErr) {
              logger.warn(LOG_MODULES.CODESWARM, 'claim pending 消息失败', { details: { error: claimErr instanceof Error ? claimErr.message : String(claimErr) } });
            }
          }

          try {
            await this.redisExec('XGROUP', 'DELCONSUMER', STREAM_KEY, CONSUMER_GROUP, nameStr);
            deletedCount++;
          } catch (delErr) {
            logger.warn(LOG_MODULES.CODESWARM, '删除死消费者失败', { details: { error: delErr instanceof Error ? delErr.message : String(delErr) } });
          }
        }
      }

      try {
        await this.redisExec('XTRIM', STREAM_KEY, 'MAXLEN', '~', 200);
      } catch { /* non-critical */ }

      if (deletedCount > 0 || claimedCount > 0) {
        logger.info(LOG_MODULES.CODESWARM, 'Stream 清理完成', { details: { deletedCount, claimedCount } });
      }
    } catch (e) {
      logger.error(LOG_MODULES.CODESWARM, 'Stream 清理失败', { details: { error: e instanceof Error ? e.message : String(e) } });
    }
  }

  // ---- Phase 3: 健壮性增强 ----

  // 事件驱动 + 兜底轮询：从队列取下一个任务尝试分发
  async tryDispatchNext(): Promise<void> {
    if (!this.redis || !this.running) return;

    try {
      const messages = await this.redis.xreadgroup(
        'GROUP', CONSUMER_GROUP, `${CONSUMER_NAME}-event`,
        'COUNT', 1,
        'STREAMS', STREAM_KEY, '>'
      ) as [string, [string, string[]][]][] | null;

      if (!messages || messages.length === 0) return;

      for (const [, msgs] of messages) {
        for (const [msgId, fields] of msgs) {
          const dbTaskId = fields[1];
          if (!dbTaskId) {
            await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, msgId);
            continue;
          }

          const dispatched = await this.dispatchOne(dbTaskId);
          await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, msgId);

          if (!dispatched) {
            // 仍无可用 Worker，重新入队，等待下次触发
            await this.redis.xadd(STREAM_KEY, '*', 'dbTaskId', dbTaskId);
          }
        }
      }
    } catch (e) {
      logger.warn(LOG_MODULES.CODESWARM, 'tryDispatchNext 失败', { details: { error: e instanceof Error ? e.message : String(e) } });
    }
  }

  private startFallbackPoller() {
    const INTERVAL_MS = 5 * 60 * 1000;
    this.fallbackPollTimer = setInterval(() => {
      this.tryDispatchNext().catch(e =>
        logger.warn(LOG_MODULES.CODESWARM, '兜底轮询异常', { details: { error: e instanceof Error ? e.message : String(e) } })
      );
    }, INTERVAL_MS);
  }

  private startCleanupScheduler() {
    if (this.cleanupSchedulerActive) return;

    const parsedHour = parseInt(process.env.TASK_CLEANUP_HOUR || '3', 10);
    const hour = Number.isFinite(parsedHour) && parsedHour >= 0 && parsedHour <= 23 ? parsedHour : 3;
    this.cleanupSchedulerActive = true;

    const scheduleAt = (baseTime: Date): number => {
      const target = new Date(baseTime);
      target.setHours(hour, 5, 0, 0); // HH:05:00 避开整点
      if (target <= baseTime) target.setDate(target.getDate() + 1);
      return target.getTime() - baseTime.getTime();
    };

    const scheduleNext = () => {
      if (!this.cleanupSchedulerActive) return null;
      return setTimeout(runCleanup, scheduleAt(new Date()));
    };

    const runCleanup = async () => {
      try {
        const { cleanupExpiredTasks } = await import('@/lib/task-cleanup');
        await cleanupExpiredTasks();
      } catch (e) {
        logger.error(LOG_MODULES.CODESWARM, '[TaskCleanup] 定时清理异常', { details: { error: e instanceof Error ? e.message : String(e) } });
      }

      if (!this.cleanupSchedulerActive) return;
      this.cleanupTimer = scheduleNext();
    };

    const initialDelay = scheduleAt(new Date());
    logger.info(LOG_MODULES.CODESWARM, `[TaskCleanup] 首次清理将在 ${Math.round(initialDelay / 60000)} 分钟后执行（每天 ${hour}:05）`);
    this.cleanupTimer = setTimeout(runCleanup, initialDelay);
  }

  // 启动定时任务：掉线检测 + 超时扫描
  private startHealthChecks() {
    // 启动兜底轮询：每 5 分钟尝试分发队列中的任务（防止事件回调丢失）
    this.startFallbackPoller();
    // 每 60 秒检测掉线 Worker
    this.offlineCheckTimer = setInterval(() => this.checkOfflineWorkers(), 60_000);
    // 每 30 秒扫描超时任务
    this.timeoutCheckTimer = setInterval(() => this.checkTimeoutTasks(), 30_000);
    // 每 30 秒恢复可能卡在 pending 的消息
    this.pendingRetryTimer = setInterval(() => this.recoverPendingMessages(), 30_000);
    // 每 5 分钟清理死消费者和过期 pending 消息
    this.streamCleanupTimer = setInterval(() => this.cleanupStaleConsumers(), 300_000);
    // 每日清理过期任务文件
    this.startCleanupScheduler();
  }

  // 3.1 Worker 掉线检测 + 任务重调度
  private async checkOfflineWorkers() {
    const now = Date.now();
    for (const [nodeId, worker] of this.workers) {
      if (now - worker.lastHeartbeat > 90_000) {
        logger.warn(LOG_MODULES.CODESWARM, `Worker ${nodeId} 掉线（90s 无心跳）`, { details: { currentTasks: worker.currentTasks } });

        const hadTasks = worker.currentTasks > 0;
        worker.currentTasks = 0;
        this.workers.delete(nodeId);

        if (hadTasks) {
          this.rescheduleWorkerTasks(worker).catch(e =>
            logger.error(LOG_MODULES.CODESWARM, '重调度任务失败', { details: { error: e instanceof Error ? e.message : String(e) } })
          );
        } else {
          await prisma.codeswarmWorker.update({
            where: { id: worker.id },
            data: { status: 'offline', currentTasks: 0 },
          }).catch(e => logger.error(LOG_MODULES.CODESWARM, '标记 Worker offline 失败', { details: { error: e instanceof Error ? e.message : String(e) } }));
        }
      }
    }

    // 同时检查 DB 中状态为 online 但心跳过期的 workers（处理重启后遗漏的）
    // 使用 PostgreSQL NOW() 函数，避免 JavaScript Date 时区转换问题
    try {
      const dbOfflineWorkers = await prisma.$queryRaw`
        SELECT id, "nodeId", "currentTasks"
        FROM "CodeswarmWorker"
        WHERE status = 'online'
          AND "lastHeartbeat" < NOW() - INTERVAL '90 seconds'
      ` as any[];

      for (const w of dbOfflineWorkers) {
        logger.warn(LOG_MODULES.CODESWARM, `DB Worker ${w.nodeId} 标记为 offline`);
        await prisma.codeswarmWorker.update({
          where: { id: w.id },
          data: { status: 'offline', currentTasks: 0 },
        });

        if (w.currentTasks > 0) {
          this.rescheduleWorkerTasksById(w.id).catch(e =>
            logger.error(LOG_MODULES.CODESWARM, 'rescheduleWorkerTasksById 失败', { details: { error: e instanceof Error ? e.message : String(e) } })
          );
        }
      }
    } catch (e) {
      logger.error(LOG_MODULES.CODESWARM, '检查 DB offline workers 失败', { details: { error: e instanceof Error ? e.message : String(e) } });
    }
  }

  async rescheduleWorkerTasksById(workerId: string) {
    try {
      const worker = await prisma.codeswarmWorker.findUnique({
        where: { id: workerId },
        select: { address: true },
      });

      const stuckTasks = await prisma.codeswarmTask.findMany({
        where: {
          workerId,
          state: { in: ['dispatched', 'running'] },
        },
        select: { id: true, taskId: true },
      });

      // 先向 Worker 发送取消请求，让其停止执行
      if (worker?.address) {
        const addresses = worker.address.split(',').map(a => a.trim()).filter(Boolean);
        for (const task of stuckTasks) {
          for (const addr of addresses) {
            try {
              await fetch(`http://${addr}/task/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId: task.taskId }),
                signal: AbortSignal.timeout(5000),
              });
              logger.info(LOG_MODULES.CODESWARM, `已向 Worker ${addr} 发送取消请求: ${task.taskId}`);
              break;  // 第一个可达地址成功即可
            } catch (e) {
              logger.warn(LOG_MODULES.CODESWARM, `取消请求发送失败 ${addr}`, { details: { error: e instanceof Error ? e.message : String(e) } });
            }
          }
        }
      }

      for (const task of stuckTasks) {
        await prisma.codeswarmTask.update({
          where: { id: task.id },
          data: {
            state: 'queued',
            CodeswarmWorker: { disconnect: true },
            preferredWorkerNodeId: null,  // 清理：原 Worker 已掉线
            updatedAt: new Date()
          },
        });

        if (this.redis) {
          await this.redis.xadd(STREAM_KEY, '*', 'dbTaskId', task.id);
        }

        logger.info(LOG_MODULES.CODESWARM, `任务 ${task.taskId} 已重新入队`);
      }
    } catch (e) {
      logger.error(LOG_MODULES.CODESWARM, 'rescheduleWorkerTasksById 异常', { details: { error: e instanceof Error ? e.message : String(e) } });
    }
  }

  private async rescheduleWorkerTasks(worker: WorkerInfo) {
    try {
      const addresses = worker.address.split(',').map(a => a.trim()).filter(Boolean);

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
        // 尝试向 Worker 发送 cancel 请求（多地址 failover）
        for (const addr of addresses) {
          try {
            await fetch(`http://${addr}/task/cancel`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId: task.taskId }),
              signal: AbortSignal.timeout(5000),
            });
            break;
          } catch { /* Worker 可能已离线 */ }
        }

        // 改回 queued
        await prisma.codeswarmTask.update({
          where: { id: task.id },
          data: {
            state: 'queued',
            CodeswarmWorker: { disconnect: true },
            preferredWorkerNodeId: null,
            updatedAt: new Date()
          },
        });

        // 重新提交到 Redis Stream
        if (this.redis) {
          await this.redis.xadd(STREAM_KEY, '*', 'dbTaskId', task.id);
        }

        logger.info(LOG_MODULES.CODESWARM, `任务 ${task.taskId} 已重新入队`);
      }
    } catch (e) {
      logger.error(LOG_MODULES.CODESWARM, 'rescheduleWorkerTasks 异常', { details: { error: e instanceof Error ? e.message : String(e) } });
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
        // 使用原子性条件更新：只有 running/dispatched 状态的任务才能被标记为超时
        // 这避免了与正常完成路径的竞态条件
        const updateResult = await prisma.codeswarmTask.updateMany({
          where: {
            id: dbTaskId,
            state: { in: ['running', 'dispatched'] },
          },
          data: {
            state: 'failed',
            error: 'Task timeout',
            completedAt: new Date(),
            updatedAt: new Date(),
          },
        });

        // 如果更新成功（count > 0），说明任务确实被我们标记为超时
        // 此时需要释放 Worker 槽位
        if (updateResult.count > 0) {
          // 获取 workerId 用于释放槽位
          const task = await prisma.codeswarmTask.findUnique({
            where: { id: dbTaskId },
            select: { taskId: true, workerId: true },
          });

          if (task) {
            logger.warn(LOG_MODULES.CODESWARM, `任务 ${task.taskId} 超时，标记为 failed`);

            // 释放 Worker 槽位（幂等性检查）
            if (task.workerId) {
              const workerEntry = [...this.workers.values()].find(w => w.id === task.workerId);
              // 内存递减：幂等性检查，避免负数
              if (workerEntry && workerEntry.currentTasks > 0) {
                workerEntry.currentTasks--;
              }
              // DB 递减：使用条件更新避免负数
              await prisma.codeswarmWorker.updateMany({
                where: {
                  id: task.workerId,
                  currentTasks: { gt: 0 },
                },
                data: { currentTasks: { decrement: 1 } },
              }).catch(() => {});
            }

            // 发布超时事件
            await this.publishTaskEvent(task.taskId, { type: 'task_timeout', status: 'failed' });
          }
        }

        // 无论是否成功标记超时，都移除超时记录（已完成的任务也需要清理）
        await this.redis.zrem('codeswarm:task:timeouts', dbTaskId);
      }
    } catch (e) {
      logger.error(LOG_MODULES.CODESWARM, '超时扫描异常', { details: { error: e instanceof Error ? e.message : String(e) } });
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
    this.cleanupSchedulerActive = false;
    if (this.offlineCheckTimer) clearInterval(this.offlineCheckTimer);
    if (this.timeoutCheckTimer) clearInterval(this.timeoutCheckTimer);
    if (this.pendingRetryTimer) clearInterval(this.pendingRetryTimer);
    if (this.streamCleanupTimer) clearInterval(this.streamCleanupTimer);
    if (this.fallbackPollTimer) clearInterval(this.fallbackPollTimer);
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    this.teardownRedis();
  }
}

export const codeswarmDispatcher = new CodeswarmDispatcher();