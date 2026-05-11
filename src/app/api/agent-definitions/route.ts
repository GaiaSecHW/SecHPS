import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { prisma } from '@/lib/prisma';
import { buildTenantFilter } from '@/lib/tenant-filter';

// GET /api/agent-definitions - 获取 Agent 定义列表
// 支持多租户隔离：
// - ICSL/Admin: 可见全部
// - 普通租户: 自己的 + public + 同租户的 + 系统内置
export async function GET(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.AGENT_READ });
  if (!auth.success) return authErrorResponse(auth);

  const { payload, tenant } = auth as AuthSuccessResult;

  try {
    // 构建查询条件
    const where: Record<string, unknown> = { isActive: true };

    if (tenant.isPlatformAdmin || tenant.isIcsTenant) {
      // 管理员/ICSL: 可见全部
    } else {
      // 普通用户: public + 同租户 + 自己创建的 + 系统内置
      const tenantFilter = buildTenantFilter(tenant, {
        tenantField: 'tenantId',
        isPublicField: 'isPublic',
      });
      where.OR = [
        { userId: null },           // 系统内置
        { userId: payload.userId }, // 自己创建的
        { ...tenantFilter },        // public + 同租户
      ];
    }

    const agents = await prisma.agentDefinition.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        displayName: true,
        description: true,
        category: true,
        model: true,
        skills: true,
        isBuiltin: true,
        isPublic: true,
        tenantId: true,
        userId: true,
      },
    });

    return NextResponse.json({ agents });
  } catch (error) {
    console.error('获取 Agent 列表失败:', error);
    return NextResponse.json({ error: '获取 Agent 列表失败' }, { status: 500 });
  }
}