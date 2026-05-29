// src/app/api/vulnerabilities/[id]/verify/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequestEnhanced(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const { payload, tenant } = auth as AuthSuccessResult;
    
    const { id } = await params;
    
    const isPrivileged = tenant.isPlatformAdmin || (tenant.isIcsTenant && payload.roles.includes('admin'));

    const vulnerability = await prisma.vulnerability.findFirst({ 
      where: {
        id,
        ...(isPrivileged ? {} : { Project: { userId: payload.userId } }),
      },
      include: { Project: { select: { userId: true } } },
    });
    if (!vulnerability) {
      return NextResponse.json({ error: '漏洞不存在或无权限访问' }, { status: 404 });
    }

    if (vulnerability.status !== 'fixed') {
      return NextResponse.json({ error: '只有已修复的漏洞才能验证' }, { status: 400 });
    }

    const updated = await prisma.vulnerability.update({
      where: { id },
      data: {
        status: 'verified',
        verifiedBy: payload.userId,
        verifiedAt: new Date(),
      },
    });

    logger.update(LOG_MODULES.VULNERABILITY, payload, id, { action: 'verify' });

    return NextResponse.json({ vulnerability: updated });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.VULNERABILITY, '验证修复错误', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}