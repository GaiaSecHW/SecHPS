import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';

// GET /api/admin/tenants/[id] - 获取租户详情
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const successAuth = auth as AuthSuccessResult;
  if (!successAuth.tenant.isPlatformAdmin) {
    return NextResponse.json({ error: '禁止访问' }, { status: 403 });
  }

  const { id } = await params;
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: {
      _count: { select: { users: true } },
    },
  });

  if (!tenant) {
    return NextResponse.json({ error: '租户不存在' }, { status: 404 });
  }

  return NextResponse.json({
    tenant: {
      ...tenant,
      userCount: tenant._count.users,
      _count: undefined,
    },
  });
}

// PATCH /api/admin/tenants/[id] - 更新租户
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const successAuth = auth as AuthSuccessResult;
  if (!successAuth.tenant.isPlatformAdmin) {
    return NextResponse.json({ error: '禁止访问' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();

  const tenant = await prisma.tenant.update({
    where: { id },
    data: {
      name: body.name,
      isIcsTenant: body.isIcsTenant,
    },
  });

  return NextResponse.json({ tenant });
}

// DELETE /api/admin/tenants/[id] - 删除租户
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const successAuth = auth as AuthSuccessResult;
  if (!successAuth.tenant.isPlatformAdmin) {
    return NextResponse.json({ error: '禁止访问' }, { status: 403 });
  }

  const { id } = await params;

  // 检查是否有用户关联
  const userCount = await prisma.user.count({ where: { tenantId: id } });
  if (userCount > 0) {
    return NextResponse.json({ error: '租户下有用户，无法删除' }, { status: 400 });
  }

  await prisma.tenant.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
