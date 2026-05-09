import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

async function dispatchQueuedTasks(): Promise<void> {
  try {
    const queuedTasks = await prisma.codeswarmTask.findMany({
      where: { state: 'queued' },
      orderBy: { createdAt: 'asc' },
      take: 5,
    });

    if (queuedTasks.length === 0) return;

    const availableWorkers = await prisma.codeswarmWorker.findMany({
      where: { status: 'online' },
      orderBy: { currentTasks: 'asc' },
    });

    const workersWithCapacity = availableWorkers.filter(w => w.currentTasks < w.maxConcurrent);
    if (workersWithCapacity.length === 0) return;

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    for (const task of queuedTasks) {
      const worker = workersWithCapacity.find(w => w.currentTasks < w.maxConcurrent);
      if (!worker) break;

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
          signal: AbortSignal.timeout(5000),
        });

        if (resp.ok) {
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

          worker.currentTasks++;
          console.log(`[CodeSwarm] Auto-dispatched task ${task.taskId} to ${worker.nodeId}`);
        }
      } catch (dispatchError) {
        console.error(`[CodeSwarm] Auto-dispatch failed for ${task.taskId}:`, dispatchError);
      }
    }
  } catch (error) {
    console.error('[CodeSwarm] Auto-dispatch error:', error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { nodeId, maxConcurrent, currentTasks, address } = body;

    if (!nodeId) {
      return NextResponse.json({ error: 'nodeId is required' }, { status: 400 });
    }

    await prisma.codeswarmWorker.upsert({
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

    dispatchQueuedTasks().catch(err => {
      console.error('[CodeSwarm] Background dispatch error:', err);
    });

    return NextResponse.json({ success: true, nodeId });
  } catch (error) {
    console.error('[CodeSwarm] Heartbeat error:', error);
    return NextResponse.json(
      { error: 'Failed to register heartbeat' },
      { status: 500 }
    );
  }
}