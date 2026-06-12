import { NextResponse } from 'next/server';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma, Prisma } from '@/lib/prisma';
import { codeswarmDispatcher } from '@/services/codeswarm-dispatcher';
import { generateWorkerToken, verifyWorkerToken, extractBearerToken } from '@/lib/codeswarm-worker-auth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { nodeId, maxConcurrent, currentTasks, address, systemType, arch } = body;

    if (!nodeId) {
      return NextResponse.json({ error: 'nodeId is required' }, { status: 400 });
    }

    // 如果携带 token，验证身份
    const bearerToken = extractBearerToken(request);
    let authenticatedNodeId: string | null = null;
    if (bearerToken) {
      const payload = verifyWorkerToken(bearerToken);
      if (payload && payload.nodeId === nodeId) {
        authenticatedNodeId = payload.nodeId;
      }
    }

    // 更新 dispatcher 内存拓扑（不阻塞）
    const worker = await prisma.codeswarmWorker.upsert({
      where: { nodeId },
      update: {
        address: address || '',
        systemType: systemType || null,
        arch: arch || null,
        status: 'online',
        updatedAt: new Date(),
      },
      create: {
        id: `worker-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        nodeId,
        address: address || '',
        systemType: systemType || null,
        arch: arch || null,
        status: 'online',
        maxConcurrent: maxConcurrent || 5,
        currentTasks: currentTasks || 0,
        lastHeartbeat: new Date(),
        updatedAt: new Date(),
      },
    });

    // currentTasks 校正逻辑（三层 LEAST/GREATEST）：
    //
    // 1) GREATEST("currentTasks", reported) — 防止心跳覆盖刚分发但 Worker 尚未确认的任务计数（分发竞态保护）
    // 2) GREATEST(actualActive, reported)   — 用 CodeswarmTask 实际活跃计数打破 DB 虚高锁死
    //    当 dispatch +1 但 postResult 未到达（任务被删除/Worker 重启/掉线重调度），
    //    DB currentTasks 会虚高且永远无法通过 GREATEST 下调（单向棘轮）。
    //    actualActive 是 ground truth，原子子查询与 UPDATE 同一事务，
    //    允许 DB 在实际活跃数低于 DB 值时向下修正。
    // 3) LEAST(↑, "maxConcurrent")          — 防止漂移超过容量上限
    //
    // 微竞态窗口：子查询读 actualActive 与 dispatch 写 task state 之间有毫秒级窗口，
    // 可能临时将 DB 从 N+1 降为 N（undo dispatch +1），但下一个 30s 心跳周期自动修正，
    // 远好于 GREATEST 单向棘轮导致的永久 no_capacity。
    //
    // lastHeartbeat 使用 CURRENT_TIMESTAMP 而非 Node.js new Date()，
    // 确保写入与 NOW()-INTERVAL 比较使用同一时钟源（PostgreSQL），消除跨服务器时钟偏移
    const reportedTasks = currentTasks || 0;
    await prisma.$executeRaw`
      UPDATE "CodeswarmWorker"
      SET "currentTasks" = LEAST(
            GREATEST("currentTasks", ${reportedTasks}),
            GREATEST(
              (SELECT COUNT(*)::int FROM "CodeswarmTask"
               WHERE "workerId" = "CodeswarmWorker".id
                 AND state IN ('dispatched', 'running')),
              ${reportedTasks}
            ),
            "maxConcurrent"
          ),
          "lastHeartbeat" = CURRENT_TIMESTAMP
      WHERE "nodeId" = ${nodeId}
    `;

    // 异步清理：删除 24 小时前已离线的 Worker 记录（避免数据库残留）
    prisma.codeswarmWorker.deleteMany({
      where: {
        status: 'offline',
        lastHeartbeat: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }).catch(() => {});

    // 同地址冲突清理：按子地址逐个比对，标记冲突的其他 online worker 为 offline
    // （比全串匹配更精确，避免不同 Worker 共享部分 Docker 内网 IP 但主地址不同时误杀）
    if (address) {
      const workerSubAddrs = address.split(',').map((a: string) => a.trim()).filter(Boolean);
      // 仅使用主地址（首个 = WORKER_ADDRESS 配置的外部 IP）做冲突检测
      const primaryAddr = workerSubAddrs[0];
      if (primaryAddr && !primaryAddr.startsWith('localhost') && !primaryAddr.startsWith('127.')) {
        // 查找 DB 中 address 字段包含相同主地址的其他 online worker
        const conflictingWorkers = await prisma.$queryRaw`
          SELECT id, "nodeId", "currentTasks"
          FROM "CodeswarmWorker"
          WHERE status = 'online'
            AND "nodeId" != ${nodeId}
            AND address LIKE ${'%' + primaryAddr + '%'}
        ` as any[];

        if (conflictingWorkers.length > 0) {
          const conflictIds = conflictingWorkers.map((w: any) => w.id);
          await prisma.codeswarmWorker.updateMany({
            where: { id: { in: conflictIds } },
            data: { status: 'offline', currentTasks: 0 },
          });
          for (const cw of conflictingWorkers) {
            codeswarmDispatcher.removeWorker(cw.nodeId);
            codeswarmDispatcher.rescheduleWorkerTasksById(cw.id).catch(e =>
              logger.error(LOG_MODULES.CODESWARM, '同地址冲突 Worker 任务重调度失败', { details: { error: e instanceof Error ? e.message : String(e) } })
            );
          }
        }
      }
    }

    // 首次注册或无 token 时分配新 token
    let workerToken = worker.token;
    if (!workerToken || !authenticatedNodeId) {
      workerToken = generateWorkerToken(worker.id, nodeId);
      await prisma.codeswarmWorker.update({
        where: { id: worker.id },
        data: { token: workerToken },
      });
    }

    codeswarmDispatcher.onHeartbeat({
      nodeId,
      id: worker.id,
      address: address || worker.address,
      maxConcurrent: worker.maxConcurrent,
      currentTasks,
    });

    // 如果 DB 中的 maxConcurrent（可能被 admin 在 dashboard 修改过）与 worker 上报值不同，
    // 返回 maxConcurrentOverride 让 worker 动态调整 Semaphore
    const dbMax = worker.maxConcurrent;
    const reportedMax = maxConcurrent || 5;
    const response: Record<string, any> = { success: true, nodeId, token: workerToken };
    if (dbMax !== reportedMax) {
      response.maxConcurrentOverride = dbMax;
    }

    // DB 模式 fallback：Redis 不可用时仍用心跳触发分发
    if (!codeswarmDispatcher.isAvailable) {
      dispatchQueuedTasks().catch(err => {
        logger.error(LOG_MODULES.CODESWARM, 'Background dispatch error', { details: { error: err instanceof Error ? err.message : String(err) } });
      });
    } else {
      // Redis 可用：Worker 容量减少时触发事件驱动分发排队任务
      const prevTasks = worker.currentTasks;
      if (typeof currentTasks === 'number' && currentTasks < prevTasks) {
        codeswarmDispatcher.tryDispatchNext().catch(e =>
          logger.warn(LOG_MODULES.CODESWARM, '心跳触发分发失败', { details: { error: e instanceof Error ? e.message : String(e) } })
        );
      }
    }

    return NextResponse.json(response);
  } catch (error) {
    logger.error(LOG_MODULES.CODESWARM, 'Heartbeat error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { error: 'Failed to register heartbeat' },
      { status: 500 }
    );
  }
}

// DB fallback：心跳触发的掉线检测 + 排队任务分发
async function dispatchQueuedTasks(): Promise<void> {
  try {
    // 1. 检查心跳过期的 Worker，标记为 offline
    // 使用 PostgreSQL NOW() 函数，避免 JavaScript Date 时区转换问题
    const staleWorkers = await prisma.$queryRaw`
      SELECT id, "nodeId", "currentTasks"
      FROM "CodeswarmWorker"
      WHERE status = 'online'
        AND "lastHeartbeat" < NOW() - INTERVAL '90 seconds'
    ` as any[];

    if (staleWorkers.length > 0) {
      const staleIds = staleWorkers.map((w: any) => w.id);

      // 批量标记 offline
      await prisma.codeswarmWorker.updateMany({
        where: { id: { in: staleIds } },
        data: { status: 'offline', currentTasks: 0 },
      });

      for (const w of staleWorkers) {
        logger.warn(LOG_MODULES.CODESWARM, `DB fallback: Worker ${w.nodeId} 心跳过期，标记为 offline`);
      }

      // 批量重调度 stuck 任务
      const workersWithTasks = staleWorkers.filter((w: any) => w.currentTasks > 0);
      if (workersWithTasks.length > 0) {
        const workerIdsWithTasks = workersWithTasks.map((w: any) => w.id);
        for (const wid of workerIdsWithTasks) {
          await prisma.$executeRaw`
            UPDATE "CodeswarmTask"
            SET state = 'queued', "workerId" = NULL, "updatedAt" = NOW()
            WHERE "workerId" = ${wid}
              AND (state = 'dispatched' OR state = 'running')
          `;
        }
      }
    }

    // 2. 分发排队任务
    // 使用 $queryRaw 替代 findMany，避免远程 PostgreSQL 挂起问题
    const queuedTasks = await prisma.$queryRaw`
      SELECT id, "taskId", "workerId", state, instruction,
             "projectPath", "workspacePath", "gitUrl", "gitRef",
             skills, mcps, model, "apiKey", "timeoutSec", agent,
             "preferredWorkerNodeId", error, "startedAt", "completedAt",
             "createdAt", "updatedAt"
      FROM "CodeswarmTask"
      WHERE state = 'queued'
      ORDER BY "createdAt" ASC
      LIMIT 50
    ` as any[];

    if (queuedTasks.length === 0) return;

    // 使用 $queryRaw 替代 findMany，避免远程 PostgreSQL 挂起问题
    const availableWorkers = await prisma.$queryRaw`
      SELECT id, "nodeId", address, status, "maxConcurrent", "currentTasks", "createdAt", "updatedAt"
      FROM "CodeswarmWorker"
      WHERE status = 'online'
      ORDER BY "currentTasks" ASC
      LIMIT 50
    ` as any[];

    const workersWithCapacity = availableWorkers.filter(w => w.currentTasks < w.maxConcurrent);
    if (workersWithCapacity.length === 0) return;

    for (const task of queuedTasks) {
      // 优先使用指定的 Worker，否则用自动分配
      let worker = task.preferredWorkerNodeId
        ? workersWithCapacity.find(w => w.nodeId === task.preferredWorkerNodeId && w.currentTasks < w.maxConcurrent)
        : null;

      // 如果指定的 Worker 不可用，使用自动分配
      if (!worker) {
        worker = workersWithCapacity.find(w => w.currentTasks < w.maxConcurrent);
      }

      if (!worker) break;

      const success = await codeswarmDispatcher.sendTaskToWorker(task, worker);
      if (success) {
        // sendTaskToWorker 内部已事务性 +1 DB currentTasks + 内存镜像,不再需要外部递增
        // 只需用最新 DB 值同步 dispatcher 内存(因为 worker 对象是 $queryRaw 快照,不是 dispatcher 内存中的 WorkerInfo)
        const freshWorker = await prisma.codeswarmWorker.findUnique({
          where: { id: worker.id },
          select: { currentTasks: true },
        });
        if (freshWorker) {
          codeswarmDispatcher.syncWorkerLoad(worker.nodeId, freshWorker.currentTasks);
        }
        logger.info(LOG_MODULES.CODESWARM, `DB fallback: 任务 ${task.taskId} 分发到 ${worker.nodeId}${task.preferredWorkerNodeId ? ' (手动选择)' : ' (自动分配)'}`);
      }
    }
  } catch (error) {
    logger.error(LOG_MODULES.CODESWARM, 'DB fallback 分发错误', { details: { error: error instanceof Error ? error.message : String(error) } });
  }
}
