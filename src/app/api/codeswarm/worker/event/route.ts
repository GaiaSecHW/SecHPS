import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { taskId, nodeId, events } = body;

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    const task = await prisma.codeswarmTask.findUnique({
      where: { taskId },
    });

    if (task) {
      const existingEvents = task.events ? JSON.parse(task.events) : [];
      const updatedEvents = [...existingEvents, ...(events || [])];

      await prisma.codeswarmTask.update({
        where: { taskId },
        data: {
          events: JSON.stringify(updatedEvents),
          state: events?.some((e: { type: string }) => e.type === 'error') ? 'running' : task.state,
          updatedAt: new Date(),
        },
      });
    }

    return NextResponse.json({ success: true, eventCount: events?.length || 0 });
  } catch (error) {
    console.error('[CodeSwarm] Event callback error:', error);
    return NextResponse.json(
      { error: 'Failed to record events' },
      { status: 500 }
    );
  }
}