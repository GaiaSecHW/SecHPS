// src/app/api/admin/skills-governance/stats/route.ts
// Skills Governance - 统计摘要 API

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { getStatsSummary } from '@/services/skill-observation-stats';

// GET /api/admin/skills-governance/stats - 获取统计摘要
export async function GET(request: Request) {
  try {
    // 1. 认证和权限检查
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    // 2. 获取统计摘要
    const statsSummary = await getStatsSummary();

    logger.access(LOG_MODULES.SKILL, auth.payload, 'skills_governance_stats', {});

    return NextResponse.json({ data: statsSummary }, { status: 200 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取 Skills Governance 统计摘要失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}