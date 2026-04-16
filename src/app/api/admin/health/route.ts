// src/app/api/admin/health/route.ts

import { NextResponse } from 'next/server';
import { runHealthChecks } from '@/lib/monitoring/health-check';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function GET() {
  try {
    const healthReport = await runHealthChecks();

    const statusCode = healthReport.status === 'healthy' ? 200
      : healthReport.status === 'degraded' ? 200
      : 503;

    return NextResponse.json(healthReport, { status: statusCode });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '健康检查失败', { details: { error: String(error) } });
    return NextResponse.json(
      {
        status: 'unhealthy',
        error: 'Health check failed',
        timestamp: new Date(),
      },
      { status: 503 }
    );
  }
}
