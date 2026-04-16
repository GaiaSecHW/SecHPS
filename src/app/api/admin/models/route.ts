import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

// 获取所有模型配置
export async function GET(request: Request) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的令牌' } }, { status: 401 });
    }

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.MODEL_READ)) {
      return NextResponse.json({ details: { error: '禁止访问' } }, { status: 403 });
    }

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
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ details: { error: '未授权' } }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ details: { error: '无效的令牌' } }, { status: 401 });
    }

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.MODEL_CREATE)) {
      return NextResponse.json({ details: { error: '禁止访问' } }, { status: 403 });
    }

    const body = await request.json();
    const { name, providerType, apiBaseUrl, apiKey, models, routeType, isActive, isDefault } = body;

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
        id: `model-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name,
        providerType: providerType || 'openai',
        apiBaseUrl,
        apiKey,
        models: JSON.stringify(models),
        routeType: providerType === 'openai' ? routeType || 'default' : null,
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
    logger.errorNoUser(LOG_MODULES.MODEL, '创建模型配置失败', { details: { error: String(error) } });
    return NextResponse.json(
      { details: { error: '服务器内部错误', details: String(error) } },
      { status: 500 }
    );
  }
}
