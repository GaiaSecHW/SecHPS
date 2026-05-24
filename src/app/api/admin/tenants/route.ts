import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import { generateId } from '@/lib/id-generator';
import type { AuthSuccessResult } from '@/lib/api-auth';

// GET /api/admin/tenants - 列出所有租户
export async function GET(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const successAuth = auth as AuthSuccessResult;
  // 只有平台管理员可以访问
  if (!successAuth.tenant.isPlatformAdmin) {
    return NextResponse.json({ error: '禁止访问' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';

  const where = search ? {
    OR: [
      { name: { contains: search } },
      { slug: { contains: search } },
    ],
  } : {};

  const tenants = await prisma.tenant.findMany({
    where,
    include: {
      _count: {
        select: { User: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({
    tenants: tenants.map(t => ({
      ...t,
      userCount: t._count.User,
      _count: undefined,
    })),
  });
}

// POST /api/admin/tenants - 创建租户
export async function POST(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const successAuth = auth as AuthSuccessResult;
  if (!successAuth.tenant.isPlatformAdmin) {
    return NextResponse.json({ error: '禁止访问' }, { status: 403 });
  }

  const body = await request.json();
  const { name, isIcsTenant } = body;

  if (!name) {
    return NextResponse.json({ error: 'name 是必填的' }, { status: 400 });
  }

  // 基于 name 自动生成唯一 slug
  const baseSlug = name.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '') || `tenant`;
  let slug = baseSlug;
  let suffix = 1;
  while (await prisma.tenant.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${suffix++}`;
  }

  const tenant = await prisma.tenant.create({
    data: {
      id: generateId('tenant'),
      name,
      slug,
      isIcsTenant: isIcsTenant ?? false,
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({ tenant }, { status: 201 });
}
