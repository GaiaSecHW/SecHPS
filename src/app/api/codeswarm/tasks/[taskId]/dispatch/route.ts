import { NextResponse } from 'next/server';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { codeswarmDispatcher } from '@/services/codeswarm-dispatcher';

function sortAddressesByPriority(addresses: string[]): string[] {
  const parts = [...addresses].map(a => a.trim()).filter(Boolean);
  const hasExternalFirst = parts.length > 1 && parts[0] !== 'localhost' && !parts[0].startsWith('127.') && !parts[0].startsWith('172.17.');

  return [...parts].sort((a, b) => {
    const score = (addr: string) => {
      if (hasExternalFirst && parts[0] === addr) return -1;
      if (addr.startsWith('172.') && !addr.startsWith('172.17.') && !addr.startsWith('172.18.') && !addr.startsWith('172.19.')) return 1;
      if (addr.startsWith('172.17.') || addr.startsWith('172.18.') || addr.startsWith('172.19.')) return 3;
      if (addr.startsWith('localhost') || addr.startsWith('127.')) return 2;
      if (addr.startsWith('198.18.')) return 4;
      return 0;
    };
    return score(a.trim()) - score(b.trim());
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    const task = await prisma.codeswarmTask.findUnique({
      where: { taskId },
    });

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (task.state !== 'queued') {
      return NextResponse.json({ error: `Task is ${task.state}, cannot dispatch` }, { status: 400 });
    }

    const workers = await prisma.$queryRaw`
      SELECT id, "nodeId", address, status, "maxConcurrent", "currentTasks", "createdAt", "updatedAt"
      FROM "CodeswarmWorker"
      WHERE status = 'online'
      ORDER BY "currentTasks" ASC
      LIMIT 50
    ` as any[];

    let targetWorker = null;
    if (task.preferredWorkerNodeId) {
      targetWorker = workers.find(w => w.nodeId === task.preferredWorkerNodeId && w.currentTasks < w.maxConcurrent);
    }
    if (!targetWorker) {
      targetWorker = workers.find(w => w.currentTasks < w.maxConcurrent);
    }
    if (!targetWorker) {
      return NextResponse.json({ error: '无在线 Worker 或所有 Worker 满载' }, { status: 400 });
    }
    if (task.preferredWorkerNodeId && targetWorker.nodeId !== task.preferredWorkerNodeId) {
      logger.info(LOG_MODULES.CODESWARM, `指定的 Worker ${task.preferredWorkerNodeId} 不在线或满载，fallback 到 ${targetWorker.nodeId}`);
    }

    // P0-2 改造:事务性抢占 Worker 槽位 + 标记任务 dispatched(与 sendTaskToWorker 阶段 1 同逻辑)
    const dispatchTx = await prisma.$transaction(async (tx) => {
      const claim = await tx.$executeRaw`
        UPDATE "CodeswarmWorker"
        SET "currentTasks" = "currentTasks" + 1
        WHERE id = ${targetWorker.id}
          AND status = 'online'
          AND "currentTasks" < "maxConcurrent"
      `;
      if (claim === 0) {
        return { ok: false as const, reason: 'no_capacity' };
      }
      const taskUpdate = await tx.codeswarmTask.updateMany({
        where: { id: task.id, state: 'queued' },
        data: {
          state: 'dispatched',
          workerId: targetWorker.id,
          startedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      if (taskUpdate.count === 0) {
        await tx.$executeRaw`
          UPDATE "CodeswarmWorker"
          SET "currentTasks" = "currentTasks" - 1
          WHERE id = ${targetWorker.id} AND "currentTasks" > 0
        `;
        return { ok: false as const, reason: 'task_not_queued' };
      }
      return { ok: true as const };
    });

    if (!dispatchTx.ok) {
      return NextResponse.json({ error: `Worker 不可用: ${dispatchTx.reason}` }, { status: 400 });
    }

    const addresses: string[] = targetWorker.address.split(',').map((a: string) => a.trim()).filter(Boolean);
    if (addresses.length === 0) {
      logger.error(LOG_MODULES.CODESWARM, `Worker ${targetWorker.id} has no valid address`);
      await rollbackDispatch(task.id, targetWorker.id);
      return NextResponse.json({ error: 'Worker 地址无效' }, { status: 500 });
    }

    // 判断 Worker 是否本地：只看主地址（首个 = WORKER_ADDRESS 配置的外部 IP）
    // 避免逗号分隔的多地址中含 localhost/127.x 导致远程 Worker 被误判为本地
    const primaryAddr = addresses[0];
    const isLocalWorker = primaryAddr.startsWith('localhost') || primaryAddr.startsWith('127.');
    const callbackUrl = isLocalWorker ? 'http://localhost:3000' : (process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000');

    const sorted = sortAddressesByPriority(addresses);

    const taskPayload = JSON.stringify({
      taskId: task.taskId,
      instruction: task.instruction || undefined,
      projectPath: task.projectPath || undefined,
      workspacePath: task.workspacePath || undefined,
      skills: task.skills ? JSON.parse(task.skills) : undefined,
      scripts: task.scripts ? JSON.parse(task.scripts) : undefined,
      mcps: task.mcps ? JSON.parse(task.mcps) : undefined,
      model: task.model || undefined,
      apiKey: task.apiKey || undefined,
      timeoutSec: task.timeoutSec || undefined,
      callbackUrl,
      engine: task.engine || undefined,
      agent: task.agent || undefined,
      apiBaseUrl: task.apiBaseUrl || undefined,
      preferredWorkerNodeId: task.preferredWorkerNodeId || undefined,
      targetProduct: task.targetProduct || undefined,
    });

    let dispatchedAddr: string | null = null;
    let lastError: string | null = null;

    for (const addr of sorted) {
      try {
        const resp = await fetch(`http://${addr}/task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: taskPayload,
          signal: AbortSignal.timeout(10000),
        });

        if (resp.ok) {
          dispatchedAddr = addr;
          break;
        }

        if (resp.status === 409) {
          return NextResponse.json({ success: true, taskId: task.taskId, note: 'Task already executing on worker' });
        }
        if (resp.status === 400) {
          const respBody = await resp.text().catch(() => '');
          logger.error(LOG_MODULES.CODESWARM, `Task ${task.taskId} payload validation failed (400): ${respBody.substring(0, 200)}`);
          await prisma.$transaction(async (tx) => {
            await tx.codeswarmTask.update({
              where: { id: task.id },
              data: { state: 'failed', CodeswarmWorker: { disconnect: true }, error: `Payload validation failed: ${respBody.substring(0, 500)}`, updatedAt: new Date() },
            });
            await tx.$executeRaw`
              UPDATE "CodeswarmWorker"
              SET "currentTasks" = "currentTasks" - 1
              WHERE id = ${targetWorker.id} AND "currentTasks" > 0
            `;
          }).catch(e => logger.error(LOG_MODULES.CODESWARM, '标记任务 failed + 释放 Worker 槽位失败', { details: { error: e instanceof Error ? e.message : String(e) } }));
          return NextResponse.json({ error: 'Payload validation failed' }, { status: 400 });
        }

        const respBody = await resp.text().catch(() => '');
        lastError = `Worker at ${addr} returned ${resp.status}: ${respBody.substring(0, 200)}`;
        logger.warn(LOG_MODULES.CODESWARM, `Worker ${targetWorker.id} at ${addr} returned ${resp.status}, trying next address`);
      } catch (err) {
        lastError = `Worker at ${addr} unreachable: ${err instanceof Error ? err.message : String(err)}`;
        logger.warn(LOG_MODULES.CODESWARM, `Worker ${targetWorker.id} at ${addr} unreachable`, { details: { error: err instanceof Error ? err.message : String(err) } });
      }
    }

    if (!dispatchedAddr) {
      logger.error(LOG_MODULES.CODESWARM, `All addresses failed for worker ${targetWorker.id}: [${sorted.join(', ')}]`);
      await rollbackDispatch(task.id, targetWorker.id);
      return NextResponse.json({ error: `Worker 不可达: ${lastError || 'all addresses failed'}` }, { status: 500 });
    }

    // DB currentTasks 已在上方事务内 +1,此处只需同步 dispatcher 内存
    const freshWorker = await prisma.codeswarmWorker.findUnique({
      where: { id: targetWorker.id },
      select: { currentTasks: true },
    });
    if (freshWorker) {
      codeswarmDispatcher.syncWorkerLoad(targetWorker.nodeId, freshWorker.currentTasks);
    }

    // 注册任务超时（无 timeoutSec 时使用默认 7 天，与 Worker 侧 TASK_TIMEOUT_SEC 一致）
    await codeswarmDispatcher.registerTaskTimeout(task.id, task.timeoutSec || 604800);

    logger.info(LOG_MODULES.CODESWARM, `Task ${task.taskId} dispatched to ${targetWorker.id} via ${dispatchedAddr}`);

    return NextResponse.json({
      success: true,
      taskId: task.taskId,
      worker: { nodeId: targetWorker.nodeId, address: dispatchedAddr },
    });
  } catch (err) {
    logger.error(LOG_MODULES.CODESWARM, 'Dispatch Error', { details: { error: err instanceof Error ? err.message : String(err) } });
    return NextResponse.json({ error: 'Dispatch failed' }, { status: 500 });
  }
}

async function rollbackDispatch(taskId: string, workerId?: string) {
  await prisma.$transaction(async (tx) => {
    const taskRollback = await tx.codeswarmTask.updateMany({
      where: { id: taskId, state: 'dispatched' },
      data: { state: 'queued', workerId: null, updatedAt: new Date() },
    });
    if (taskRollback.count > 0 && workerId) {
      await tx.$executeRaw`
        UPDATE "CodeswarmWorker"
        SET "currentTasks" = "currentTasks" - 1
        WHERE id = ${workerId} AND "currentTasks" > 0
      `;
    }
  }).catch(e => logger.error(LOG_MODULES.CODESWARM, '回滚任务状态失败', { details: { error: e instanceof Error ? e.message : String(e) } }));
}