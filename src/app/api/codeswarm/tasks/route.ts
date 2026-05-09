import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const tasks = await prisma.codeswarmTask.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        CodeswarmWorker: {
          select: {
            nodeId: true,
            address: true,
            status: true,
          },
        },
      },
    });

    return NextResponse.json({
      tasks: tasks.map(t => ({
        ...t,
        skills: t.skills ? JSON.parse(t.skills) : null,
        mcps: t.mcps ? JSON.parse(t.mcps) : null,
        events: t.events ? JSON.parse(t.events) : null,
      })),
    });
  } catch (error) {
    console.error('[CodeSwarm] Get tasks error:', error);
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

async function dispatchTaskToWorker(task: any, worker: any): Promise<boolean> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  
  try {
    const resp = await fetch(`http://${worker.address}/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: task.taskId,
        instruction: task.instruction,
        projectPath: task.projectPath || '',
        workspacePath: task.workspacePath,
        skills: task.skills ? JSON.parse(task.skills) : null,
        mcps: task.mcps ? JSON.parse(task.mcps) : null,
        model: task.model,
        apiKey: task.apiKey,
        timeoutSec: task.timeoutSec,
        nazhuaCallbackUrl: baseUrl,
        gitUrl: task.gitUrl,
        gitRef: task.gitRef,
        agent: task.agent,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      return false;
    }

    await prisma.codeswarmTask.update({
      where: { id: task.id },
      data: {
        state: 'dispatched',
        workerId: worker.id,
        startedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await prisma.codeswarmWorker.update({
      where: { id: worker.id },
      data: { currentTasks: { increment: 1 } },
    });

    console.log(`[CodeSwarm] Task ${task.taskId} dispatched to ${worker.nodeId}`);
    return true;
  } catch (error) {
    console.error(`[CodeSwarm] Dispatch error for task ${task.taskId}:`, error);
    return false;
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
      mcps,
      model,
      apiKey,
      timeoutSec,
      gitUrl,
      gitRef,
      agent,
      action,
    } = body;

    if (action === 'dispatch-queued') {
      const queuedTasks = await prisma.codeswarmTask.findMany({
        where: { state: 'queued' },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });

      if (queuedTasks.length === 0) {
        return NextResponse.json({ message: 'No queued tasks', dispatched: 0 });
      }

      const availableWorkers = await prisma.codeswarmWorker.findMany({
        where: {
          status: 'online',
        },
        orderBy: { currentTasks: 'asc' },
      });

      const workersWithCapacity = availableWorkers.filter(w => w.currentTasks < w.maxConcurrent);

      if (workersWithCapacity.length === 0) {
        return NextResponse.json({ message: 'No available workers', dispatched: 0 });
      }

      let dispatched = 0;
      for (const task of queuedTasks) {
        const worker = workersWithCapacity.find(w => w.currentTasks < w.maxConcurrent);
        if (!worker) break;

        const success = await dispatchTaskToWorker(task, worker);
        if (success) {
          worker.currentTasks++;
          dispatched++;
        }
      }

      return NextResponse.json({ message: 'Queued tasks dispatched', dispatched });
    }

    if (!instruction) {
      return NextResponse.json({ error: 'instruction is required' }, { status: 400 });
    }

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const allWorkers = await prisma.codeswarmWorker.findMany({
      where: { status: 'online' },
      orderBy: { currentTasks: 'asc' },
    });

    const worker = allWorkers.find(w => w.currentTasks < w.maxConcurrent);

    const task = await prisma.codeswarmTask.create({
      data: {
        id: `db-${Date.now()}`,
        taskId,
        workerId: worker?.id || null,
        state: worker ? 'dispatched' : 'queued',
        instruction,
        projectPath: projectPath || null,
        workspacePath: workspacePath || null,
        skills: skills ? JSON.stringify(skills) : null,
        mcps: mcps ? JSON.stringify(mcps) : null,
        model: model || null,
        apiKey: apiKey || null,
        timeoutSec: timeoutSec || null,
        agent: agent || null,
        startedAt: worker ? new Date() : null,
        updatedAt: new Date(),
      },
    }) as any;

    if (worker) {
      const success = await dispatchTaskToWorker(task, worker);
      if (!success) {
        await prisma.codeswarmTask.update({
          where: { id: task.id },
          data: { state: 'queued', workerId: null },
        });
      }
    }

    return NextResponse.json({
      taskId,
      task,
      dispatched: !!worker,
      workerAddress: worker?.address || null,
    });
  } catch (error) {
    console.error('[CodeSwarm] Create task error:', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}