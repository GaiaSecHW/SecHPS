// src/app/api/admin/health/route.ts

import { NextResponse } from 'next/server';
import { runHealthChecks } from '@/lib/monitoring/health-check';
import { logger, LOG_MODULES } from '@/lib/logger';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';

/**
 * GET /api/admin/health
 * 获取系统健康报告（需要管理员权限）
 * 
 * 安全修复：添加认证和权限检查
 */
export async function GET(request: Request) {
  // 认证检查
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_READ });
  if (!auth.success) {
    return authErrorResponse(auth);
  }

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
