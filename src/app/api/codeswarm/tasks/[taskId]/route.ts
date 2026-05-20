import { NextResponse } from 'next/server';
import { prisma, Prisma } from '@/lib/prisma';
import { codeswarmDispatcher } from '@/services/codeswarm-dispatcher';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    // 使用 $queryRaw 替代 findUnique，避免远程 PostgreSQL 挂起问题
    const tasks = await prisma.$queryRaw`
      SELECT id, "taskId", "workerId", state, instruction,
             "projectPath", "workspacePath", "gitUrl", "gitRef",
             skills, mcps, model, "apiKey", "timeoutSec", agent,
             engine, "preferredWorkerNodeId", "sessionId", "targetProduct",
             events, result, error, "reportContent",
             "startedAt", "completedAt", "createdAt", "updatedAt"
      FROM "CodeswarmTask"
      WHERE "taskId" = ${taskId}
      LIMIT 1
    ` as any[];

    const task = tasks[0];

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // 单独查询 Worker 信息
    // 使用 $queryRaw 替代 findUnique，避免远程 PostgreSQL 挂起问题
    const worker = task.workerId
      ? await prisma.$queryRaw`
          SELECT "nodeId", address, status, "maxConcurrent", "currentTasks"
          FROM "CodeswarmWorker"
          WHERE id = ${task.workerId}
          LIMIT 1
        ` as any[]
      : null;

    // 优先从 CodeswarmEvent 表读取事件，回退到旧 JSON 字段
    // 使用 $queryRaw 替代 findMany，避免远程 PostgreSQL 挂起问题
    const newEvents = await prisma.$queryRaw`
      SELECT id, "taskId", data, "createdAt"
      FROM "CodeswarmEvent"
      WHERE "taskId" = ${task.taskId}
      ORDER BY "createdAt" ASC
    ` as any[];

    const events = newEvents.length > 0
      ? newEvents.map(e => ({ ...JSON.parse(e.data), _id: e.id, _createdAt: e.createdAt }))
      : (task.events ? JSON.parse(task.events) : null);

    return NextResponse.json({
      task: {
        ...task,
        skills: task.skills ? JSON.parse(task.skills) : null,
        mcps: task.mcps ? JSON.parse(task.mcps) : null,
        events,
        CodeswarmWorker: worker ? worker[0] : null,
      },
    });
  } catch (error) {
    console.error('[CodeSwarm] Get task error:', error);
    return NextResponse.json({ error: 'Failed to fetch task' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    // 获取任务和 Worker 信息
    const task = await prisma.codeswarmTask.findUnique({
      where: { taskId },
      select: { workerId: true, state: true },
    });

    // 如果任务正在运行/已分发，先通知 Worker 取消进程
    if (task && task.workerId && ['dispatched', 'running'].includes(task.state)) {
      const worker = await prisma.codeswarmWorker.findUnique({
        where: { id: task.workerId },
        select: { nodeId: true, address: true },
      });

      if (worker) {
        // 尝试调用 Worker 的 cancel endpoint
        const addresses = worker.address.split(',').map(a => a.trim()).filter(Boolean);
        for (const addr of addresses) {
          try {
            const resp = await fetch(`http://${addr}/task/cancel`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId }),
              signal: AbortSignal.timeout(5000),
            });
            if (resp.ok) {
              console.log(`[CodeSwarm] Task ${taskId} cancelled on worker ${worker.nodeId}`);
              break;
            }
          } catch (err) {
            console.warn(`[CodeSwarm] Failed to cancel on ${addr}:`, err);
          }
        }
      }
    }

    // 释放 Worker 负载
    if (task?.workerId) {
      const worker = await prisma.codeswarmWorker.findUnique({
        where: { id: task.workerId },
        select: { nodeId: true },
      });
      if (worker) {
        await codeswarmDispatcher.onTaskCompleted(worker.nodeId);
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.codeswarmEvent.deleteMany({ where: { taskId } });
      await tx.codeswarmTask.delete({ where: { taskId } });

      await tx.taskInstance.updateMany({
        where: { codeswarmTaskId: taskId, status: { in: ['pending', 'running'] } },
        data: { status: 'failed', errorMessage: 'CodeSwarm 任务已被删除', updatedAt: new Date() },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[CodeSwarm] Delete task error:', error);
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}
