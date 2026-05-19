import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const { tenant, payload } = auth as AuthSuccessResult;
  const { id } = await params;

  try {
    const apiKey = await prisma.apiKey.findUnique({ where: { id } });
    if (!apiKey) {
      return NextResponse.json({ error: 'API Key 不存在' }, { status: 404 });
    }

    // Permission check: owner, admin/icsl, or same tenant
    const isAdmin = tenant.isPlatformAdmin || tenant.isIcsTenant;
    const isOwner = apiKey.userId === payload.userId;
    const sameTenant = apiKey.tenantId && apiKey.tenantId === tenant.tenantId;
    if (!isAdmin && !isOwner && !sameTenant) {
      return NextResponse.json({ error: '无权操作此 API Key' }, { status: 403 });
    }

    if (apiKey.revokedAt) {
      return NextResponse.json({ error: 'API Key 已被撤销' }, { status: 400 });
    }

    await prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    return NextResponse.json({ message: 'API Key 已撤销' });
  } catch (error) {
    console.error('[API Keys] DELETE error:', error);
    return NextResponse.json({ error: '撤销 API Key 失败' }, { status: 500 });
  }
}
