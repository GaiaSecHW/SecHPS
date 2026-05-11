// 导出所有 Skills 为 JSON 文件

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequestEnhanced, authErrorResponseNested, isAdmin } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';
import { buildTenantFilter } from '@/lib/tenant-filter';

// GET /api/skills/export - 导出 Skills
export async function GET(request: Request) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const { payload, tenant } = auth as AuthSuccessResult;

  try {
    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);
    if (!userIsAdmin) {
      return NextResponse.json({ details: { error: '需要管理员权限' } }, { status: 403 });
    }

    // 非平台管理员/ICSL 只能导出本租户的 Skills
    const where: Record<string, unknown> = {};
    if (!tenant.isPlatformAdmin && !tenant.isIcsTenant) {
      const tenantFilter = buildTenantFilter(tenant, {
        tenantField: 'tenantId',
        isPublicField: 'isPublic',
      });
      where.OR = [
        { userId: null },
        { userId: payload.userId },
        { ...tenantFilter },
      ];
    }

    const skills = await prisma.skill.findMany({
      where,
      orderBy: [{ displayName: 'asc' }],
    });

    // 转换为导出格式
    const exportData = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      totalCount: skills.length,
      skills: skills.map(skill => ({
        name: skill.name,
        displayName: skill.displayName,
        description: skill.description,
        categoryId: skill.categoryId,
        vulnerabilityTreeId: skill.vulnerabilityTreeId,
        severity: skill.severity,
        content: skill.content,
        cwe: skill.cwe,
        isActive: skill.isActive,
        isBuiltin: skill.isBuiltin,
        version: skill.version,
        parentId: skill.parentId,
        isLatest: skill.isLatest,
        successRate: skill.successRate,
        avgDuration: skill.avgDuration,
        execCount: skill.execCount,
        createdAt: skill.createdAt,
        updatedAt: skill.updatedAt,
      })),
    };

    return NextResponse.json(exportData);
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '导出 Skills 错误', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
