import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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

    return NextResponse.json({ success: true, nodeId });
  } catch (error) {
    console.error('[CodeSwarm] Heartbeat error:', error);
    return NextResponse.json(
      { error: 'Failed to register heartbeat' },
      { status: 500 }
    );
  }
}