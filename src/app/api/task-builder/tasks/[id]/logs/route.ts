import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

const DETAILS_TRUNCATE_SIZE = 5_000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
  if (!auth.success) return authErrorResponse(auth);

  const { payload, tenant } = auth as AuthSuccessResult;
  const { id } = await params;

  const offset = Math.max(0, parseInt(request.nextUrl.searchParams.get('offset') || '0'));
  const limit = Math.min(Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') || '100')), 500);

  try {
    const task = await prisma.taskInstance.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    if (!tenant.isPlatformAdmin && !tenant.isIcsTenant && !payload.roles?.includes('admin') && task.userId !== payload.userId) {
      return NextResponse.json({ error: '无权访问此任务' }, { status: 403 });
    }

    const countRows = await prisma.$queryRaw`
      SELECT COUNT(*)::int as cnt FROM "TaskExecutionLog"
      WHERE "taskId" = ${id}
    ` as any[];
    const total = countRows[0]?.cnt ?? 0;

    let logs: any[] = [];
    if (total > 0) {
      logs = await prisma.$queryRaw`
        SELECT id, timestamp, level, message, details
        FROM "TaskExecutionLog"
        WHERE "taskId" = ${id}
        ORDER BY timestamp ASC
        LIMIT ${limit}
        OFFSET ${offset}
      ` as any[];

      for (const log of logs) {
        if (typeof log.details === 'string' && log.details.length > DETAILS_TRUNCATE_SIZE) {
          log.details = log.details.slice(0, DETAILS_TRUNCATE_SIZE) + '\n... [已截断]';
        }
      }
    }

    return NextResponse.json({ logs, total });
  } catch (error) {
    logger.error(LOG_MODULES.AGENT, '获取任务日志失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '获取任务日志失败' }, { status: 500 });
  }
}
