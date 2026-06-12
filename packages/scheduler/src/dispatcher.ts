/**
 * CodeSwarm Scheduler — Dispatcher
 *
 * Migrated from src/services/codeswarm-dispatcher.ts (Next.js platform).
 * Core scheduling logic preserved: Redis Stream consumer, Worker topology,
 * two-phase atomic dispatch, offline/timeout/stuck/zombie detection, DB fallback.
 *
 * Platform coupling removed:
 *   - No Next.js imports; uses local prisma/logger
 *   - No TaskInstance / eventBus / TaskExecutionLog / ModelConfig
 *   - Platform notified via HTTP callback on task completion/failure
 */
import Redis, { Command } from 'ioredis';
import { prisma, withDeadlockRetry, type TransactionClient } from './prisma.js';
import { logger } from './logger.js';

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
  status?: string;
}

export class CodeswarmDispatcher {
  private workers = new Map<string, WorkerInfo>();
  private redis: Redis | null = null;
  private publisher: Redis | null = null;
  private running = false;
  private initialized = false;
  private offlineCheckTimer: ReturnType<typeof setInterval> | null = null;
  private timeoutCheckTimer: ReturnType<typeof setInterval> | null = null;
  private pendingRetryTimer: ReturnType<typeof setInterval> | null = null;
  private streamCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private dispatchedStuckTimer: ReturnType<typeof setInterval> | null = null;
  private dbQueuedScanTimer: ReturnType<typeof setInterval> | null = null;
  private zombieCheckTimer: ReturnType<typeof setInterval> | null = null;

  private lastNoWorkerLogTime = 0;
  private lastPreferredUnavailableLogTime = 0;
  private lastNoWorkerLogInterval = 30_000; // 30s — fast detection of dispatch stalls
  private lastPreferredUnavailableLogInterval = 30_000; // 30s — fast detection of dispatch stalls
  private lastDbErrorTaskId: string | null = null;

  private fallbackPollTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupSchedulerActive = false;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async init() {
    if (this.initialized) return;

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      logger.error('REDIS_URL not configured, scheduler not started (falling back to DB poll mode)');
      this.startCleanupScheduler();
      return;
    }

