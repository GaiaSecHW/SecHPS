import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { buildTenantFilter } from '@/lib/tenant-filter';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const { tenant, payload } = auth as AuthSuccessResult;

  try {
    const include = {
      AgentApp: {
        select: {
          id: true,
          name: true,
          engine: true,
        },
      },
    };

    let pipelines;
    if (tenant.isPlatformAdmin || tenant.isIcsTenant) {
      pipelines = await prisma.agentFlowPipeline.findMany({
        include,
        orderBy: { createdAt: 'desc' },
      });
    } else {
      const filter = buildTenantFilter(tenant, {
        tenantField: 'tenantId',
        isPublicField: 'isPublic',
      });
      pipelines = await prisma.agentFlowPipeline.findMany({
        where: {
          OR: [{ ...filter }, { userId: payload.userId }],
        },
        include,
        orderBy: { createdAt: 'desc' },
      });
    }

    return NextResponse.json({ pipelines });
  } catch (error) {
    console.error('获取 Pipeline 列表失败:', error);
    return NextResponse.json(
      { error: '获取 Pipeline 列表失败', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const { tenant, payload } = auth as AuthSuccessResult;

  try {
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json({ error: 'name 是必填字段' }, { status: 400 });
    }

    const tenantId = tenant.isPlatformAdmin ? null : tenant.tenantId;

    const pipeline = await prisma.agentFlowPipeline.create({
      data: {
        name,
        nodes: [],
        edges: [],
        status: 'draft',
        userId: payload.userId,
        tenantId,
        isPublic: false,
      },
    });

    return NextResponse.json({ pipeline });
  } catch (error) {
    console.error('创建 Pipeline 失败:', error);
    return NextResponse.json(
      { error: '创建 Pipeline 失败', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
