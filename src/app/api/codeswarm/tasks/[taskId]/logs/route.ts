import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const url = new URL(request.url);

    const level = url.searchParams.get('level') || 'all';
    const stream = url.searchParams.get('stream') || 'all';
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0'));
    const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') || '200')), 500);

    const whereClause: any = { taskId };
    if (level !== 'all') whereClause.level = level;
    if (stream !== 'all') whereClause.stream = stream;

    const [countResult, events] = await Promise.all([
      prisma.codeswarmEvent.count({ where: whereClause }),
      prisma.codeswarmEvent.findMany({
        where: whereClause,
        orderBy: { createdAt: 'asc' },
        skip: offset,
        take: limit,
      }),
    ]);

    const logs = events.map(e => ({
      id: e.id,
      taskId: e.taskId,
      type: e.type,
      data: e.data,
      level: e.level,
      stream: e.stream,
      createdAt: e.createdAt.toISOString(),
    }));

    return NextResponse.json({ logs, total: countResult });
  } catch (error) {
    logger.error(LOG_MODULES.CODESWARM, 'Get task logs error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
  }
}
