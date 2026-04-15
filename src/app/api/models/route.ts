import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// 格式化模型数据
function formatModel(model: any) {
  return {
    id: model.id,
    userId: model.userId,
    userName: model.user?.name || model.user?.username || null,  // 创建者姓名
    userUsername: model.user?.username || null,  // 创建者用户名
    name: model.name,
    providerType: model.providerType,
    apiBaseUrl: model.apiBaseUrl,
    apiKey: model.apiKey,
    models: JSON.parse(model.models),
    routeType: model.routeType,
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
  try {
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

    // 获取查询参数
    const { searchParams } = new URL(request.url);
    const isActiveParam = searchParams.get('isActive');
    const forEvaluation = searchParams.get('forEvaluation') === 'true';

    // 检查是否是管理员
    const isAdmin = payload.roles?.includes('admin');

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
    } else if (isAdmin) {
      // 管理员可以看到所有模型
      // 不添加额外的userId过滤
    } else {
      // 普通用户管理页面：只看到自己创建的
      where.userId = payload.userId;
    }

    // 获取模型配置（包含创建者信息）
    const models = await prisma.modelConfig.findMany({
      where,
      include: {
        user: {
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
    const formattedModels = models.map(formatModel);

    return NextResponse.json({ models: formattedModels });
  } catch (error) {
    console.error('获取模型配置错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 创建新的模型配置（个人模型）
export async function POST(request: Request) {
  try {
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

    const body = await request.json();
    const { name, providerType, apiBaseUrl, apiKey, models, routeType, isActive, isPublic } = body;

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

    // 创建模型配置（属于当前用户）
    const model = await prisma.modelConfig.create({
      data: {
        userId: payload.userId,  // 关联到当前用户
        name,
        providerType: providerType || 'openai',
        apiBaseUrl,
        apiKey,
        models: JSON.stringify(models),
        routeType: providerType === 'openai' ? routeType || 'default' : null,
        isActive: isActive !== undefined ? isActive : true,
        isDefault: false,  // 个人模型不能设为默认
        isPublic: isPublic || false,
      },
    });

    // 格式化返回数据
    const formattedModel = formatModel(model);

    return NextResponse.json(
      { model: formattedModel },
      { status: 201 }
    );
  } catch (error) {
    console.error('创建模型配置错误:', error);
    return NextResponse.json(
      { error: '服务器内部错误', details: String(error) },
      { status: 500 }
    );
  }
}