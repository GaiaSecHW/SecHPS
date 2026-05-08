import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';

// GET /api/admin/tenants/[id]/users - 获取租户用户列表
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
  const users = await prisma.user.findMany({
    where: { tenantId: id },
    select: {
      id: true,
      email: true,
      username: true,
      name: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ users });
}

// POST /api/admin/tenants/[id]/users - 将用户分配到租户
export async function POST(
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
  const { userId } = body;

  if (!userId) {
    return NextResponse.json({ error: 'userId 是必填的' }, { status: 400 });
  }

  // 检查租户是否存在
  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (!tenant) {
    return NextResponse.json({ error: '租户不存在' }, { status: 404 });
  }

  // 检查用户是否存在
  const targetUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!targetUser) {
    return NextResponse.json({ error: '用户不存在' }, { status: 404 });
  }

  // 更新用户租户关联
  const user = await prisma.user.update({
    where: { id: userId },
    data: { tenantId: id },
    select: {
      id: true,
      email: true,
      username: true,
      name: true,
    },
  });

  return NextResponse.json({ user }, { status: 201 });
}

// DELETE /api/admin/tenants/[id]/users - 从租户移除用户
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
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({ error: 'userId 参数是必填的' }, { status: 400 });
  }

  // 检查租户是否存在
  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (!tenant) {
    return NextResponse.json({ error: '租户不存在' }, { status: 404 });
  }

  // 检查用户是否存在且属于该租户
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: '用户不存在' }, { status: 404 });
  }
  if (user.tenantId !== id) {
    return NextResponse.json({ error: '用户不属于该租户' }, { status: 400 });
  }

  // 检查是否为 admin 用户，admin 不能被移除租户
  if (user.username === 'admin') {
    return NextResponse.json({ error: '不能从平台管理员移除租户' }, { status: 400 });
  }

  // 将用户从租户移除（tenantId 设为 null，用户变成无租户状态）
  await prisma.user.update({
    where: { id: userId },
    data: { tenantId: null },
  });

  return NextResponse.json({ message: '用户已从租户移除' });
}
