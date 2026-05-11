import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { codeswarmDispatcher } from '@/services/codeswarm-dispatcher';
import { generateWorkerToken, verifyWorkerToken, extractBearerToken } from '@/lib/codeswarm-worker-auth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { nodeId, maxConcurrent, currentTasks, address } = body;

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
        status: 'online',
        maxConcurrent: maxConcurrent || 5,
        currentTasks: currentTasks || 0,
        lastHeartbeat: new Date(),
        updatedAt: new Date(),
      },
      create: {
        id: `worker-${Date.now()}`,
        nodeId,
        address: address || '',
        status: 'online',
        maxConcurrent: maxConcurrent || 5,
        currentTasks: currentTasks || 0,
        lastHeartbeat: new Date(),
        updatedAt: new Date(),
      },
    });

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
      maxConcurrent: maxConcurrent || 5,
      currentTasks,
    });

    // DB 模式 fallback：Redis 不可用时仍用心跳触发分发
    if (!codeswarmDispatcher.isAvailable) {
      dispatchQueuedTasks().catch(err => {
        console.error('[CodeSwarm] Background dispatch error:', err);
      });
    }

    return NextResponse.json({ success: true, nodeId, token: workerToken });
  } catch (error) {
    console.error('[CodeSwarm] Heartbeat error:', error);
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
    const offlineThreshold = new Date(Date.now() - 90_000);
    const staleWorkers = await prisma.codeswarmWorker.findMany({
      where: {
        status: 'online',
        lastHeartbeat: { lt: offlineThreshold },
      },
      select: { id: true, nodeId: true, currentTasks: true },
    });

    for (const w of staleWorkers) {
      console.warn(`[CodeSwarm] DB fallback: Worker ${w.nodeId} 心跳过期，标记为 offline`);
      await prisma.codeswarmWorker.update({
        where: { id: w.id },
        data: { status: 'offline', currentTasks: 0 },
      });

      // 重调度该 Worker 的任务
      if (w.currentTasks > 0) {
        const stuckTasks = await prisma.codeswarmTask.findMany({
          where: {
            workerId: w.id,
            state: { in: ['dispatched', 'running'] },
          },
          select: { id: true, taskId: true },
        });

        for (const task of stuckTasks) {
          await prisma.codeswarmTask.update({
            where: { id: task.id },
            data: { state: 'queued', workerId: null, updatedAt: new Date() },
          });
          console.log(`[CodeSwarm] DB fallback: 任务 ${task.taskId} 重新入队`);
        }
      }
    }

    // 2. 分发排队任务
    const queuedTasks = await prisma.codeswarmTask.findMany({
      where: { state: 'queued' },
      orderBy: { createdAt: 'asc' },
      take: 5,
    });

    if (queuedTasks.length === 0) return;

    const availableWorkers = await prisma.codeswarmWorker.findMany({
      where: { status: 'online' },
      orderBy: { currentTasks: 'asc' },
      take: 50,
    });

    const workersWithCapacity = availableWorkers.filter(w => w.currentTasks < w.maxConcurrent);
    if (workersWithCapacity.length === 0) return;

    for (const task of queuedTasks) {
      const worker = workersWithCapacity.find(w => w.currentTasks < w.maxConcurrent);
      if (!worker) break;

      const success = await codeswarmDispatcher.sendTaskToWorker(task, worker);
      if (success) {
        worker.currentTasks++;
        console.log(`[CodeSwarm] DB fallback: 任务 ${task.taskId} 分发到 ${worker.nodeId}`);
      }
    }
  } catch (error) {
    console.error('[CodeSwarm] DB fallback 分发错误:', error);
  }
}
