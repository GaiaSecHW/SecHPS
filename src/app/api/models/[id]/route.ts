import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// 格式化模型数据
function formatModel(model: any) {
  return {
    id: model.id,
    userId: model.userId,
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
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    return NextResponse.json({ model: formatModel(model) });
  } catch (error) {
    console.error('获取模型详情错误:', error);
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
    });

    if (!existingModel) {
      return NextResponse.json({ error: '模型不存在' }, { status: 404 });
    }

    // 检查权限：只能更新自己创建的模型，管理员可以更新所有模型
    const isAdmin = payload.roles?.includes('admin');
    if (!isAdmin && existingModel.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问：只能更新自己创建的模型' }, { status: 403 });
    }

    const body = await request.json();
    const { name, providerType, apiBaseUrl, apiKey, models, routeType, isActive, isPublic } = body;

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

    // 构建更新数据
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (providerType !== undefined) updateData.providerType = providerType;
    if (apiBaseUrl !== undefined) updateData.apiBaseUrl = apiBaseUrl;
    if (apiKey !== undefined) updateData.apiKey = apiKey;
    if (models !== undefined) updateData.models = JSON.stringify(models);
    if (routeType !== undefined) updateData.routeType = providerType === 'openai' ? routeType : null;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (isPublic !== undefined) updateData.isPublic = isPublic;
    // 个人模型不能设为默认，只有管理员可以管理isDefault

    // 更新模型
    const model = await prisma.modelConfig.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ model: formatModel(model) });
  } catch (error) {
    console.error('更新模型配置错误:', error);
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
    });

    if (!existingModel) {
      return NextResponse.json({ error: '模型不存在' }, { status: 404 });
    }

    // 检查权限：只能删除自己创建的模型，管理员可以删除所有模型
    const isAdmin = payload.roles?.includes('admin');
    if (!isAdmin && existingModel.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问：只能删除自己创建的模型' }, { status: 403 });
    }

    // 删除模型
    await prisma.modelConfig.delete({
      where: { id },
    });

    return NextResponse.json({ success: true, message: '模型已删除' });
  } catch (error) {
    console.error('删除模型配置错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}