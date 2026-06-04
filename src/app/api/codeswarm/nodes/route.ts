import { NextResponse } from 'next/server';
import { prisma, Prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function GET() {
  try {
    // 使用 $queryRaw 替代 findMany，避免远程 PostgreSQL 挂起问题
    const workers = await prisma.$queryRaw`
      SELECT id, "nodeId", address, "systemType", arch, status, "maxConcurrent", "currentTasks",
             token, "lastHeartbeat", "createdAt", "updatedAt"
      FROM "CodeswarmWorker"
      ORDER BY "lastHeartbeat" DESC
      LIMIT 100
    ` as any[];
    
    const activeCounts = await prisma.$queryRaw`
      SELECT "workerId", COUNT(*)::int as "activeCount"
      FROM "CodeswarmTask"
      WHERE state IN ('dispatched', 'running')
      GROUP BY "workerId"
    ` as { workerId: string; activeCount: number }[];

    const countMap = new Map(activeCounts.map(r => [r.workerId, r.activeCount]));

    const result = workers.map(w => ({
      ...w,
      currentTasks: countMap.get(w.id) ?? 0,
    }));

    return NextResponse.json({ workers: result });
  } catch (error) {
    logger.error(LOG_MODULES.CODESWARM, 'Get nodes error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: 'Failed to fetch nodes' }, { status: 500 });
  }
}