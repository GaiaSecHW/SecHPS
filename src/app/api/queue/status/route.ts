import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export async function GET(request: Request) {
  try {
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponseNested(auth);
    }

    const stateRows = await prisma.$queryRaw<{ state: string; count: number }[]>`
      SELECT state, COUNT(*)::int as count FROM "CodeswarmTask" GROUP BY state
    `;

    const stateMap: Record<string, number> = {};
    for (const row of stateRows) {
      stateMap[row.state] = row.count;
    }

    const activeCount =
      (stateMap['running'] || 0) +
      (stateMap['building'] || 0) +
      (stateMap['dispatched'] || 0);
    const queuedCount = stateMap['queued'] || 0;

    const workerRows = await prisma.$queryRaw<{ maxConcurrent: number }[]>`
      SELECT COALESCE(SUM("maxConcurrent"), 0)::int as maxConcurrent FROM "CodeswarmWorker" WHERE status = 'online'
    `;
    const maxConcurrent = workerRows[0]?.maxConcurrent || 0;

    const queuedTasks = await prisma.$queryRaw<{ id: string; taskId: string; instruction: string | null; createdAt: Date }[]>`
      SELECT id, "taskId", instruction, "createdAt" FROM "CodeswarmTask" WHERE state = 'queued' ORDER BY "createdAt" ASC LIMIT 50
    `;

    const queuedEvaluations = queuedTasks.map((t, i) => ({
      id: t.id,
      taskName: t.instruction ? (t.instruction.length > 30 ? t.instruction.slice(0, 30) + '...' : t.instruction) : t.taskId,
      createdAt: t.createdAt,
      queuePosition: i + 1,
    }));

    return NextResponse.json({
      activeCount,
      queuedCount,
      maxConcurrent,
      queuedEvaluations,
    });
  } catch (error) {
    logger.errorNoUser('QUEUE', '获取队列状态失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}