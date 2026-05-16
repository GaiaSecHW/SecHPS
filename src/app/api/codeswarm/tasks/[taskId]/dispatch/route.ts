import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { codeswarmDispatcher } from '@/services/codeswarm-dispatcher';

/**
 * POST /api/codeswarm/tasks/:taskId/dispatch
 * 手动触发任务分发
 */
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

    // 直接从 DB 查询在线 worker 进行分发
    const workers = await prisma.$queryRaw`
      SELECT id, "nodeId", address, status, "maxConcurrent", "currentTasks", "createdAt", "updatedAt"
      FROM "CodeswarmWorker"
      WHERE status = 'online'
      ORDER BY "currentTasks" ASC
      LIMIT 50
    ` as any[];

    // 优先使用指定的 Worker（如果在线），否则 fallback 到任何可用 Worker
    let targetWorker = null;
    if (task.preferredWorkerNodeId) {
      targetWorker = workers.find(w => w.nodeId === task.preferredWorkerNodeId);
    }
    // fallback 到负载最低的可用 Worker
    if (!targetWorker) {
      targetWorker = workers.find(w => w.currentTasks < w.maxConcurrent);
    }
    if (!targetWorker) {
      return NextResponse.json({ error: '无在线 Worker 或所有 Worker 满载' }, { status: 400 });
    }
    if (task.preferredWorkerNodeId && targetWorker.nodeId !== task.preferredWorkerNodeId) {
      console.log(`[Dispatch] 指定的 Worker ${task.preferredWorkerNodeId} 不在线，fallback 到 ${targetWorker.nodeId}`);
    }

    // 更新 DB 状态
    const updated = await prisma.codeswarmTask.update({
      where: { id: task.id, state: 'queued' },
      data: {
        state: 'dispatched',
        workerId: targetWorker.id,
        startedAt: new Date(),
        updatedAt: new Date(),
      },
    }).catch(e => {
      console.error('[Dispatch] DB update failed:', e);
      return null;
    });

    if (!updated) {
      return NextResponse.json({ error: 'DB update failed - task may have been modified' }, { status: 400 });
    }

    // 发送任务到 Worker
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const addresses = targetWorker.address.split(',');
    const targetAddress = addresses[0].trim();
    console.log('[Dispatch] Sending to:', targetAddress);

    const resp = await fetch(`http://${targetAddress}/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: task.taskId,
        instruction: task.instruction || undefined,
        projectPath: task.projectPath || undefined,
        workspacePath: task.workspacePath || undefined,
        skills: task.skills ? JSON.parse(task.skills) : undefined,
        mcps: task.mcps ? JSON.parse(task.mcps) : undefined,
        model: task.model || undefined,
        apiKey: task.apiKey || undefined,
        timeoutSec: task.timeoutSec || undefined,
        callbackUrl: baseUrl,
        agent: task.agent || undefined,
        preferredWorkerNodeId: task.preferredWorkerNodeId || undefined,
        startCommand: task.startCommand || undefined,
        targetProduct: task.targetProduct || undefined,
      }),
      signal: AbortSignal.timeout(10000),
    }).catch(e => {
      console.error('[Dispatch] fetch error:', e.message);
      throw e;
    });

    console.log('[Dispatch] resp.ok:', resp.ok, 'status:', resp.status, 'statusText:', resp.statusText);
    const respText = await resp.text();
    console.log('[Dispatch] resp body:', respText.substring(0, 200));

    if (!resp.ok) {
      // Worker reports task already executing (dedup) - treat as success
      if (resp.status === 409) {
        return NextResponse.json({ success: true, taskId: task.taskId, note: 'Task already executing on worker' });
      }
      console.error('[Dispatch] Worker error response:', resp.status, respText);
      await prisma.codeswarmTask.update({
        where: { id: task.id },
        data: { state: 'queued', CodeswarmWorker: { disconnect: true }, updatedAt: new Date() },
      });
      return NextResponse.json({ error: 'Worker 请求失败' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      taskId: task.taskId,
      worker: { nodeId: targetWorker.nodeId, address: targetAddress },
    });
  } catch (err) {
    console.error('[Dispatch] Error:', err);
    return NextResponse.json({ error: 'Dispatch failed' }, { status: 500 });
  }
}