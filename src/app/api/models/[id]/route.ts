import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { logger, LOG_MODULES } from '@/lib/logger';

// 格式化模型数据 - 不返回 apiKey 以保护安全
function formatModel(model: any, includeApiKey: boolean = false) {
  return {
    id: model.id,
    userId: model.userId,
    name: model.name,
    providerType: model.providerType,
    apiBaseUrl: model.apiBaseUrl,
    apiKey: includeApiKey ? model.apiKey : undefined,
    hasApiKey: !!model.apiKey,
    models: JSON.parse(model.models),
    routeType: model.routeType,
    maxTokens: model.maxTokens ?? 4096,
    temperature: model.temperature ?? 0.7,
    isActive: model.isActive,
    isDefault: model.isDefault,
    isPublic: model.isPublic,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

// 获取单个模型详情
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 获取模型
    const model = await prisma.modelConfig.findUnique({
      where: { id },
      include: {
        User: {
          select: { id: true, email: true, username: true },
        },
      },
    });

    if (!model) {
      return NextResponse.json({ error: '模型不存在' }, { status: 404 });
    }

    // 检查访问权限：
    // 1. 用户可以查看自己的模型
    // 2. 用户可以查看公开的模型
    // 3. 用户可以查看系统级模型（userId为null）
    // 4. 管理员可以查看所有模型
    const isAdmin = payload.roles?.includes('admin');
    const canAccess = isAdmin || 
      model.userId === payload.userId || 
      model.isPublic === true || 
      model.userId === null;

    if (!canAccess) {
      // 权限拒绝日志
      logger.permissionDenied(LOG_MODULES.MODEL, payload, 'MODEL_READ', id, { modelName: model.name });
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 记录读取日志 - 区分是否跨用户
    if (model.userId && model.userId !== payload.userId) {
      // 管理员访问他人模型
      logger.readOther(LOG_MODULES.MODEL, payload, model.userId, model.User?.email, 'model', id, { name: model.name });
    } else if (!model.userId) {
      // 系统模型访问
      logger.read(LOG_MODULES.MODEL, payload, 'system_model', id, { name: model.name, isSystem: true });
    } else {
      // 自己的模型
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
  try {
    const { id } = await params;
    
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 获取模型
    const existingModel = await prisma.modelConfig.findUnique({
      where: { id },
      include: {
        User: {
          select: { id: true, email: true, username: true },
        },
      },
    });

    if (!existingModel) {
      return NextResponse.json({ error: '模型不存在' }, { status: 404 });
    }

    // 检查权限：只能更新自己创建的模型，管理员可以更新所有模型
    const isAdmin = payload.roles?.includes('admin');
    if (!isAdmin && existingModel.userId !== payload.userId) {
      // 权限拒绝日志
      logger.permissionDenied(LOG_MODULES.MODEL, payload, 'MODEL_UPDATE', id, { modelName: existingModel.name });
      return NextResponse.json({ error: '禁止访问：只能更新自己创建的模型' }, { status: 403 });
    }

    const body = await request.json();
    const { name, providerType, apiBaseUrl, apiKey, models, routeType, maxTokens, temperature, isActive, isPublic, isSystemModel, isDefault } = body;

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

    // 验证 maxTokens 和 temperature 范围
    if (maxTokens !== undefined && (maxTokens < 256 || maxTokens > 128000)) {
      return NextResponse.json(
        { error: 'maxTokens 必须在 256-128000 之间' },
        { status: 400 }
      );
    }
    if (temperature !== undefined && (temperature < 0 || temperature > 2)) {
      return NextResponse.json(
        { error: 'temperature 必须在 0-2 之间' },
        { status: 400 }
      );
    }

    // 验证管理员专属字段
    if (isSystemModel !== undefined && !isAdmin) {
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
    if (temperature !== undefined) updateData.temperature = temperature;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (isPublic !== undefined) updateData.isPublic = isPublic;

    // 管理员专属字段
    if (isAdmin) {
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

    // 更新模型
    const model = await prisma.modelConfig.update({
      where: { id },
      data: updateData,
    });

    // 记录更新日志 - 区分是否跨用户
    if (existingModel.userId && existingModel.userId !== payload.userId) {
      // 管理员更新他人模型
      const targetUserId = existingModel.userId;
      logger.updateOther(LOG_MODULES.MODEL, payload, targetUserId, id, existingModel.User?.email, { name: model.name });
    } else {
      // 自己的模型或系统模型
      logger.update(LOG_MODULES.MODEL, payload, id, { name: model.name });
    }

    return NextResponse.json({ model: formatModel(model) });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MODEL, '更新模型配置失败', { details: { error: String(error) } });
    return NextResponse.json(
      { error: '服务器内部错误', details: String(error) },
      { status: 500 }
    );
  }
}

// 删除模型配置
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 获取模型
    const existingModel = await prisma.modelConfig.findUnique({
      where: { id },
      include: {
        User: {
          select: { id: true, email: true, username: true },
        },
      },
    });

    if (!existingModel) {
      return NextResponse.json({ error: '模型不存在' }, { status: 404 });
    }

    // 检查权限：只能删除自己创建的模型，管理员可以删除所有模型
    const isAdmin = payload.roles?.includes('admin');
    if (!isAdmin && existingModel.userId !== payload.userId) {
      // 权限拒绝日志
      logger.permissionDenied(LOG_MODULES.MODEL, payload, 'MODEL_DELETE', id, { modelName: existingModel.name });
      return NextResponse.json({ error: '禁止访问：只能删除自己创建的模型' }, { status: 403 });
    }

    // 删除模型
    await prisma.modelConfig.delete({
      where: { id },
    });

    // 记录删除日志 - 区分是否跨用户
    if (existingModel.userId && existingModel.userId !== payload.userId) {
      // 管理员删除他人模型
      const targetUserId = existingModel.userId;
      logger.deleteOther(LOG_MODULES.MODEL, payload, targetUserId, id, existingModel.User?.email, { name: existingModel.name });
    } else {
      // 自己的模型或系统模型
      logger.delete(LOG_MODULES.MODEL, payload, id, { name: existingModel.name });
    }

    return NextResponse.json({ success: true, message: '模型已删除' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MODEL, '删除模型配置失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}