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