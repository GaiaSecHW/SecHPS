import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { generateId } from '@/lib/id-generator';

function isValidIntegerRange(value: unknown, min: number, max: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isValidNumberRange(value: unknown, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

// 获取所有模型配置
export async function GET(request: Request) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.MODEL_READ });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    // 获取查询参数
    const { searchParams } = new URL(request.url);
    const isActiveParam = searchParams.get('isActive');

    // 构建查询条件
    const where: any = {};
    if (isActiveParam !== null) {
      where.isActive = isActiveParam === 'true';
    }

    // 获取所有模型配置
    const models = await prisma.modelConfig.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
    });

    // 格式化返回数据（解析 JSON 字符串）
    const formattedModels = models.map(model => ({
      id: model.id,
      name: model.name,
      providerType: model.providerType,
      apiBaseUrl: model.apiBaseUrl,
      apiKey: model.apiKey,
      models: JSON.parse(model.models),
      routeType: model.routeType,
      maxTokens: model.maxTokens ?? 65536,
      contextWindow: model.contextWindow ?? 130000,
      temperature: model.temperature ?? 0.3,
      isActive: model.isActive,
      isDefault: model.isDefault,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    }));

    logger.access(LOG_MODULES.MODEL, payload, 'model_configs', { isActive: isActiveParam });
    return NextResponse.json({ models: formattedModels });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MODEL, '获取模型配置失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}

// 创建新的模型配置
export async function POST(request: Request) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.MODEL_CREATE });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    const body = await request.json();
    const { name, providerType, apiBaseUrl, apiKey, models, routeType, maxTokens, contextWindow, temperature, isActive, isDefault } = body;

    // 验证必填字段
    if (!name || !apiBaseUrl || !apiKey || !models) {
      return NextResponse.json(
        { details: { error: '缺少必填字段：name, apiBaseUrl, apiKey, models' } },
        { status: 400 }
      );
    }

    // 验证 providerType
    const validProviderTypes = ['claude', 'openai'];
    if (providerType && !validProviderTypes.includes(providerType)) {
      return NextResponse.json(
        { details: { error: '无效的代理类型，必须是 claude 或 openai' } },
        { status: 400 }
      );
    }

    // 验证 routeType（仅 OpenAI 类型需要）
    const validRouteTypes = ['default', 'think', 'background', 'longContext', 'webSearch'];
    if (providerType === 'openai' && routeType && !validRouteTypes.includes(routeType)) {
      return NextResponse.json(
        { details: { error: '无效的路由类型' } },
        { status: 400 }
      );
    }

    // 验证 models 是否为数组
    if (!Array.isArray(models)) {
      return NextResponse.json(
        { details: { error: 'models 必须是数组' } },
        { status: 400 }
      );
    }

    // 验证 maxTokens、contextWindow 和 temperature 范围
    const finalMaxTokens = maxTokens ?? 65536;
    const finalContextWindow = contextWindow ?? 130000;
    const finalTemperature = temperature ?? 0.3;
    if (!isValidIntegerRange(finalMaxTokens, 256, 192000)) {
      return NextResponse.json(
        { details: { error: 'maxTokens 必须是 256-192000 之间的整数' } },
        { status: 400 }
      );
    }
    if (!isValidIntegerRange(finalContextWindow, 0, 1000000)) {
      return NextResponse.json(
        { details: { error: 'contextWindow 必须是 0-1000000 之间的整数' } },
        { status: 400 }
      );
    }
    if (!isValidNumberRange(finalTemperature, 0, 2)) {
      return NextResponse.json(
        { details: { error: 'temperature 必须在 0-2 之间' } },
        { status: 400 }
      );
    }

    // 如果设置为默认模型，先将其他默认模型的 isDefault 设为 false
    if (isDefault === true) {
      await prisma.modelConfig.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    // 创建模型配置
    const model = await prisma.modelConfig.create({
      data: {
        id: generateId('model'),
        name,
        providerType: providerType || 'openai',
        apiBaseUrl,
        apiKey,
        models: JSON.stringify(models),
        routeType: providerType === 'openai' ? routeType || 'default' : null,
        maxTokens: finalMaxTokens,
        contextWindow: finalContextWindow,
        temperature: finalTemperature,
        isActive: isActive !== undefined ? isActive : true,
        isDefault: isDefault || false,
        updatedAt: new Date(),
      },
    });

    // 格式化返回数据
    const formattedModel = {
      id: model.id,
      name: model.name,
      providerType: model.providerType,
      apiBaseUrl: model.apiBaseUrl,
      apiKey: model.apiKey,
      models: JSON.parse(model.models),
      routeType: model.routeType,
      maxTokens: model.maxTokens ?? 65536,
      contextWindow: model.contextWindow ?? 130000,
      temperature: model.temperature ?? 0.3,
      isActive: model.isActive,
      isDefault: model.isDefault,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    };

    logger.create(LOG_MODULES.MODEL, payload, model.id, { name, providerType, modelsCount: models.length });
    return NextResponse.json(
      { model: formattedModel },
      { status: 201 }
    );
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MODEL, '创建模型配置失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      { details: { error: '服务器内部错误' } },
      { status: 500 }
    );
  }
}
