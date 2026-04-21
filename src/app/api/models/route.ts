import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { generateId } from '@/lib/id-generator';

// 格式化模型数据 - 不返回 apiKey 以保护安全
function formatModel(model: any, includeApiKey: boolean = false) {
  return {
    id: model.id,
    userId: model.userId,
    userName: model.user?.name || model.user?.username || null,  // 创建者姓名
    userUsername: model.user?.username || null,  // 创建者用户名
    name: model.name,
    providerType: model.providerType,
    apiBaseUrl: model.apiBaseUrl,
    apiKey: includeApiKey ? model.apiKey : undefined,  // 默认不返回
    hasApiKey: !!model.apiKey,  // 仅返回是否有 API Key 的标识
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

// 获取用户的模型列表
// 普通用户：只能看到自己创建的模型 + 公开的模型
// 管理员：可以看到所有模型
export async function GET(request: Request) {
  // 使用统一认证中间件（无权限要求，只需登录）
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  try {
    // 获取查询参数
    const { searchParams } = new URL(request.url);
    const isActiveParam = searchParams.get('isActive');
    const forEvaluation = searchParams.get('forEvaluation') === 'true';

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 构建查询条件
    let where: any = {};
    
    if (isActiveParam !== null) {
      where.isActive = isActiveParam === 'true';
    }

    // 根据用户角色和用途过滤模型
    if (forEvaluation) {
      // 用于评估时：用户可以看到自己的模型 + 公开的模型
      where.OR = [
        { userId: payload.userId },  // 自己创建的
        { isPublic: true },           // 公开的
        { userId: null },             // 系统级模型（管理员创建的公共模型）
      ];
    } else if (userIsAdmin) {
      // 管理员可以看到所有模型
      // 不添加额外的userId过滤
    } else {
      // 普通用户管理页面：自己的 + 公开的 + 系统级模型
      where.OR = [
        { userId: payload.userId },  // 自己创建的
        { isPublic: true },           // 公开的
        { userId: null },             // 系统级模型
      ];
    }

    // 获取模型配置（包含创建者信息）
    const models = await prisma.modelConfig.findMany({
      where,
      include: {
        User: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    // 格式化返回数据
    const formattedModels = models.map((model) => formatModel(model, false));

    // 记录列表查询日志
    logger.list(LOG_MODULES.MODEL, payload, 'models', { isActive: isActiveParam, forEvaluation, isAdmin }, formattedModels.length);

    return NextResponse.json({ models: formattedModels });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MODEL, `获取模型配置错误: ${error}`);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 创建新的模型配置（个人模型）
export async function POST(request: Request) {
  // 使用统一认证中间件
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const payload = auth.payload;

  try {
    const body = await request.json();
    const { name, providerType, apiBaseUrl, apiKey, models, routeType, maxTokens, temperature, isActive, isPublic, isSystemModel, isDefault } = body;

    // 验证必填字段
    if (!name || !apiBaseUrl || !apiKey || !models) {
      return NextResponse.json(
        { error: '缺少必填字段：name, apiBaseUrl, apiKey, models' },
        { status: 400 }
      );
    }

    // 验证 providerType
    const validProviderTypes = ['claude', 'openai'];
    if (providerType && !validProviderTypes.includes(providerType)) {
      return NextResponse.json(
        { error: '无效的代理类型，必须是 claude 或 openai' },
        { status: 400 }
      );
    }

    // 验证 routeType（仅 OpenAI 类型需要）
    const validRouteTypes = ['default', 'think', 'background', 'longContext', 'webSearch'];
    if (providerType === 'openai' && routeType && !validRouteTypes.includes(routeType)) {
      return NextResponse.json(
        { error: '无效的路由类型' },
        { status: 400 }
      );
    }

    // 验证 models 是否为数组
    if (!Array.isArray(models)) {
      return NextResponse.json(
        { error: 'models 必须是数组' },
        { status: 400 }
      );
    }

    // 验证 maxTokens 和 temperature 范围
    const finalMaxTokens = maxTokens ?? 32000;
    const finalTemperature = temperature ?? 0.3;
    if (finalMaxTokens < 256 || finalMaxTokens > 192000) {
      return NextResponse.json(
        { error: 'maxTokens 必须在 256-192000 之间' },
        { status: 400 }
      );
    }
    if (finalTemperature < 0 || finalTemperature > 2) {
      return NextResponse.json(
        { error: 'temperature 必须在 0-2 之间' },
        { status: 400 }
      );
    }

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 验证管理员专属字段
    if (isSystemModel && !userIsAdmin) {
      return NextResponse.json(
        { error: '只有管理员可以创建系统模型' },
        { status: 403 }
      );
    }

    if (isDefault && !isSystemModel) {
      return NextResponse.json(
        { error: '只有系统模型可以设置为默认' },
        { status: 400 }
      );
    }

    // 如果设置为默认模型，先取消其他默认模型
    if (isDefault && userIsAdmin) {
      await prisma.modelConfig.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    // 创建模型配置
    const model = await prisma.modelConfig.create({
      data: {
        id: generateId('model'),
        userId: isSystemModel ? null : payload.userId,  // 系统模型 userId 为 null
        name,
        providerType: providerType || 'openai',
        apiBaseUrl,
        apiKey,
        models: JSON.stringify(models),
        routeType: providerType === 'openai' ? routeType || 'default' : null,
        maxTokens: finalMaxTokens,
        temperature: finalTemperature,
        isActive: isActive !== undefined ? isActive : true,
        isDefault: isSystemModel && isDefault ? isDefault : false,  // 只有系统模型可设默认
        isPublic: isSystemModel ? true : (isPublic || false),  // 系统模型默认公开
        updatedAt: new Date(),
      },
    });

    // 格式化返回数据
    const formattedModel = formatModel(model);

    // 记录创建成功日志
    logger.create(LOG_MODULES.MODEL, payload, model.id, { 
      name, 
      providerType, 
      isSystemModel, 
      isPublic 
    });

    return NextResponse.json(
      { model: formattedModel },
      { status: 201 }
    );
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MODEL, `创建模型配置错误: ${error}`);
    return NextResponse.json(
      { error: '服务器内部错误', details: String(error) },
      { status: 500 }
    );
  }
}