    try {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: null,
        retryStrategy: (times: number) => {
          if (times > 3) {
            logger.warn('Redis reconnect exceeded 3 attempts, stopping retry');
            return null;
          }
          return Math.min(times * 1000, 5000);
        },
        lazyConnect: true,
      });
      this.redis.on('error', () => {}); // silence connection error events

      this.publisher = new Redis(redisUrl, {
        retryStrategy: () => null,
        lazyConnect: true,
      });
      this.publisher.on('error', () => {});

      try {
        await this.redis.ping();
      } catch {
        throw new Error('Redis connection failed');
      }

      // Validate Redis database number to prevent URL parsing errors
      try {
        const clientInfo = await this.redis.client('INFO');
        const dbMatch = clientInfo.match(/db=(\d+)/);
        const expectedDb = this.parseDbFromUrl(redisUrl);
        const actualDb = dbMatch ? parseInt(dbMatch[1]) : 0;
        if (expectedDb !== null && actualDb !== expectedDb) {
          logger.warn(`Redis DB mismatch: URL specifies db=${expectedDb}, connected to db=${actualDb}, executing SELECT ${expectedDb}`);
          await this.redis.select(expectedDb);
        }
        logger.info(`Redis connected db=${actualDb}`);
      } catch (e) {
        logger.warn(`Redis DB validation failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
      }

      // Create consumer group if it doesn't exist
      try {
        await this.redis.xgroup('CREATE', STREAM_KEY, CONSUMER_GROUP, '0', 'MKSTREAM');
      } catch (e: any) {
        if (!e.message.includes('BUSYGROUP')) throw e;
      }

      // Recover Worker topology from DB
      await this.recoverWorkersFromDB();

      this.running = true;
      this.initialized = true;
      logger.info('Scheduler started, waiting for tasks...');

      // Start consumption loop
      this.dispatchLoop();
      // Recover messages stuck in pending (process restart scenario)
      this.recoverPendingMessages();
      // Start health checks + background timers
      this.startHealthChecks();
    } catch (e) {
      logger.error(`Redis unavailable, falling back to DB poll mode: ${e instanceof Error ? e.message : String(e)}`);
      logger.error(`REDIS_URL=${redisUrl}`);
      this.teardownRedis();
      this.startCleanupScheduler();
    }
  }

  get isAvailable(): boolean {
    return this.initialized && this.redis !== null;
  }

  async destroy() {
    this.running = false;
    this.cleanupSchedulerActive = false;
    if (this.offlineCheckTimer) clearInterval(this.offlineCheckTimer);
    if (this.timeoutCheckTimer) clearInterval(this.timeoutCheckTimer);
    if (this.pendingRetryTimer) clearInterval(this.pendingRetryTimer);
    if (this.streamCleanupTimer) clearInterval(this.streamCleanupTimer);
    if (this.dispatchedStuckTimer) clearInterval(this.dispatchedStuckTimer);
    if (this.dbQueuedScanTimer) clearInterval(this.dbQueuedScanTimer);
    if (this.zombieCheckTimer) clearInterval(this.zombieCheckTimer);
    if (this.fallbackPollTimer) clearInterval(this.fallbackPollTimer);
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    this.teardownRedis();
    this.initialized = false;
  }

  // ---------------------------------------------------------------------------
  // Task submission & cancellation
  // ---------------------------------------------------------------------------

  /** Submit a task — creates DB record and pushes to Redis Stream */
  async submitTask(payload: {
    taskId: string;
    instruction?: string;
    projectPath?: string;
    workspacePath?: string;
    gitUrl?: string;
    gitRef?: string;
    skills?: string;
    scripts?: string;
    mcps?: string;
    model?: string;
    apiKey?: string;
    timeoutSec?: number;
    engine?: string;
    agent?: string;
    preferredWorkerNodeId?: string;
    targetProduct?: string;
    apiBaseUrl?: string;
    maxTokens?: number;
    contextWindow?: number;
    env?: string;
    platformTaskId?: string;
    platformCallbackUrl?: string;
    // Tool dispatch fields
    toolId?: string;
    toolTaskId?: string;
    toolPath?: string;
    toolWorkDir?: string;
  }): Promise<{ id: string } | null> {
    try {
      const task = await prisma.codeswarmTask.create({
        data: {
          taskId: payload.taskId,
          instruction: payload.instruction,
          projectPath: payload.projectPath,
          workspacePath: payload.workspacePath,
          gitUrl: payload.gitUrl,
          gitRef: payload.gitRef,
          skills: payload.skills,
          scripts: payload.scripts,
          mcps: payload.mcps,
          model: payload.model,
          apiKey: payload.apiKey,
          timeoutSec: payload.timeoutSec,
          engine: payload.engine,
          agent: payload.agent,
          preferredWorkerNodeId: payload.preferredWorkerNodeId,
          targetProduct: payload.targetProduct,
          apiBaseUrl: payload.apiBaseUrl,
          maxTokens: payload.maxTokens,
          contextWindow: payload.contextWindow,
          env: payload.env,
          platformTaskId: payload.platformTaskId,
          platformCallbackUrl: payload.platformCallbackUrl,
          // Tool dispatch fields
          toolId: payload.toolId,
          toolTaskId: payload.toolTaskId,
          toolPath: payload.toolPath,
          toolWorkDir: payload.toolWorkDir,
          state: 'queued',
        },
      });

      if (this.redis) {
        await this.redis.xadd(STREAM_KEY, '*', 'dbTaskId', task.id);
      }

      logger.info(`Task ${task.taskId} submitted (dbId=${task.id})`);
      return { id: task.id };
    } catch (e) {
      logger.error(`Failed to submit task ${payload.taskId}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /**
   * Enqueue an already-created DB task to Redis Stream for dispatch.
   *
   * Use this when the DB record was created elsewhere (e.g. in the HTTP route
   * handler) to avoid a duplicate insert. submitTask() also creates the DB
   * record, so calling it on an existing task triggers a unique-constraint
   * failure that silently drops the Stream message — tasks then never dispatch.
   */
  async enqueueExistingTask(dbTaskId: string): Promise<boolean> {
    if (!this.redis) {
      logger.warn(`Redis unavailable, task ${dbTaskId} stays queued (DB scan will pick it up)`);
      return false;
    }
    try {
      await this.redis.xadd(STREAM_KEY, '*', 'dbTaskId', dbTaskId);
      logger.info(`Task ${dbTaskId} enqueued to Redis Stream`);
      return true;
    } catch (e) {
      logger.error(`Failed to enqueue task ${dbTaskId}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /** Cancel a task — marks DB as cancelled and notifies Worker */
  async cancelTask(taskId: string): Promise<boolean> {
    try {
      const task = await prisma.codeswarmTask.findUnique({
        where: { taskId },
        select: { id: true, state: true, workerId: true },
      });
      if (!task) return false;

      // Only cancel tasks in active states
      if (!['queued', 'dispatched', 'running'].includes(task.state)) return false;

      const txResult = await withDeadlockRetry(() => prisma.$transaction(async (tx: TransactionClient) => {
        const updateResult = await tx.codeswarmTask.updateMany({
          where: { id: task.id, state: { in: ['queued', 'dispatched', 'running'] } },
          data: {
            state: 'cancelled',
            completedAt: new Date(),
            updatedAt: new Date(),
          },
        });

        if (updateResult.count > 0 && task.workerId) {
          await tx.codeswarmWorker.updateMany({
            where: { id: task.workerId, currentTasks: { gt: 0 } },
            data: { currentTasks: { decrement: 1 } },
          });
        }

        return { updated: updateResult.count > 0, workerId: task.workerId };
      }));

      if (txResult.updated) {
        // Release in-memory Worker slot
        if (txResult.workerId) {
          const workerEntry = [...this.workers.values()].find(w => w.id === txResult.workerId);
          if (workerEntry && workerEntry.currentTasks > 0) {
            workerEntry.currentTasks--;
          }
        }

        // Send cancel request to Worker
        if (task.workerId) {
          const worker = await prisma.codeswarmWorker.findUnique({
            where: { id: task.workerId },
            select: { address: true },
          });
          if (worker?.address) {
            const addresses = worker.address.split(',').map(a => a.trim()).filter(Boolean);
            for (const addr of addresses) {
              try {
                await fetch(`http://${addr}/task/cancel`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ taskId }),
                  signal: AbortSignal.timeout(5000),
                });
                break; // first reachable address is enough
              } catch { /* Worker may be offline */ }
            }
          }
        }

        // Remove from Redis timeout sorted set
        if (this.redis) {
          await this.redis.zrem('codeswarm:task:timeouts', task.id);
        }

        logger.info(`Task ${taskId} cancelled`);
      }

      return txResult.updated;
    } catch (e) {
      logger.error(`Failed to cancel task ${taskId}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Platform callback
  // ---------------------------------------------------------------------------

  private async notifyPlatform(task: {
    taskId: string;
    platformTaskId: string | null;
    platformCallbackUrl: string | null;
    state: string;
    result: string | null;
    error: string | null;
    reportContent: string | null;
  }): Promise<void> {
    if (!task.platformCallbackUrl || !task.platformTaskId) return;
    try {
      await fetch(task.platformCallbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: task.state === 'completed' ? 'task_completed' : 'task_failed',
          taskId: task.taskId,
          platformTaskId: task.platformTaskId,
          status: task.state === 'completed' ? 'completed' : 'failed',
          result: task.result,
          error: task.error,
          reportContent: task.reportContent,
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      logger.error(`[Callback] Failed for task ${task.taskId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Worker topology management
  // ---------------------------------------------------------------------------

  /**
   * Worker heartbeat — selectively update in-memory topology.
   * currentTasks is managed by dispatcher via optimistic increment (dispatch)
   * and decrement (complete/timeout/offline), not overwritten by heartbeat
   * to prevent stale heartbeats from erasing increments or rollbacks.
   */
  onHeartbeat(data: {
    nodeId: string;
    id: string;
    address: string;
    maxConcurrent: number;
    currentTasks?: number;
    status?: string;
  }) {
    const existing = this.workers.get(data.nodeId);
    const isNewWorker = !existing;
    if (existing) {
      existing.id = data.id;
      existing.address = data.address;
      existing.maxConcurrent = data.maxConcurrent;
      existing.lastHeartbeat = Date.now();
      existing.status = data.status;
      // Worker semaphore is the real-time truth source — correct memory drift
      // but never exceed maxConcurrent (prevent permanent full-load drift)
      if (typeof data.currentTasks === 'number') {
        existing.currentTasks = Math.min(data.currentTasks, existing.maxConcurrent);
      }
    } else {
      this.workers.set(data.nodeId, {
        id: data.id,
        nodeId: data.nodeId,
        address: data.address,
        maxConcurrent: data.maxConcurrent,
        currentTasks: data.currentTasks ?? 0,
        lastHeartbeat: Date.now(),
        status: data.status,
      });
      logger.info(`Worker ${data.nodeId} joined topology (address=${data.address}, maxConcurrent=${data.maxConcurrent})`);
    }

    // New Worker registration: immediately dispatch queued tasks instead of
    // waiting for the 5s BLOCK cycle or the 30s DB scan fallback.
    if (isNewWorker && this.running) {
      this.dispatchQueuedTasksNow().catch((e: unknown) =>
        logger.warn(`Immediate dispatch after new worker heartbeat failed: ${e instanceof Error ? e.message : String(e)}`)
      );
    }
  }

  /** Task completed — only update in-memory load (DB decrement handled by caller's transaction) */
  async onTaskCompleted(nodeId: string) {
    const worker = this.workers.get(nodeId);
    if (!worker) return;
    if (worker.currentTasks > 0) {
      worker.currentTasks--;
    }
  }

  /** In-memory load decrement (for result callback etc. — DB decrement already done in transaction) */
  decrementWorkerMemoryLoad(nodeId: string) {
    const worker = this.workers.get(nodeId);
    if (worker && worker.currentTasks > 0) {
      worker.currentTasks--;
    }
  }

  /** Sync Worker load to memory (DB fallback path) */
  syncWorkerLoad(nodeId: string, currentTasks: number) {
    const worker = this.workers.get(nodeId);
    if (worker) {
      worker.currentTasks = currentTasks;
    }
  }

  /** Update Worker maxConcurrent (immediately effective when admin changes on Dashboard) */
  updateWorkerMaxConcurrent(nodeId: string, maxConcurrent: number) {
    const worker = this.workers.get(nodeId);
    if (worker) {
      worker.maxConcurrent = maxConcurrent;
      logger.info(`Worker ${nodeId} maxConcurrent updated to ${maxConcurrent}`);
    }
  }

  /** Push maxConcurrent change to Worker immediately, don't wait for 30s heartbeat */
  async pushMaxConcurrentToWorker(nodeId: string, maxConcurrent: number): Promise<boolean> {
    const memoryWorker = this.workers.get(nodeId);
    const dbWorker = await prisma.codeswarmWorker.findUnique({
      where: { nodeId },
      select: { address: true, token: true },
    });
    const address = memoryWorker?.address || dbWorker?.address;
    if (!address) return false;

    const addresses = address.split(',').map(a => a.trim()).filter(Boolean);
    const sorted = this.sortAddresses(addresses);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (dbWorker?.token) headers.Authorization = `Bearer ${dbWorker.token}`;

    for (const addr of sorted) {
      try {
        const resp = await fetch(`http://${addr}/config`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ maxConcurrentOverride: maxConcurrent }),
          signal: AbortSignal.timeout(3000),
        });
        if (resp.ok) {
          logger.info(`Pushed maxConcurrent=${maxConcurrent} to worker ${nodeId} via ${addr}`);
          return true;
        }
      } catch {
        // try next address
      }
    }
    logger.warn(`Push maxConcurrent to worker ${nodeId} failed (all addresses unreachable, heartbeat fallback will apply)`);
    return false;
  }

  /** Remove Worker from in-memory topology (address conflict detection etc.) */
  removeWorker(nodeId: string) {
    const worker = this.workers.get(nodeId);
    if (worker && worker.currentTasks > 0) {
      logger.warn(`Removing Worker ${nodeId}, its ${worker.currentTasks} tasks will be rescheduled by checkOfflineWorkers`);
    }
    this.workers.delete(nodeId);
  }

  // ---------------------------------------------------------------------------
  // Dispatch
  // ---------------------------------------------------------------------------

  /**
   * Two-phase atomic dispatch:
   *   Phase 1: Transactional DB claim — atomically increment Worker.currentTasks
   *            and mark task as dispatched.
   *   Phase 2: Send HTTP request to Worker. On failure, roll back DB state.
   */
  async sendTaskToWorker(task: any, worker: WorkerInfo): Promise<boolean> {
    const addresses = worker.address.split(',').map(a => a.trim()).filter(Boolean);
    if (addresses.length === 0) {
      logger.error(`Worker has no valid address: ${worker.id}`);
      return false;
    }

    // Determine if Worker is local
    const primaryAddr = addresses[0].trim();
    const isLocalWorker = primaryAddr.startsWith('localhost') || primaryAddr.startsWith('127.');
    const callbackUrl = isLocalWorker
      ? `http://localhost:${process.env.PORT || 8080}`
      : (process.env.SCHEDULER_CALLBACK_URL || `http://localhost:${process.env.PORT || 8080}`);

    const sorted = this.sortAddresses(addresses);

    // Phase 1: Transactional claim — Worker slot + task dispatched
    const txResult = await withDeadlockRetry(() => prisma.$transaction(async (tx: TransactionClient) => {
      // 1. Atomic claim: DB validates currentTasks < maxConcurrent, PostgreSQL single-statement atomic
      const claim = await tx.$executeRaw`
        UPDATE "CodeswarmWorker"
        SET "currentTasks" = "currentTasks" + 1
        WHERE id = ${worker.id}
          AND status = 'online'
          AND "currentTasks" < "maxConcurrent"
      `;
      if (claim === 0) {
        return { ok: false as const, reason: 'no_capacity' };
      }
      // 2. Mark task dispatched (optimistic lock, prevent duplicate dispatch)
      const taskUpdate = await tx.codeswarmTask.updateMany({
        where: { id: task.id, state: 'queued' },
        data: { state: 'dispatched', workerId: worker.id, startedAt: new Date(), updatedAt: new Date() },
      });
      if (taskUpdate.count === 0) {
        // Task is no longer queued (concurrent/timeout rewrite), roll back currentTasks claim
        await tx.$executeRaw`
          UPDATE "CodeswarmWorker"
          SET "currentTasks" = "currentTasks" - 1
          WHERE id = ${worker.id} AND "currentTasks" > 0
        `;
        return { ok: false as const, reason: 'task_not_queued' };
      }
      return { ok: true as const };
    }));

    if (!txResult.ok) {
      logger.info(`Task ${task.taskId} pre-dispatch skipped: ${txResult.reason}`);
      if (txResult.reason === 'no_capacity') {
        this.scheduleRetry(task.id, 1000);
      }
      return false;
    }

    // In-memory sync (optimistic increment): DB already +1 in transaction, mirror to memory
    worker.currentTasks++;

    // Phase 2: Try multiple addresses to send HTTP request
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
      maxTokens: task.maxTokens ?? undefined,
      contextWindow: task.contextWindow ?? undefined,
      timeoutSec: task.timeoutSec || undefined,
      callbackUrl,
      engine: task.engine || undefined,
      agent: task.agent || undefined,
      preferredWorkerNodeId: task.preferredWorkerNodeId || undefined,
      targetProduct: task.targetProduct || undefined,
      env: task.env ? safeJsonParse(task.env) : undefined,
      // Tool dispatch fields
      toolId: task.toolId || undefined,
      toolTaskId: task.toolTaskId || undefined,
      toolPath: task.toolPath || undefined,
      toolWorkDir: task.toolWorkDir || undefined,
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
          logger.info(`Task ${task.taskId} dispatched to ${worker.id} via ${addr}`);
          return true;
        }

        const respBody = await resp.text().catch(() => '');
        // Worker reports task is already being executed (dedup)
        // 409 path does NOT need -1: Worker is actually running the task, slot is real state
        if (resp.status === 409) {
          logger.info(`Task ${task.taskId} already executing on worker, skipping duplicate`);
          return true;
        }
        if (resp.status === 400) {
          // Worker rejected execution (payload validation failed), transactional rollback
          logger.error(`Task ${task.taskId} payload validation failed (400), marking as failed: ${respBody.substring(0, 200)}`);
          await withDeadlockRetry(() => prisma.$transaction(async (tx: TransactionClient) => {
            await tx.codeswarmTask.update({
              where: { id: task.id },
              data: {
                state: 'failed',
                CodeswarmWorker: { disconnect: true },
                error: `Payload validation failed: ${respBody.substring(0, 500)}`,
                updatedAt: new Date(),
              },
            });
            await tx.$executeRaw`
              UPDATE "CodeswarmWorker"
              SET "currentTasks" = "currentTasks" - 1
              WHERE id = ${worker.id} AND "currentTasks" > 0
            `;
          })).catch((e: unknown) => logger.error(`400 path rollback failed: ${e instanceof Error ? e.message : String(e)}`));
          worker.currentTasks = Math.max(worker.currentTasks - 1, 0);

          // Notify platform of failure
          try {
            const fullTask = await prisma.codeswarmTask.findUnique({
              where: { id: task.id },
              select: { taskId: true, platformTaskId: true, platformCallbackUrl: true, state: true, result: true, error: true, reportContent: true },
            });
            if (fullTask) await this.notifyPlatform(fullTask);
          } catch { /* non-critical */ }

          return true;
        }

        logger.warn(`Worker ${worker.id} at ${addr} returned ${resp.status}, trying next address`);
      } catch (err) {
        logger.warn(`Worker ${worker.id} at ${addr} unreachable: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // All addresses failed — roll back DB state (only if task is still dispatched, avoid overwriting running/completed)
    logger.error(`All addresses failed for worker ${worker.id}: ${sorted.join(', ')}`);
    const rollbackCount = await withDeadlockRetry(() => prisma.$transaction(async (tx: TransactionClient) => {
      const taskRollback = await tx.codeswarmTask.updateMany({
        where: { id: task.id, state: 'dispatched' },
        data: { state: 'queued', workerId: null, updatedAt: new Date() },
      });
      if (taskRollback.count > 0) {
        await tx.$executeRaw`
          UPDATE "CodeswarmWorker"
          SET "currentTasks" = "currentTasks" - 1
          WHERE id = ${worker.id} AND "currentTasks" > 0
        `;
      }
      return taskRollback.count;
    })).catch((e: unknown) => {
      logger.error(`Rollback transaction failed: ${e instanceof Error ? e.message : String(e)}`);
      return 0;
    });

    if (rollbackCount === 0) {
      logger.info(`Task ${task.taskId} rollback skipped — task no longer in dispatched state`);
    } else {
      worker.currentTasks = Math.max(worker.currentTasks - 1, 0);
      this.scheduleRetry(task.id, 1000);
    }

    return false;
  }

  /**
   * Least-load-first Worker selection, with optional preferred node.
   * Skips workers with status === 'draining'.
   */
  selectWorker(preferredNodeId?: string): WorkerInfo | null {
    // If preferred node is specified and available, use it directly
    if (preferredNodeId) {
      const preferred = this.workers.get(preferredNodeId);
      if (preferred) {
        const isHealthy = Date.now() - preferred.lastHeartbeat <= 90000;
        const hasCapacity = preferred.currentTasks < preferred.maxConcurrent;
        const isDraining = preferred.status === 'draining';
        if (isHealthy && hasCapacity && !isDraining) {
          logger.info(`Using manually selected Worker: ${preferredNodeId}`);
          return preferred;
        }
        logger.warn(`Preferred Worker ${preferredNodeId} unavailable (healthy=${isHealthy}, capacity=${hasCapacity}, draining=${isDraining})`);
      } else {
        logger.warn(`Preferred Worker ${preferredNodeId} not registered`);
      }
    }

    // Auto-assign: least load first
    let best: WorkerInfo | null = null;
    for (const w of this.workers.values()) {
      if (Date.now() - w.lastHeartbeat > 90000) continue; // 90s no heartbeat = offline
      if (w.currentTasks >= w.maxConcurrent) continue;
      if (w.status === 'draining') continue; // skip draining workers
      if (!best || w.currentTasks < best.currentTasks) best = w;
    }
    return best;
  }

  /** 
   * Immediately dispatch queued tasks from DB — bypasses the Stream cycle.
   * Called when a new Worker joins topology (onHeartbeat) to avoid the
   * 5-30s latency of waiting for the next Stream BLOCK / DB scan round.
   */
  async dispatchQueuedTasksNow(): Promise<void> {
    if (!this.running) return;
    try {
      const queuedTasks = await prisma.codeswarmTask.findMany({
        where: { state: 'queued' },
        select: { id: true, taskId: true, preferredWorkerNodeId: true },
        take: 20,
      });
      if (queuedTasks.length === 0) return;

      logger.info(`New Worker detected, immediately dispatching ${queuedTasks.length} queued tasks`);
      for (const task of queuedTasks) {
        const dispatched = await this.dispatchOne(task.id);
        if (!dispatched && this.redis) {
          this.scheduleRetry(task.id, 3000);
        }
      }
    } catch (e) {
      logger.warn(`dispatchQueuedTasksNow error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Manually trigger dispatch of queued tasks */
  async triggerDispatch(): Promise<void> {
    await this.scanDbQueuedTasks();
  }

  /** Publish task state change event (for Task Builder etc.) */
  async publishTaskEvent(taskId: string, event: { type: string; status?: string; data?: any }) {
    if (!this.publisher) return;
    try {
      await this.publisher.publish(`codeswarm:task:${taskId}`, JSON.stringify(event));
    } catch { /* non-critical */ }
  }

  // ---------------------------------------------------------------------------
  // Internal: Redis Stream consumer
  // ---------------------------------------------------------------------------

  private scheduleRetry(dbTaskId: string, delayMs: number) {
    if (!this.redis || !this.running) return;
    const retryKey = `codeswarm:task:retrying:${dbTaskId}`;
    setTimeout(async () => {
      if (!this.redis || !this.running) return;
      try {
        const acquired = await this.redis.set(retryKey, '1', 'PX', Math.max(delayMs, 1000), 'NX');
        if (!acquired) return;
        await this.redis.xadd(STREAM_KEY, '*', 'dbTaskId', dbTaskId);
      } catch (e) {
        logger.warn(`Retry re-enqueue failed for ${dbTaskId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, delayMs);
  }

  /** Recover messages stuck in pending (process restart, previous dispatch failure etc.) */
  private async recoverPendingMessages() {
    if (!this.redis) return;

    try {
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
          // Task is no longer queued (dispatched/completed), just ACK to clean up
          if (!task || task.state !== 'queued') {
            await this.redis!.xack(STREAM_KEY, CONSUMER_GROUP, msgId);
            continue;
          }

          const dispatched = await this.dispatchOne(dbTaskId);
          await this.redis!.xack(STREAM_KEY, CONSUMER_GROUP, msgId);

          if (!dispatched) {
            this.scheduleRetry(dbTaskId, 3000);
          }
          recovered++;
        }
      }

      if (recovered > 0) {
        logger.info(`Recovered ${recovered} pending messages`);
      }
    } catch (e) {
      logger.error(`Failed to recover pending messages: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Redis Stream consumption loop */
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
                // On failure re-enqueue to avoid DB queued tasks losing Stream trigger
                this.scheduleRetry(dbTaskId, 3000);
              }
            })
          );
        }
      } catch (e: any) {
        const errMsg = e?.message || String(e);
        if (errMsg.includes('NOGROUP')) {
          logger.warn('NOGROUP error, attempting to rebuild Consumer Group...');
          const rebuilt = await this.ensureConsumerGroup();
          if (rebuilt) {
            logger.info('Consumer Group rebuilt successfully, resuming');
          }
          await this.sleep(2000);
        } else if (errMsg.includes('too many clients') || errMsg.includes('Too many database connections')) {
          logger.warn('DB connection exhausted, waiting 15s before retry...');
          await this.sleep(15000);
        } else {
          logger.error(`Consumption loop error: ${errMsg}`);
          await this.sleep(2000);
        }
      }
    }
  }

  /** Dispatch a single task */
  private async dispatchOne(dbTaskId: string): Promise<boolean> {
    try {
      const task = await prisma.codeswarmTask.findUnique({ where: { id: dbTaskId } });
      if (!task || task.state !== 'queued') return true;

      // Delay retry for tasks recently rolled back (<1s), avoid 503 storm
      // Scenario: During Worker Semaphore adjustment (30s window after maxConcurrent change),
      // all dispatches will get 503 — without interval, 5s BLOCK cycle would continuously hit Worker
      const recentlyRolledBack = Date.now() - new Date(task.updatedAt).getTime() < 1000;
      if (recentlyRolledBack && this.redis && this.running) {
        this.scheduleRetry(dbTaskId, 1000);
        return false;
      }

      // Prefer specified Worker, otherwise auto-assign
      let worker = this.selectWorker(task.preferredWorkerNodeId ?? undefined);
      if (!worker) {
        const now = Date.now();
        if (now - this.lastPreferredUnavailableLogTime > this.lastPreferredUnavailableLogInterval) {
          this.lastPreferredUnavailableLogTime = now;
          logger.info('Preferred Worker unavailable, trying auto-assign...');
        }
        worker = this.selectWorker();
      }
      if (!worker) {
        const now = Date.now();
        if (now - this.lastNoWorkerLogTime > this.lastNoWorkerLogInterval) {
          this.lastNoWorkerLogTime = now;
          logger.info(`No Worker available, task remains queued: ${task.taskId}`);
        }
        return false;
      }

      const success = await this.sendTaskToWorker(task, worker);
      if (!success) {
        return false;
      }

      // Register timeout (default 7 days when no timeoutSec, matching Worker TASK_TIMEOUT_SEC)
      await this.registerTaskTimeout(dbTaskId, task.timeoutSec || 604800);

      logger.info(`Task ${task.taskId} dispatched to ${worker.nodeId}${task.preferredWorkerNodeId ? ' (manual select)' : ' (auto assign)'}`);
      return true;
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      if (errMsg.includes('too many clients') || errMsg.includes('Too many database connections')) {
        logger.warn(`DB connection exhausted, task temporarily skipped: ${dbTaskId}`);
        this.lastDbErrorTaskId = dbTaskId;
      } else {
        logger.error(`Dispatch failed for ${dbTaskId}: ${e instanceof Error ? e.message : String(e)}`);
      }
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: Worker recovery
  // ---------------------------------------------------------------------------

  /** Recover Worker topology from DB (includes startup health check) */
  private async recoverWorkersFromDB() {
    try {
      const workers = await prisma.codeswarmWorker.findMany({
        where: { status: 'online' },
        take: 200,
      });

      for (const w of workers) {
        const reachable = await this.pingWorker(w.address);
        if (reachable) {
          // Self-heal: count actual dispatched/running tasks for this Worker
          const actualCount = await prisma.codeswarmTask.count({
            where: { workerId: w.id, state: { in: ['dispatched', 'running'] } },
          });
          if (actualCount !== w.currentTasks) {
            logger.warn(`Worker ${w.nodeId} self-heal: currentTasks ${w.currentTasks} -> ${actualCount}`);
            await prisma.$executeRaw`
              UPDATE "CodeswarmWorker"
              SET "currentTasks" = ${actualCount}
              WHERE id = ${w.id}
            `.catch((e: unknown) => logger.error(`Self-heal currentTasks failed: ${e instanceof Error ? e.message : String(e)}`));
          }
          this.workers.set(w.nodeId, {
            id: w.id,
            nodeId: w.nodeId,
            address: w.address,
            maxConcurrent: w.maxConcurrent,
            currentTasks: actualCount,
            lastHeartbeat: w.lastHeartbeat.getTime(),
            status: w.status,
          });
        } else {
          logger.warn(`Worker ${w.nodeId} at ${w.address} unreachable during startup health check, marking offline`);
          await prisma.codeswarmWorker.update({
            where: { id: w.id },
            data: { status: 'offline', currentTasks: 0 },
          }).catch((e: unknown) => logger.error(`Failed to mark Worker offline: ${e instanceof Error ? e.message : String(e)}`));
          if (w.currentTasks > 0) {
            this.rescheduleWorkerTasksById(w.id).catch((e: unknown) =>
              logger.error(`rescheduleWorkerTasksById failed: ${e instanceof Error ? e.message : String(e)}`)
            );
          }
        }
      }

      logger.info(`Recovered Workers from DB: ${this.workers.size} reachable, ${workers.length - this.workers.size} unreachable marked offline`);
    } catch (e) {
      logger.error(`Failed to recover Workers: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: Health checks & background timers
  // ---------------------------------------------------------------------------

  private startHealthChecks() {
    // Immediate cleanup of stale consumers from previous scheduler instances
    this.cleanupStaleConsumers().catch((e: unknown) =>
      logger.warn(`Startup stale consumer cleanup failed: ${e instanceof Error ? e.message : String(e)}`)
    );
    // Fallback poller: every 5 minutes try to dispatch queued tasks
    this.startFallbackPoller();
    // Every 60s detect offline Workers
    this.offlineCheckTimer = setInterval(() => this.checkOfflineWorkers(), 60_000);
    // Every 30s scan timed-out tasks
    this.timeoutCheckTimer = setInterval(() => this.checkTimeoutTasks(), 30_000);
    // Every 30s recover messages stuck in pending
    this.pendingRetryTimer = setInterval(() => this.recoverPendingMessages(), 30_000);
    // Every 5 minutes clean up dead consumers and stale pending messages
    this.streamCleanupTimer = setInterval(() => this.cleanupStaleConsumers(), 300_000);
    // Every 60s scan tasks stuck in dispatched state
    this.dispatchedStuckTimer = setInterval(() => this.checkStuckDispatchedTasks(), 60_000);
    // Every 30s scan DB queued tasks (pick up ACK'd but still queued tasks)
    this.dbQueuedScanTimer = setInterval(() => this.scanDbQueuedTasks().catch((e: unknown) =>
      logger.warn(`DB queued scan error: ${e instanceof Error ? e.message : String(e)}`)
    ), 30_000);
    // Every 60s check zombie tasks (consistency: CodeswarmTask vs platform state)
    this.zombieCheckTimer = setInterval(() => this.checkZombieTasks(), 60_000);
    // Daily cleanup of expired task files
    this.startCleanupScheduler();
  }

  /** Detect offline Workers and reschedule their tasks */
  private async checkOfflineWorkers() {
    const now = Date.now();
    for (const [nodeId, worker] of this.workers) {
      if (now - worker.lastHeartbeat > 90_000) {
        logger.warn(`Worker ${nodeId} offline (90s no heartbeat), currentTasks=${worker.currentTasks}`);

        const hadTasks = worker.currentTasks > 0;
        worker.currentTasks = 0;
        this.workers.delete(nodeId);

        if (hadTasks) {
          this.rescheduleWorkerTasks(worker).catch((e: unknown) =>
            logger.error(`Reschedule failed: ${e instanceof Error ? e.message : String(e)}`)
          );
        } else {
          await prisma.codeswarmWorker.update({
            where: { id: worker.id },
            data: { status: 'offline', currentTasks: 0 },
          }).catch((e: unknown) => logger.error(`Failed to mark Worker offline: ${e instanceof Error ? e.message : String(e)}`));
        }
      }
    }

    // Also check DB workers marked online but heartbeat expired (handle restart misses)
    try {
      const dbOfflineWorkers = await prisma.$queryRaw`
        SELECT id, "nodeId", "currentTasks"
        FROM "CodeswarmWorker"
        WHERE status = 'online'
          AND "lastHeartbeat" < NOW() - INTERVAL '90 seconds'
      ` as any[];

      for (const w of dbOfflineWorkers) {
        logger.warn(`DB Worker ${w.nodeId} marked offline`);
        await prisma.codeswarmWorker.update({
          where: { id: w.id },
          data: { status: 'offline', currentTasks: 0 },
        });

        if (w.currentTasks > 0) {
          this.rescheduleWorkerTasksById(w.id).catch((e: unknown) =>
            logger.error(`rescheduleWorkerTasksById failed: ${e instanceof Error ? e.message : String(e)}`)
          );
        }
      }
    } catch (e) {
      logger.error(`Failed to check DB offline workers: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Task timeout handling */
  private async checkTimeoutTasks() {
    if (!this.redis) return;

    try {
      const now = Date.now();
      const timeouted = await this.redis.zrangebyscore('codeswarm:task:timeouts', 0, now);
      if (timeouted.length === 0) return;

      for (const dbTaskId of timeouted) {
        try {
          const txResult = await withDeadlockRetry(() => prisma.$transaction(async (tx: TransactionClient) => {
            const task = await tx.codeswarmTask.findUnique({
              where: { id: dbTaskId },
              select: {
                taskId: true,
                workerId: true,
                state: true,
                platformTaskId: true,
                platformCallbackUrl: true,
                result: true,
                error: true,
                reportContent: true,
              },
            });

            if (!task) {
              return { updated: false, workerId: null, task: null };
            }

            // Conditional update: only running/dispatched tasks can be marked as timeout
            const updateResult = await tx.codeswarmTask.updateMany({
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

            if (updateResult.count === 0) {
              return { updated: false, workerId: task.workerId, task };
            }

            // Decrement Worker.currentTasks in same transaction
            if (task.workerId) {
              await tx.codeswarmWorker.updateMany({
                where: {
                  id: task.workerId,
                  currentTasks: { gt: 0 },
                },
                data: { currentTasks: { decrement: 1 } },
              });
            }

            return { updated: true, workerId: task.workerId, task };
          }));

          // If update succeeded, release in-memory slot
          if (txResult.updated && txResult.workerId) {
            const workerEntry = [...this.workers.values()].find(w => w.id === txResult.workerId);
            if (workerEntry && workerEntry.currentTasks > 0) {
              workerEntry.currentTasks--;
            }
          }

          if (txResult.updated && txResult.task) {
            logger.warn(`Task ${txResult.task.taskId} timed out, marked as failed`);
            await this.publishTaskEvent(txResult.task.taskId, { type: 'task_timeout', status: 'failed' });
            // Notify platform
            await this.notifyPlatform(txResult.task);
          }
        } catch (txErr) {
          logger.error(`Timeout transaction failed: ${txErr instanceof Error ? txErr.message : String(txErr)}`);
        }

        // Always remove timeout record (completed tasks also need cleanup)
        await this.redis.zrem('codeswarm:task:timeouts', dbTaskId);
      }
    } catch (e) {
      logger.error(`Timeout scan error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Scan DB for state='queued' tasks, re-enqueue to Redis Stream */
  private async scanDbQueuedTasks() {
    if (!this.redis || !this.running) return;
    try {
      const stuckTasks = await prisma.codeswarmTask.findMany({
        where: { state: 'queued' },
        select: { id: true },
        take: 50,
      });
      if (stuckTasks.length === 0) return;

      let requeued = 0;
      for (const t of stuckTasks) {
        // scheduleRetry has NX dedup, won't double-enqueue
        this.scheduleRetry(t.id, 5000);
        requeued++;
      }
      if (requeued > 0) {
        logger.info(`DB queued fallback scan: re-enqueued ${requeued} tasks`);
      }
    } catch (e) {
      logger.warn(`DB queued scan failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Scan tasks stuck in dispatched state for >30 minutes, reset to queued */
  private async checkStuckDispatchedTasks() {
    try {
      const stuckTasks = await prisma.$queryRaw`
        SELECT id, "taskId", "workerId"
        FROM "CodeswarmTask"
        WHERE state = 'dispatched'
          AND "updatedAt" < NOW() - INTERVAL '30 minutes'
        LIMIT 50
      ` as any[];

      if (stuckTasks.length === 0) return;

      let resetCount = 0;
      for (const task of stuckTasks) {
        const updated = await withDeadlockRetry(() => prisma.$transaction(async (tx: TransactionClient) => {
          const result = await tx.codeswarmTask.updateMany({
            where: { id: task.id, state: 'dispatched' },
            data: { state: 'queued', workerId: null, updatedAt: new Date() },
          });
          if (result.count > 0 && task.workerId) {
            await tx.$executeRaw`
              UPDATE "CodeswarmWorker"
              SET "currentTasks" = "currentTasks" - 1
              WHERE id = ${task.workerId} AND "currentTasks" > 0
            `;
          }
          return result.count;
        }));

        if (updated > 0) {
          this.scheduleRetry(task.id, 3000);
          resetCount++;
          logger.warn(`Stuck dispatched task ${task.taskId} reset to queued`);
        }
      }
      if (resetCount > 0) {
        logger.info(`Stuck dispatched scan: reset ${resetCount} tasks`);
      }
    } catch (e) {
      logger.warn(`Stuck dispatched scan failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Zombie task consistency check.
   * In the standalone scheduler, we check for:
   *   - Tasks in running/dispatched state for excessively long (>=7 days)
   *   - Tasks whose Worker no longer exists
   * Platform-level checks (TaskInstance) are removed — platform handles its own consistency.
   */
  private async checkZombieTasks() {
    try {
      // Scene A: Tasks stuck in running/dispatched for >=7 days (max timeout)
      const zombieCandidates = await prisma.$queryRaw`
        SELECT ct.id, ct."taskId", ct."workerId"
        FROM "CodeswarmTask" ct
        WHERE ct.state IN ('running', 'dispatched')
          AND ct."updatedAt" < NOW() - INTERVAL '7 days'
        LIMIT 50
      ` as { id: string; taskId: string; workerId: string | null }[];

      let zombieCount = 0;
      for (const zombie of zombieCandidates) {
        try {
          const txResult = await withDeadlockRetry(() => prisma.$transaction(async (tx: TransactionClient) => {
            const updateResult = await tx.codeswarmTask.updateMany({
              where: { id: zombie.id, state: { in: ['running', 'dispatched'] } },
              data: {
                state: 'failed',
                error: 'Zombie task detected: running/dispatched for >7 days',
                completedAt: new Date(),
                updatedAt: new Date(),
              },
            });

            if (updateResult.count === 0) return { updated: false, workerId: null };

            if (zombie.workerId) {
              await tx.codeswarmWorker.updateMany({
                where: { id: zombie.workerId, currentTasks: { gt: 0 } },
                data: { currentTasks: { decrement: 1 } },
              });
            }

            return { updated: true, workerId: zombie.workerId };
          }));

          if (txResult.updated) {
            // Release in-memory Worker slot
            if (txResult.workerId) {
              const workerEntry = [...this.workers.values()].find(w => w.id === txResult.workerId);
              if (workerEntry && workerEntry.currentTasks > 0) {
                workerEntry.currentTasks--;
              }
            }

            // Notify Worker to cancel process
            if (zombie.workerId) {
              const worker = await prisma.codeswarmWorker.findUnique({
                where: { id: zombie.workerId },
                select: { address: true },
              });
              if (worker?.address) {
                const addresses = worker.address.split(',').map(a => a.trim()).filter(Boolean);
                for (const addr of addresses) {
                  try {
                    await fetch(`http://${addr}/task/cancel`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ taskId: zombie.taskId }),
                      signal: AbortSignal.timeout(3000),
                    });
                    break;
                  } catch { /* Worker may be offline */ }
                }
              }
            }

            // Remove from Redis timeout sorted set
            if (this.redis) {
              await this.redis.zrem('codeswarm:task:timeouts', zombie.id);
            }

            // Notify platform
            try {
              const fullTask = await prisma.codeswarmTask.findUnique({
                where: { id: zombie.id },
                select: { taskId: true, platformTaskId: true, platformCallbackUrl: true, state: true, result: true, error: true, reportContent: true },
              });
              if (fullTask) await this.notifyPlatform(fullTask);
            } catch { /* non-critical */ }

            zombieCount++;
            logger.warn(`Zombie task ${zombie.taskId} marked failed (running/dispatched for >7 days)`);
          }
        } catch (txErr) {
          logger.error(`Zombie task transaction failed for ${zombie.taskId}: ${txErr instanceof Error ? txErr.message : String(txErr)}`);
        }
      }

      // Scene B: Tasks assigned to a Worker that no longer exists
      const orphanedTasks = await prisma.$queryRaw`
        SELECT ct.id, ct."taskId", ct."workerId"
        FROM "CodeswarmTask" ct
        LEFT JOIN "CodeswarmWorker" cw ON ct."workerId" = cw.id
        WHERE ct.state IN ('dispatched', 'running')
          AND ct."workerId" IS NOT NULL
          AND cw.id IS NULL
        LIMIT 50
      ` as { id: string; taskId: string; workerId: string | null }[];

      let orphanCount = 0;
      for (const orphan of orphanedTasks) {
        try {
          const updated = await prisma.codeswarmTask.updateMany({
            where: { id: orphan.id, state: { in: ['dispatched', 'running'] } },
            data: {
              state: 'queued',
              workerId: null,
              updatedAt: new Date(),
            },
          });
          if (updated.count > 0) {
            this.scheduleRetry(orphan.id, 3000);
            orphanCount++;
            logger.warn(`Orphaned task ${orphan.taskId} reset to queued (Worker deleted)`);
          }
        } catch (txErr) {
          logger.error(`Orphan task update failed for ${orphan.taskId}: ${txErr instanceof Error ? txErr.message : String(txErr)}`);
        }
      }

      if (zombieCount > 0 || orphanCount > 0) {
        logger.info(`Zombie scan complete: long-running=${zombieCount}, orphaned=${orphanCount}`);
      }
    } catch (e) {
      logger.error(`Zombie scan error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: Task rescheduling
  // ---------------------------------------------------------------------------

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

      // Send cancel requests to Worker
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
              logger.info(`Cancel request sent to Worker ${addr}: ${task.taskId}`);
              break; // first reachable address is enough
            } catch (e) {
              logger.warn(`Cancel request failed for ${addr}: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }
      }

      for (const task of stuckTasks) {
        const rescheduled = await prisma.codeswarmTask.updateMany({
          where: { id: task.id, state: { in: ['dispatched', 'running'] } },
          data: {
            state: 'queued',
            workerId: null,
            preferredWorkerNodeId: null,
            updatedAt: new Date(),
          },
        });

        if (rescheduled.count > 0) {
          if (this.redis) {
            await this.redis.xadd(STREAM_KEY, '*', 'dbTaskId', task.id);
          }
          logger.info(`Task ${task.taskId} re-enqueued`);
        } else {
          logger.info(`Task ${task.taskId} reschedule skipped — already in terminal state`);
        }
      }
    } catch (e) {
      logger.error(`rescheduleWorkerTasksById error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async rescheduleWorkerTasks(worker: WorkerInfo) {
    try {
      const addresses = worker.address.split(',').map(a => a.trim()).filter(Boolean);

      // Update DB: Worker offline
      await prisma.codeswarmWorker.update({
        where: { id: worker.id },
        data: { status: 'offline', currentTasks: 0 },
      });

      // Find incomplete tasks on this Worker
      const stuckTasks = await prisma.codeswarmTask.findMany({
        where: {
          workerId: worker.id,
          state: { in: ['dispatched', 'running'] },
        },
        select: { id: true, taskId: true },
      });

      for (const task of stuckTasks) {
        // Try to send cancel request to Worker (multi-address failover)
        for (const addr of addresses) {
          try {
            await fetch(`http://${addr}/task/cancel`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId: task.taskId }),
              signal: AbortSignal.timeout(5000),
            });
            break;
          } catch { /* Worker may be offline */ }
        }

        // Reset to queued (conditional: only dispatched/running, avoid overwriting completed terminal states)
        const rescheduled = await prisma.codeswarmTask.updateMany({
          where: { id: task.id, state: { in: ['dispatched', 'running'] } },
          data: {
            state: 'queued',
            workerId: null,
            preferredWorkerNodeId: null,
            updatedAt: new Date(),
          },
        });

        if (rescheduled.count > 0) {
          if (this.redis) {
            await this.redis.xadd(STREAM_KEY, '*', 'dbTaskId', task.id);
          }
          logger.info(`Task ${task.taskId} re-enqueued`);
        } else {
          logger.info(`Task ${task.taskId} reschedule skipped — already in terminal state`);
        }
      }
    } catch (e) {
      logger.error(`rescheduleWorkerTasks error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: Event-driven dispatch + fallback poller
  // ---------------------------------------------------------------------------

  /** Event-driven + fallback poll: fetch next task from queue and try dispatch */
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
            this.scheduleRetry(dbTaskId, 3000);
          }
        }
      }
    } catch (e) {
      logger.warn(`tryDispatchNext failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private startFallbackPoller() {
    const INTERVAL_MS = 5 * 60 * 1000;
    this.fallbackPollTimer = setInterval(() => {
      this.tryDispatchNext().catch((e: unknown) =>
        logger.warn(`Fallback poll error: ${e instanceof Error ? e.message : String(e)}`)
      );
    }, INTERVAL_MS);
  }

  // ---------------------------------------------------------------------------
  // Internal: Stale consumer cleanup
  // ---------------------------------------------------------------------------

  private async cleanupStaleConsumers() {
    if (!this.redis) return;

    try {
      const consumers = await this.redisExec('XINFO', 'CONSUMERS', STREAM_KEY, CONSUMER_GROUP) as any[];
      let deletedCount = 0;
      let claimedCount = 0;

      // Parse XINFO CONSUMERS flat array into structured objects.
      // Redis returns [key1, val1, key2, val2, ...] per consumer; field count varies
      // across Redis versions (e.g. Redis 7.x added 'inactive' field).
      // Parse by key-value pairs and detect consumer boundaries via the 'name' key.
      const consumerList: { name: string; pending: number; idle: number }[] = [];
      let cur: Record<string, unknown> = {};
      for (let i = 0; i < consumers.length; i += 2) {
        const key = String(consumers[i]);
        const val = consumers[i + 1];
        if (key === 'name' && 'name' in cur) {
          // New consumer block starts — push the previous one
          consumerList.push({
            name: String(cur.name ?? ''),
            pending: Number(cur.pending ?? 0),
            idle: Number(cur.idle ?? 0),
          });
          cur = {};
        }
        cur[key] = val;
      }
      // Push the last consumer
      if ('name' in cur) {
        consumerList.push({
          name: String(cur.name ?? ''),
          pending: Number(cur.pending ?? 0),
          idle: Number(cur.idle ?? 0),
        });
      }

      for (const { name: nameStr, pending, idle } of consumerList) {

        if (nameStr === CONSUMER_NAME) continue;

        if (idle > 300_000) {
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

                // Read message content, check DB task state, re-enqueue queued tasks
                try {
                  const msgData = await this.redis!.xrange(STREAM_KEY, idStr, idStr) as [string, string[]][] | null;
                  if (msgData && msgData.length > 0) {
                    const fields = msgData[0][1];
                    const dbTaskId = fields[1];
                    if (dbTaskId) {
                      const task = await prisma.codeswarmTask.findUnique({ where: { id: dbTaskId }, select: { state: true } });
                      if (task?.state === 'queued') {
                        this.scheduleRetry(dbTaskId, 5000);
                      }
                    }
                  }
                } catch (e) {
                  logger.warn(`Claimed message processing failed: ${e instanceof Error ? e.message : String(e)}`);
                }

                await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, idStr);
                claimedCount++;
              }
            } catch (claimErr) {
              logger.warn(`Claim pending messages failed: ${claimErr instanceof Error ? claimErr.message : String(claimErr)}`);
            }
          }

          try {
            await this.redisExec('XGROUP', 'DELCONSUMER', STREAM_KEY, CONSUMER_GROUP, nameStr);
            deletedCount++;
          } catch (delErr) {
            logger.warn(`Delete dead consumer failed: ${delErr instanceof Error ? delErr.message : String(delErr)}`);
          }
        }
      }

      try {
        await this.redisExec('XTRIM', STREAM_KEY, 'MAXLEN', '~', 200);
      } catch { /* non-critical */ }

      if (deletedCount > 0 || claimedCount > 0) {
        logger.info(`Stream cleanup complete: deleted=${deletedCount}, claimed=${claimedCount}`);
      }
    } catch (e) {
      logger.error(`Stream cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: Task cleanup scheduler
  // ---------------------------------------------------------------------------

  private startCleanupScheduler() {
    if (this.cleanupSchedulerActive) return;

    const parsedHour = parseInt(process.env.TASK_CLEANUP_HOUR || '3', 10);
    const hour = Number.isFinite(parsedHour) && parsedHour >= 0 && parsedHour <= 23 ? parsedHour : 3;
    this.cleanupSchedulerActive = true;

    const scheduleAt = (baseTime: Date): number => {
      const target = new Date(baseTime);
      target.setHours(hour, 5, 0, 0); // HH:05:00 avoid the top of the hour
      if (target <= baseTime) target.setDate(target.getDate() + 1);
      return target.getTime() - baseTime.getTime();
    };

    const scheduleNext = () => {
      if (!this.cleanupSchedulerActive) return null;
      return setTimeout(runCleanup, scheduleAt(new Date()));
    };

    const runCleanup = async () => {
      try {
        // Local cleanup: mark tasks in dispatched/running for >7 days as failed
        // Query first to know which workers need currentTasks decrement
        const expiredTasks = await prisma.codeswarmTask.findMany({
          where: {
            state: { in: ['dispatched', 'running'] },
            updatedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
          select: { id: true, taskId: true, workerId: true },
          take: 100,
        });

        if (expiredTasks.length > 0) {
          // Group by workerId to batch decrements
          const workerTaskCounts = new Map<string, number>();
          for (const task of expiredTasks) {
            if (task.workerId) {
              workerTaskCounts.set(task.workerId, (workerTaskCounts.get(task.workerId) || 0) + 1);
            }
          }

          // Mark tasks as failed (conditional: still dispatched/running)
          await prisma.codeswarmTask.updateMany({
            where: {
              id: { in: expiredTasks.map(t => t.id) },
              state: { in: ['dispatched', 'running'] },
            },
            data: {
              state: 'failed',
              error: 'Task expired (running >7 days)',
              completedAt: new Date(),
              updatedAt: new Date(),
            },
          });

          // Decrement Worker.currentTasks for affected workers
          for (const [workerId, count] of workerTaskCounts) {
            try {
              await withDeadlockRetry(() => prisma.$executeRaw`
                UPDATE "CodeswarmWorker"
                SET "currentTasks" = GREATEST("currentTasks" - ${count}, 0)
                WHERE id = ${workerId}
              `);
              // Release in-memory worker slot
              const workerEntry = [...this.workers.values()].find(w => w.id === workerId);
              if (workerEntry) {
                workerEntry.currentTasks = Math.max(workerEntry.currentTasks - count, 0);
              }
            } catch (e) {
              logger.error(`Cleanup: failed to decrement Worker ${workerId} currentTasks: ${e instanceof Error ? e.message : String(e)}`);
            }
          }

          // Remove from Redis timeout sorted set
          if (this.redis) {
            for (const task of expiredTasks) {
              await this.redis.zrem('codeswarm:task:timeouts', task.id);
            }
          }

          logger.info(`Task cleanup: ${expiredTasks.length} expired tasks marked failed`);
        }

        // Also clean up very old completed/failed tasks (older than 30 days)
        const oldDeleted = await prisma.codeswarmTask.deleteMany({
          where: {
            state: { in: ['completed', 'failed', 'cancelled'] },
            updatedAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
        });

        if (expiredTasks.length > 0 || oldDeleted.count > 0) {
          logger.info(`Task cleanup: ${expiredTasks.length} expired tasks marked failed, ${oldDeleted.count} old tasks deleted`);
        }
      } catch (e) {
        logger.error(`Task cleanup error: ${e instanceof Error ? e.message : String(e)}`);
      }

      if (!this.cleanupSchedulerActive) return;
      this.cleanupTimer = scheduleNext();
    };

    const initialDelay = scheduleAt(new Date());
    logger.info(`Task cleanup first run in ${Math.round(initialDelay / 60000)} minutes (daily at ${hour}:05)`);
    this.cleanupTimer = setTimeout(runCleanup, initialDelay);
  }

  // ---------------------------------------------------------------------------
  // Internal: Timeout registration
  // ---------------------------------------------------------------------------

  async registerTaskTimeout(dbTaskId: string, timeoutSec: number) {
    if (!this.redis || !timeoutSec) return;
    const deadline = Date.now() + timeoutSec * 1000;
    await this.redis.zadd('codeswarm:task:timeouts', deadline, dbTaskId);
  }

  // ---------------------------------------------------------------------------
  // Internal: Utilities
  // ---------------------------------------------------------------------------

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
      logger.info('Consumer Group rebuilt');
      return true;
    } catch (e: any) {
      if (e.message.includes('BUSYGROUP')) return true;
      logger.error(`Rebuild Consumer Group failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  private redisExec(...args: (string | number | Buffer)[]): Promise<any> {
    const command = new Command(args[0] as string, args.slice(1));
    return this.redis!.sendCommand(command) as Promise<any>;
  }

  /** Quick health check: GET /health to Worker (supports comma-separated multi-address) */
  private async pingWorker(address: string): Promise<boolean> {
    const addresses = address.split(',').map(a => a.trim()).filter(Boolean);
    for (const addr of addresses) {
      try {
        const resp = await fetch(`http://${addr}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) return true;
      } catch { /* try next address */ }
    }
    return false;
  }

  private isDbConnectionError(dbTaskId: string): boolean {
    if (this.lastDbErrorTaskId === dbTaskId) {
      this.lastDbErrorTaskId = null;
      return true;
    }
    return false;
  }

  /**
   * Sort addresses by reachability priority:
   *   External IPs (1) > AWS VPC 172.x (2) > Docker 172.17-21.x (3) > localhost (4) > 198.18.x (5)
   */
  private sortAddresses(addresses: string[]): string[] {
    return [...addresses].sort((a, b) => {
      const score = (addr: string) => {
        if (addr.startsWith('localhost') || addr.startsWith('127.')) return 4;
        if (addr.startsWith('198.18.')) return 5;
        if (/^172\.(17|18|19|20|21)\./.test(addr)) return 3;
        if (addr.startsWith('172.')) return 2;
        return 1;
      };
      return score(a.trim()) - score(b.trim());
    });
  }
}
