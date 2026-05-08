import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  try {
    const { nodeId } = await params;

    const worker = await prisma.codeswarmWorker.findUnique({
      where: { nodeId },
      include: {
        CodeswarmTask: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!worker) {
      return NextResponse.json({ error: 'Worker not found' }, { status: 404 });
    }

    return NextResponse.json({
      worker: {
        ...worker,
        tasks: worker.CodeswarmTask.map(t => ({
          ...t,
          skills: t.skills ? JSON.parse(t.skills) : null,
          mcps: t.mcps ? JSON.parse(t.mcps) : null,
          events: t.events ? JSON.parse(t.events) : null,
        })),
      },
    });
  } catch (error) {
    console.error('[CodeSwarm] Get node error:', error);
    return NextResponse.json({ error: 'Failed to fetch node' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  try {
    const { nodeId } = await params;
    const body = await request.json();
    const { maxConcurrent, name, status } = body;

    const data: Record<string, any> = { updatedAt: new Date() };
    if (maxConcurrent !== undefined) data.maxConcurrent = Math.max(1, Math.min(50, maxConcurrent));
    if (name !== undefined) data.name = name;
    if (status !== undefined) data.status = status;

    const worker = await prisma.codeswarmWorker.update({
      where: { nodeId },
      data,
    });

    return NextResponse.json({ success: true, worker });
  } catch (error) {
    console.error('[CodeSwarm] Patch node error:', error);
    return NextResponse.json({ error: 'Failed to update node' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  try {
    const { nodeId } = await params;

    await prisma.codeswarmWorker.delete({ where: { nodeId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[CodeSwarm] Delete node error:', error);
    return NextResponse.json({ error: 'Failed to delete node' }, { status: 500 });
  }
}