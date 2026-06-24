import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';
import { buildTenantFilter } from '@/lib/tenant-filter';

function isValidIntegerRange(value: unknown, min: number, max: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isValidNumberRange(value: unknown, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

// 格式化模型数据 - 不返回 apiKey 以保护安全
function formatModel(model: any, includeApiKey: boolean = false) {
  return {
    id: model.id,
    userId: model.userId,
    tenantId: model.tenantId,
    tenantName: model.Tenant?.name || null,
    name: model.name,
    providerType: model.providerType,
    apiBaseUrl: model.apiBaseUrl,
    apiKey: includeApiKey ? model.apiKey : undefined,
    hasApiKey: !!model.apiKey,
    models: JSON.parse(model.models),
    routeType: model.routeType,
    maxTokens: model.maxTokens ?? 65536,
    contextWindow: model.contextWindow ?? 130000,
    temperature: model.temperature ?? 0.3,
    isActive: model.isActive,
    isDefault: model.isDefault,
    isPublic: model.isPublic,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

// 检查用户是否有权限查看模型（多租户）
function canViewModel(
  userId: string,
  tenantId: string | null,
  isPlatformAdmin: boolean,
  isIcsTenant: boolean,
  model: { userId: string | null; tenantId: string | null; isPublic: boolean }
): boolean {
  // 平台管理员和 ICSL 租户可以查看所有
  if (isPlatformAdmin || isIcsTenant) return true;
  // 用户可以查看自己的模型
  if (model.userId === userId) return true;
  // 用户可以查看公开的模型
  if (model.isPublic) return true;
  // 用户可以查看系统级模型（userId为null）
  if (model.userId === null) return true;
  // 同租户可以查看
  if (tenantId && model.tenantId === tenantId) return true;
  return false;
}

// 检查用户是否有权限管理模型（多租户）
function canManageModel(
  userId: string,
  isPlatformAdmin: boolean,
  isIcsTenant: boolean,
  model: { userId: string | null; tenantId: string | null; isPublic: boolean }
): boolean {
  // 平台管理员和 ICSL 租户可以管理所有
  if (isPlatformAdmin || isIcsTenant) return true;
  // 用户只能管理自己的模型（非 public）
  if (model.userId === userId && !model.isPublic) return true;
  // public 资源不能被普通租户修改
  return false;
}

// 获取单个模型详情
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload, tenant } = auth as AuthSuccessResult;

  try {
    const { id } = await params;

    const model = await prisma.modelConfig.findUnique({
      where: { id },
      include: {
        User: { select: { id: true, email: true, username: true } },
        Tenant: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!model) {
      return NextResponse.json({ error: '模型不存在' }, { status: 404 });
    }

    // 检查访问权限（多租户）
    if (!canViewModel(payload.userId, tenant.tenantId, tenant.isPlatformAdmin, tenant.isIcsTenant, model)) {
      logger.permissionDenied(LOG_MODULES.MODEL, payload, 'MODEL_READ', id, { modelName: model.name });
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 记录读取日志
    if (model.userId && model.userId !== payload.userId) {
      logger.readOther(LOG_MODULES.MODEL, payload, model.userId, model.User?.email, 'model', id, { name: model.name });
    } else if (!model.userId) {
      logger.read(LOG_MODULES.MODEL, payload, 'system_model', id, { name: model.name, isSystem: true });
    } else {
      logger.read(LOG_MODULES.MODEL, payload, 'model', id, { name: model.name });
    }

    return NextResponse.json({ model: formatModel(model) });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MODEL, '获取模型详情失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 更新模型配置
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload, tenant } = auth as AuthSuccessResult;

  try {
    const { id } = await params;

    const existingModel = await prisma.modelConfig.findUnique({
      where: { id },
      include: {
        User: { select: { id: true, email: true, username: true } },
        Tenant: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!existingModel) {
      return NextResponse.json({ error: '模型不存在' }, { status: 404 });
    }

    // 检查管理权限（多租户）
    if (!canManageModel(payload.userId, tenant.isPlatformAdmin, tenant.isIcsTenant, existingModel)) {
      logger.permissionDenied(LOG_MODULES.MODEL, payload, 'MODEL_UPDATE', id, { modelName: existingModel.name });
      return NextResponse.json({ error: '禁止访问：只能更新自己创建的模型' }, { status: 403 });
    }

    const body = await request.json();
    const { name, providerType, apiBaseUrl, apiKey, models, routeType, maxTokens, contextWindow, temperature, isActive, isPublic, isSystemModel, isDefault, assignedTenantId } = body;

    // 验证 providerType
    const validProviderTypes = ['claude', 'openai'];
    if (providerType && !validProviderTypes.includes(providerType)) {
      return NextResponse.json(
        { error: '无效的代理类型，必须是 claude 或 openai' },
        { status: 400 }
      );
    }

    // 验证 routeType
    const validRouteTypes = ['default', 'think', 'background', 'longContext', 'webSearch'];
    if (providerType === 'openai' && routeType && !validRouteTypes.includes(routeType)) {
      return NextResponse.json(
        { error: '无效的路由类型' },
        { status: 400 }
      );
    }

    // 验证 models 是否为数组
    if (models && !Array.isArray(models)) {
      return NextResponse.json(
        { error: 'models 必须是数组' },
        { status: 400 }
      );
    }

    // 验证 maxTokens、contextWindow 和 temperature 范围
    if (maxTokens !== undefined && !isValidIntegerRange(maxTokens, 256, 192000)) {
      return NextResponse.json(
        { error: 'maxTokens 必须是 256-192000 之间的整数' },
        { status: 400 }
      );
    }
    if (contextWindow !== undefined && !isValidIntegerRange(contextWindow, 0, 1000000)) {
      return NextResponse.json(
        { error: 'contextWindow 必须是 0-1000000 之间的整数' },
        { status: 400 }
      );
    }
    if (temperature !== undefined && !isValidNumberRange(temperature, 0, 2)) {
      return NextResponse.json(
        { error: 'temperature 必须在 0-2 之间' },
        { status: 400 }
      );
    }

    // ICSL/Admin 可以设置 isPublic，普通用户不能
    const newIsPublic = isPublic ?? existingModel.isPublic;
    if (newIsPublic !== existingModel.isPublic && !tenant.isIcsTenant && !tenant.isPlatformAdmin) {
      return NextResponse.json({ error: '只有 ICSL 租户可以创建公共资源' }, { status: 403 });
    }

    // 仅当实际变更租户分配时才需要 ICSL/管理员权限
    if (assignedTenantId !== undefined && assignedTenantId !== existingModel.tenantId && !tenant.isIcsTenant && !tenant.isPlatformAdmin) {
      return NextResponse.json({ error: '只有 ICSL 或平台管理员可以指定分配租户' }, { status: 403 });
    }

    if (assignedTenantId) {
      const assignedTenant = await prisma.tenant.findUnique({ where: { id: assignedTenantId } });
      if (!assignedTenant) {
        return NextResponse.json({ error: '指定的租户不存在' }, { status: 400 });
      }
    }

    // 管理员专属字段：仅当实际变更 isSystemModel 时才需要管理员权限
    const existingIsSystemModel = existingModel.userId === null;
    if (isSystemModel !== undefined && isSystemModel !== existingIsSystemModel && !tenant.isPlatformAdmin) {
      return NextResponse.json(
        { error: '只有管理员可以修改系统模型属性' },
        { status: 403 }
      );
    }

    // 构建更新数据
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (providerType !== undefined) updateData.providerType = providerType;
    if (apiBaseUrl !== undefined) updateData.apiBaseUrl = apiBaseUrl;
    if (apiKey !== undefined) updateData.apiKey = apiKey;
    if (models !== undefined) updateData.models = JSON.stringify(models);
    if (routeType !== undefined) updateData.routeType = providerType === 'openai' ? routeType : null;
    if (maxTokens !== undefined) updateData.maxTokens = maxTokens;
    if (contextWindow !== undefined) updateData.contextWindow = contextWindow;
    if (temperature !== undefined) updateData.temperature = temperature;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (isPublic !== undefined) updateData.isPublic = isPublic;

    if (tenant.isIcsTenant || tenant.isPlatformAdmin) {
      const finalIsPublic = isPublic !== undefined ? isPublic : existingModel.isPublic;
      if (finalIsPublic) {
        updateData.tenantId = null;
      } else if (assignedTenantId !== undefined && assignedTenantId !== null) {
        updateData.tenantId = assignedTenantId;
      } else if (assignedTenantId === null) {
        updateData.tenantId = null;
      }
    }

    // 平台管理员专属字段
    if (tenant.isPlatformAdmin) {
      // 系统模型属性
      if (isSystemModel !== undefined) {
        updateData.userId = isSystemModel ? null : payload.userId;
        if (isSystemModel) {
          updateData.isPublic = true;  // 系统模型默认公开
        }
      }
      
      // 默认模型（只有系统模型可设置）
      if (isDefault !== undefined) {
        const isActuallySystemModel = isSystemModel !== undefined ? isSystemModel : existingModel.userId === null;
        if (isDefault && !isActuallySystemModel) {
          return NextResponse.json(
            { error: '只有系统模型可以设置为默认' },
            { status: 400 }
          );
        }
        
        // 如果设置为默认模型，先取消其他默认模型
        if (isDefault) {
          await prisma.modelConfig.updateMany({
            where: { isDefault: true, id: { not: id } },
            data: { isDefault: false },
          });
        }
        updateData.isDefault = isDefault;
      }
    }

    updateData.updatedAt = new Date();

    // 更新模型
    const model = await prisma.modelConfig.update({
      where: { id },
      data: updateData,
      include: { Tenant: { select: { id: true, name: true, slug: true } } },
    });

    // 记录更新日志
    if (existingModel.userId && existingModel.userId !== payload.userId) {
      const targetUserId = existingModel.userId;
      logger.updateOther(LOG_MODULES.MODEL, payload, targetUserId, id, existingModel.User?.email, { name: model.name });
    } else {
      logger.update(LOG_MODULES.MODEL, payload, `model/${id}`, { name: model.name });
    }

    return NextResponse.json({ model: formatModel(model) });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MODEL, '更新模型失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 删除模型配置
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload, tenant } = auth as AuthSuccessResult;

  try {
    const { id } = await params;

    const existingModel = await prisma.modelConfig.findUnique({
      where: { id },
    });

    if (!existingModel) {
      return NextResponse.json({ error: '模型不存在' }, { status: 404 });
    }

    // 检查管理权限（多租户）- public 资源不能被普通租户删除
    if (!canManageModel(payload.userId, tenant.isPlatformAdmin, tenant.isIcsTenant, existingModel)) {
      logger.permissionDenied(LOG_MODULES.MODEL, payload, 'MODEL_DELETE', id, { modelName: existingModel.name });
      return NextResponse.json({ error: '禁止访问：只能删除自己创建的模型' }, { status: 403 });
    }

    // 删除模型
    await prisma.modelConfig.delete({
      where: { id },
    });

    logger.delete(LOG_MODULES.MODEL, payload, `model/${id}`, { name: existingModel.name });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MODEL, '删除模型失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}