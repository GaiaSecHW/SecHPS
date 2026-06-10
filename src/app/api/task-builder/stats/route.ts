import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.SESSION_CREATE });
  if (!auth.success) return authErrorResponse(auth);

  const { payload, tenant } = auth as AuthSuccessResult;
  const isAdmin = tenant.isPlatformAdmin || (tenant.isIcsTenant && payload.roles?.includes('admin'));

  const statusExpr = `CASE
    WHEN ti."codeswarmTaskId" IS NULL OR ct.state IS NULL THEN
      CASE ti.status WHEN 'completed' THEN 'completed' WHEN 'failed' THEN 'failed' WHEN 'running' THEN 'running' ELSE 'pending' END
    ELSE
      CASE ct.state WHEN 'queued' THEN 'queued' WHEN 'dispatched' THEN 'dispatched' WHEN 'building' THEN 'running' WHEN 'running' THEN 'running' WHEN 'completed' THEN 'completed' WHEN 'failed' THEN 'failed' ELSE 'pending' END
  END`;

  const whereClause = isAdmin ? '' : `WHERE ti."userId" = '${payload.userId}'`;

  const rows = await prisma.$queryRawUnsafe<{ display_status: string; count: number }[]>(
    `SELECT (${statusExpr}) as display_status, COUNT(*)::int as count
     FROM "TaskInstance" ti
     LEFT JOIN "CodeswarmTask" ct ON ti."codeswarmTaskId" = ct."taskId"
     ${whereClause}
     GROUP BY display_status`
  );

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.display_status] = row.count;
  }

  const queued = result['queued'] || 0;
  const dispatched = result['dispatched'] || 0;
  const executing = result['running'] || 0;
  const pending = result['pending'] || 0;
  const completed = result['completed'] || 0;
  const failed = result['failed'] || 0;
  const running = queued + dispatched + executing;
  const total = queued + dispatched + executing + pending + completed + failed;

  return NextResponse.json({
    stats: {
      total,
      completed,
      failed,
      running,
      pending,
      queued,
      dispatched,
      executing,
    },
  });
}