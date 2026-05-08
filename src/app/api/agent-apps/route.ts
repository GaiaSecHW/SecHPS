import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { buildTenantFilter, getTenantIdForCreate, getVisibility } from '@/lib/tenant-filter';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const { tenant, payload } = auth as AuthSuccessResult;

  try {
    // 平台管理员或 ICSL 可以看所有，其他按租户过滤
    let apps;
    if (tenant.isPlatformAdmin || tenant.isIcsTenant) {
      apps = await prisma.agentApp.findMany({
        orderBy: { createdAt: 'desc' },
      });
    } else {
      const filter = buildTenantFilter(tenant, {
        tenantField: 'tenantId',
        visibilityField: 'visibility',
      });
      apps = await prisma.agentApp.findMany({
        where: {
          OR: [{ ...filter }, { userId: payload.userId }],
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    return NextResponse.json({ apps });
  } catch (error) {
    console.error('获取应用列表失败:', error);
    return NextResponse.json({ error: '获取应用列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const { tenant, payload } = auth as AuthSuccessResult;

  try {
    const formData = await request.formData();

    const name = formData.get('name') as string;
    const engine = formData.get('engine') as string;
    const startCommand = formData.get('startCommand') as string;
    const notes = formData.get('notes') as string | null;
    const isPublic = formData.get('isPublic') === 'true';

    if (!name || !engine || !startCommand) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    // 验证：只有 ICSL 或平台管理员可创建 public
    if (isPublic && !tenant.isIcsTenant && !tenant.isPlatformAdmin) {
      return NextResponse.json(
        { error: '只有 ICSL 租户可以创建公共资源' },
        { status: 403 }
      );
    }

    const visibility = getVisibility(isPublic);
    const tenantId = getTenantIdForCreate(tenant, isPublic);

    const app = await prisma.agentApp.create({
      data: {
        id: crypto.randomUUID(),
        userId: payload.userId,
        name,
        engine,
        skillPath: `/agent-apps/${crypto.randomUUID()}/skill`,
        startCommand,
        notes: notes || null,
        status: 'active',
        tenantId,
        visibility,
      },
    });

    return NextResponse.json({ app });
  } catch (error) {
    console.error('创建应用失败:', error);
    return NextResponse.json({ error: '创建应用失败' }, { status: 500 });
  }
}
