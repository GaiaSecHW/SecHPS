import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const url = new URL(request.url);
    
    const level = url.searchParams.get('level') || 'all';
    const stream = url.searchParams.get('stream') || 'all';

    const whereClause: any = { taskId };
    if (level !== 'all') {
      whereClause.level = level;
    }
    if (stream !== 'all') {
      whereClause.stream = stream;
    }

    const events = await prisma.codeswarmEvent.findMany({
      where: whereClause,
      orderBy: { createdAt: 'asc' },
    });

    const logs = events.map(e => ({
      id: e.id,
      taskId: e.taskId,
      type: e.type,
      data: e.data,
      level: e.level,
      stream: e.stream,
      createdAt: e.createdAt.toISOString(),
    }));

    return NextResponse.json({
      logs,
      total: logs.length,
    });
  } catch (error) {
    console.error('[CodeSwarm] Get task logs error:', error);
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
  }
}