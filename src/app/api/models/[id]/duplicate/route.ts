import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';
import { generateId } from '@/lib/id-generator';
import { getTenantIdForCreate } from '@/lib/tenant-filter';

function canViewModel(
  userId: string,
  tenantId: string | null,
  isPlatformAdmin: boolean,
  isIcsTenant: boolean,
  model: { userId: string | null; tenantId: string | null; isPublic: boolean }
): boolean {
  if (isPlatformAdmin || isIcsTenant) return true;
  if (model.userId === userId) return true;
  if (model.isPublic) return true;
  if (model.userId === null) return true;
  if (tenantId && model.tenantId === tenantId) return true;
  return false;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) return authErrorResponse(auth);
  const { payload, tenant } = auth as AuthSuccessResult;

  try {
    const { id } = await params;

    const source = await prisma.modelConfig.findUnique({ where: { id } });
    if (!source) {
      return NextResponse.json({ error: '模型不存在' }, { status: 404 });
    }

    if (!canViewModel(payload.userId, tenant.tenantId, tenant.isPlatformAdmin, tenant.isIcsTenant, source)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const isPublic = (tenant.isIcsTenant || tenant.isPlatformAdmin) ? source.isPublic : false;
    const tenantId = getTenantIdForCreate(tenant, isPublic);

    const duplicated = await prisma.modelConfig.create({
      data: {
        id: generateId('model'),
        userId: payload.userId,
        tenantId,
        name: `${source.name}-副本`,
        providerType: source.providerType,
        apiBaseUrl: source.apiBaseUrl,
        apiKey: source.apiKey,
        models: source.models,
        routeType: source.routeType,
        maxTokens: source.maxTokens,
        contextWindow: source.contextWindow,
        temperature: source.temperature,
        isActive: source.isActive,
        isDefault: false,
        isPublic,
        updatedAt: new Date(),
      },
    });

    logger.create(LOG_MODULES.MODEL, payload, duplicated.id, { name: duplicated.name, duplicatedFrom: id });

    return NextResponse.json({ model: duplicated }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MODEL, '复制模型配置失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
