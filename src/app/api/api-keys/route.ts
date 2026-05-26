import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const { tenant, payload } = auth as AuthSuccessResult;

  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';

    const where: any = {};
    if (search) where.name = { contains: search, mode: 'insensitive' };

    if (tenant.isPlatformAdmin || tenant.isIcsTenant) {
      // Admin/ICSL sees all
    } else if (tenant.tenantId) {
      where.tenantId = tenant.tenantId;
    } else {
      where.userId = payload.userId;
    }

    const apiKeys = await prisma.apiKey.findMany({
      where,
      include: {
        tenant: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ apiKeys });
  } catch (error) {
    logger.error(LOG_MODULES.AUTH, 'GET error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '获取 API Key 列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);

  const { tenant, payload } = auth as AuthSuccessResult;

  try {
    const body = await request.json();
    const { name, tenantId, agentAppIds = [], rateLimitInterval = 1 } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: '请输入 API Key 名称' }, { status: 400 });
    }

    // Resolve tenant: admin can pick, regular user uses own tenant
    const resolvedTenantId = tenant.isPlatformAdmin || tenant.isIcsTenant
      ? (tenantId || null)
      : (tenant.tenantId || null);

    // Generate key: icsl-<32 random hex chars>
    const rawKey = `icsl-${crypto.randomBytes(24).toString('hex')}`;
    const keyPrefix = rawKey.substring(0, 12);
    const keyHash = await bcrypt.hash(rawKey, 10);

    const apiKey = await prisma.apiKey.create({
      data: {
        name: name.trim(),
        keyHash,
        keyPrefix,
        tenantId: resolvedTenantId,
        userId: payload.userId,
        rateLimitInterval,
        ...(agentAppIds.length > 0 && {
          allowedAgents: {
            create: agentAppIds.map((agentId: string) => ({ agentAppId: agentId })),
          },
        }),
      },
    });

    return NextResponse.json({
      id: apiKey.id,
      key: rawKey,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
    }, { status: 201 });
  } catch (error) {
    logger.error(LOG_MODULES.AUTH, 'POST error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: '创建 API Key 失败' }, { status: 500 });
  }
}
