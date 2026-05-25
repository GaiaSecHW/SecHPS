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

    return NextResponse.json({ workers });
  } catch (error) {
    logger.error(LOG_MODULES.CODESWARM, 'Get nodes error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: 'Failed to fetch nodes' }, { status: 500 });
  }
}