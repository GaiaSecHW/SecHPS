import { NextResponse } from 'next/server';
import { prisma, Prisma } from '@/lib/prisma';
import { codeswarmDispatcher } from '@/services/codeswarm-dispatcher';

export async function GET() {
  try {
    // 排除 events/result/reportContent 大字段，避免慢查询
    const tasks = await prisma.$queryRaw`
      SELECT t.id, t."taskId", t."workerId", t.state, t.instruction,
             t."projectPath", t."workspacePath", t."gitUrl", t."gitRef",
             t.skills, t.mcps, t.model, t."apiKey", t."timeoutSec", t.agent,
             t.error, t."startedAt", t."completedAt", t."createdAt", t."updatedAt",
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
    } = body;

    // 手动批量分发（保留兼容）
    if (action === 'dispatch-queued') {
      if (codeswarmDispatcher.isAvailable) {
        // Redis 模式：重新提交所有 queued 任务到 Stream
        const queuedTasks = await prisma.codeswarmTask.findMany({
          where: { state: 'queued' },
          select: { id: true },
          take: 100,
        });
        let dispatched = 0;
        for (const t of queuedTasks) {
          if (await codeswarmDispatcher.submitTask(t.id)) dispatched++;
        }
        return NextResponse.json({ message: 'Re-queued to Redis', dispatched });
      }

      // DB fallback
      const queuedTasks = await prisma.codeswarmTask.findMany({
        where: { state: 'queued' },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });

      if (queuedTasks.length === 0) {
        return NextResponse.json({ message: 'No queued tasks', dispatched: 0 });
      }

      const availableWorkers = await prisma.codeswarmWorker.findMany({
        where: { status: 'online' },
        orderBy: { currentTasks: 'asc' },
        take: 50,
      });

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

    if (!workspacePath) {
      return NextResponse.json({ error: 'workspacePath is required' }, { status: 400 });
    }

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    // 创建任务（始终 queued，由 dispatcher 异步分发）
    const task = await prisma.codeswarmTask.create({
      data: {
        id: `db-${Date.now()}`,
        taskId,
        workerId: null,
        state: 'queued',
        instruction: instruction || null,
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
        updatedAt: new Date(),
      },
    }) as any;

    // 尝试提交到 Redis Stream（优先）
    const redisSubmitted = await codeswarmDispatcher.submitTask(task.id);

    // Redis 不可用时，DB fallback：立即尝试同步分发
    if (!redisSubmitted) {
      const allWorkers = await prisma.codeswarmWorker.findMany({
        where: { status: 'online' },
        orderBy: { currentTasks: 'asc' },
        take: 50,
      });

      const worker = allWorkers.find(w => w.currentTasks < w.maxConcurrent);

      if (worker) {
        const success = await codeswarmDispatcher.sendTaskToWorker(task, worker);
        if (!success) {
          await prisma.codeswarmTask.update({
            where: { id: task.id },
            data: { state: 'queued', workerId: null },
          });
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
