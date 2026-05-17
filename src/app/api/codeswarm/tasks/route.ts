import { NextResponse } from 'next/server';
import { prisma, Prisma, withRetry } from '@/lib/prisma';
import { codeswarmDispatcher } from '@/services/codeswarm-dispatcher';

export async function GET() {
  try {
    // 排除 events/result/reportContent 大字段，避免慢查询
    const tasks = await prisma.$queryRaw`
      SELECT t.id, t."taskId", t."workerId", t.state, t.instruction,
             t."projectPath", t."workspacePath", t."gitUrl", t."gitRef",
             t.skills, t.mcps, t.model, t."apiKey", t."timeoutSec", t.agent,
             t."startCommand", t.error, t."startedAt", t."completedAt", t."createdAt", t."updatedAt",
             w."nodeId" as "workerNodeId", w."address" as "workerAddress", w."status" as "workerStatus"
      FROM "CodeswarmTask" t
      LEFT JOIN "CodeswarmWorker" w ON t."workerId" = w.id
      ORDER BY t."createdAt" DESC
      LIMIT 100
    ` as any[];

    return NextResponse.json({
      tasks: tasks.map(t => ({
        ...t,
        skills: t.skills ? JSON.parse(t.skills) : null,
        mcps: t.mcps ? JSON.parse(t.mcps) : null,
        CodeswarmWorker: t.workerNodeId ? { nodeId: t.workerNodeId, address: t.workerAddress, status: t.workerStatus } : null,
        workerNodeId: undefined,
        workerAddress: undefined,
        workerStatus: undefined,
      })),
    });
  } catch (error) {
    console.error('[CodeSwarm] Get tasks error:', error);
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { taskIds } = await request.json();

    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return NextResponse.json({ error: 'taskIds is required and must be non-empty array' }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      // 删除关联事件
      await tx.codeswarmEvent.deleteMany({ where: { taskId: { in: taskIds } } });

      // 删除任务
      await tx.codeswarmTask.deleteMany({ where: { taskId: { in: taskIds } } });

      // 更新关联的 TaskInstance 状态
      await tx.taskInstance.updateMany({
        where: { codeswarmTaskId: { in: taskIds }, status: { in: ['pending', 'running'] } },
        data: { status: 'failed', errorMessage: 'CodeSwarm 任务已被删除', updatedAt: new Date() },
      });
    });

    return NextResponse.json({ success: true, deleted: taskIds.length });
  } catch (error) {
    console.error('[CodeSwarm] Batch delete tasks error:', error);
    return NextResponse.json({ error: 'Failed to delete tasks' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      instruction,
      projectPath,
      workspacePath,
      skills,
      scripts,
      mcps,
      model,
      apiKey,
      timeoutSec,
      gitUrl,
      gitRef,
      agent,
      defaultAgentName,
      action,
      preferredWorkerNodeId,
      startCommand,
      targetProduct,
      platformTaskId,
    } = body;

    // 手动批量分发（保留兼容）
    if (action === 'dispatch-queued') {
      if (codeswarmDispatcher.isAvailable) {
        // Redis 模式：重新提交所有 queued 任务到 Stream
        // 使用 $queryRaw 替代 findMany，避免远程 PostgreSQL 挂起问题
        const queuedTasks = await prisma.$queryRaw`
          SELECT id
          FROM "CodeswarmTask"
          WHERE state = 'queued'
          LIMIT 100
        ` as any[];
        let dispatched = 0;
        for (const t of queuedTasks) {
          if (await codeswarmDispatcher.submitTask(t.id)) dispatched++;
        }
        return NextResponse.json({ message: 'Re-queued to Redis', dispatched });
      }

      // DB fallback
      // 使用 $queryRaw 替代 findMany，避免远程 PostgreSQL 挂起问题
      const queuedTasks = await prisma.$queryRaw`
        SELECT id, "taskId", "workerId", state, instruction,
               "projectPath", "workspacePath", "gitUrl", "gitRef",
               skills, mcps, model, "apiKey", "timeoutSec", agent,
               "preferredWorkerNodeId", "startCommand", "targetProduct",
               "defaultAgentName", error, "startedAt", "completedAt",
               "createdAt", "updatedAt"
        FROM "CodeswarmTask"
        WHERE state = 'queued'
        ORDER BY "createdAt" ASC
        LIMIT 10
      ` as any[];

      if (queuedTasks.length === 0) {
        return NextResponse.json({ message: 'No queued tasks', dispatched: 0 });
      }

      // 使用 $queryRaw 替代 findMany，避免远程 PostgreSQL 挂起问题
      const availableWorkers = await prisma.$queryRaw`
        SELECT id, "nodeId", address, status, "maxConcurrent", "currentTasks", "createdAt", "updatedAt"
        FROM "CodeswarmWorker"
        WHERE status = 'online'
        ORDER BY "currentTasks" ASC
        LIMIT 50
      ` as any[];

      const workersWithCapacity = availableWorkers.filter(w => w.currentTasks < w.maxConcurrent);

      if (workersWithCapacity.length === 0) {
        return NextResponse.json({ message: 'No available workers', dispatched: 0 });
      }

      let dispatched = 0;
      for (const task of queuedTasks) {
        const worker = workersWithCapacity.find(w => w.currentTasks < w.maxConcurrent);
        if (!worker) break;

        const success = await codeswarmDispatcher.sendTaskToWorker(task, worker);
        if (success) {
          worker.currentTasks++;
          dispatched++;
        }
      }

      return NextResponse.json({ message: 'Queued tasks dispatched', dispatched });
    }

    if (!instruction && !startCommand) {
      return NextResponse.json({ error: 'instruction or startCommand is required' }, { status: 400 });
    }

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    // 创建任务（始终 queued，由 dispatcher 异步分发）
    const task = await withRetry(() => prisma.codeswarmTask.create({
      data: {
        id: `db-${Date.now()}`,
        taskId,
        state: 'queued',
        instruction,
        projectPath: projectPath || null,
        workspacePath: workspacePath || null,
        skills: skills ? JSON.stringify(skills) : null,
        scripts: scripts ? JSON.stringify(scripts) : null,
        mcps: mcps ? JSON.stringify(mcps) : null,
        model: model || null,
        apiKey: apiKey || null,
        timeoutSec: timeoutSec || null,
        agent: agent || null,
        defaultAgentName: defaultAgentName || null,
        preferredWorkerNodeId: preferredWorkerNodeId || null,
        startCommand: startCommand || null,
        targetProduct: targetProduct || null,
        platformTaskId: platformTaskId || null,
        updatedAt: new Date(),
      },
    })) as any;

    // 尝试提交到 Redis Stream（优先）
    const redisSubmitted = await codeswarmDispatcher.submitTask(task.id);

    // Redis 不可用时，DB fallback：立即尝试同步分发
    if (!redisSubmitted) {
      const allWorkers = await withRetry(() => prisma.$queryRaw`
        SELECT id, "nodeId", address, status, "maxConcurrent", "currentTasks", "createdAt", "updatedAt"
        FROM "CodeswarmWorker"
        WHERE status = 'online'
        ORDER BY "currentTasks" ASC
        LIMIT 50
      `) as any[];

      const worker = allWorkers.find(w => w.currentTasks < w.maxConcurrent);

      if (worker) {
        // 优先使用指定的 Worker（如果在线且有容量）
        let targetWorker = worker;
        if (task.preferredWorkerNodeId) {
          const preferred = allWorkers.find(w =>
            w.nodeId === task.preferredWorkerNodeId &&
            w.currentTasks < w.maxConcurrent
          );
          if (preferred) {
            targetWorker = preferred;
          } else {
            console.log(`[CodeSwarm] 指定的 Worker ${task.preferredWorkerNodeId} 不在线或满载，fallback 到 ${worker.nodeId}`);
          }
        }

        const success = await codeswarmDispatcher.sendTaskToWorker(task, targetWorker);
        if (success) {
          codeswarmDispatcher.syncWorkerLoad(targetWorker.nodeId, (targetWorker.currentTasks || 0) + 1);
        } else {
          await withRetry(() => prisma.codeswarmTask.update({
            where: { id: task.id },
            data: { state: 'queued', CodeswarmWorker: { disconnect: true } },
          }));
        }
      }
    }

    return NextResponse.json({
      taskId,
      task,
      queued: true,
    });
  } catch (error) {
    console.error('[CodeSwarm] Create task error:', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}
