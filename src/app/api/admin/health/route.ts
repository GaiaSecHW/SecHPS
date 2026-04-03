// src/app/api/admin/health/route.ts

import { NextResponse } from 'next/server';
import { runHealthChecks } from '@/lib/monitoring/health-check';

export async function GET() {
  try {
    const healthReport = await runHealthChecks();

    const statusCode = healthReport.status === 'healthy' ? 200
      : healthReport.status === 'degraded' ? 200
      : 503;

    return NextResponse.json(healthReport, { status: statusCode });
  } catch (error) {
    console.error('Health check error:', error);
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
