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
    } = body;

    if (!instruction) {
      return NextResponse.json({ error: 'instruction is required' }, { status: 400 });
    }

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    // Find the least loaded available worker
    const worker = await prisma.codeswarmWorker.findFirst({
      where: {
        status: 'online',
        currentTasks: { lt: prisma.codeswarmWorker.fields.maxConcurrent },
      },
      orderBy: { currentTasks: 'asc' },
    });

    // Create task record
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

    // If worker available, dispatch task
    if (worker) {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
        const resp = await fetch(`http://${worker.address}/task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId,
            instruction,
            projectPath: projectPath || '',
            workspacePath,
            skills,
            mcps,
            model,
            apiKey,
            timeoutSec,
            nazhuaCallbackUrl: baseUrl,
            gitUrl,
            gitRef,
            agent,
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (!resp.ok) {
          // Worker rejected, mark as queued
          await prisma.codeswarmTask.update({
            where: { id: task.id },
            data: { state: 'queued', workerId: null },
          });
        } else {
          // Update worker currentTasks
          await prisma.codeswarmWorker.update({
            where: { id: worker.id },
            data: { currentTasks: { increment: 1 } },
          });
        }
      } catch (dispatchError) {
        console.error('[CodeSwarm] Dispatch error:', dispatchError);
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