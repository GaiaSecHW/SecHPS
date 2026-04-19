// src/app/api/admin/skills-governance/status/route.ts
// Skills Governance - 治理状态概览 API

import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/admin/skills-governance/status
 * 获取治理状态概览
 * 
 * 返回:
 * - migration: 迁移统计 (total, migrated, pending_review, failed, analyzing)
 * - duplicateGroups: 重复组统计 (total, pending_review, resolved)
 * - pendingReviews: 待审核数量 (analyses, mergeRecords)
 */
export async function GET(request: Request) {
  try {
    // 1. 认证和权限检查
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.SKILL_GOVERNANCE_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }

    // 2. 获取重复组统计
    const duplicateGroupStats = await prisma.skillDuplicateGroup.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    const duplicateGroups = {
      total: duplicateGroupStats.reduce((sum, g) => sum + g._count.id, 0),
      pending_review: duplicateGroupStats.find(g => g.status === 'pending_review')?._count.id || 0,
      resolved: duplicateGroupStats.find(g => g.status === 'resolved')?._count.id || 0,
    };

    // 4. 获取重复组成员总数
    const duplicateGroupMemberCount = await prisma.skillDuplicateGroupMember.count();

    // 5. 获取待审核的分析记录数量
    const pendingAnalyses = await prisma.skillAnalysis.count({
      where: { reviewStatus: 'pending' },
    });

    // 6. 获取待审核的合并记录数量
    const pendingMergeRecords = await prisma.skillMergeRecord.count({
      where: { status: 'pending' },
    });

    // 7. 获取待处理的影响分析数量
    const pendingImpactAnalysis = await prisma.skillNewImpactAnalysis.count({
      where: { status: 'pending' },
    });

    // 8. 组装响应
    const statusOverview = {
      duplicateGroups: {
        ...duplicateGroups,
        memberCount: duplicateGroupMemberCount,
      },
      pendingReviews: {
        analyses: pendingAnalyses,
        mergeRecords: pendingMergeRecords,
        impactAnalysis: pendingImpactAnalysis,
      },
      lastUpdated: new Date().toISOString(),
    };

    logger.access(LOG_MODULES.SKILL, auth.payload, 'skills_governance_status', {});

    return NextResponse.json({ data: statusOverview }, { status: 200 });

  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '获取治理状态概览失败', {
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}