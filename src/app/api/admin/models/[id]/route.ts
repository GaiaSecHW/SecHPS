import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// 获取单个模型配置
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

    // 获取模型配置
    const model = await prisma.modelConfig.findUnique({
      where: { id },
    });

    if (!model) {
      return NextResponse.json(
        { error: '模型配置不存在' },
        { status: 404 }
      );
    }

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

    return NextResponse.json({ model: formattedModel });
  } catch (error) {
    console.error('获取模型配置错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 更新模型配置
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const body = await request.json();
    const { name, providerType, apiBaseUrl, apiKey, models, routeType, isActive, isDefault } = body;

    // 检查模型是否存在
    const existingModel = await prisma.modelConfig.findUnique({
      where: { id },
    });

    if (!existingModel) {
      return NextResponse.json(
        { error: '模型配置不存在' },
        { status: 404 }
      );
    }

    // 验证 providerType
    if (providerType !== undefined) {
      const validProviderTypes = ['claude', 'openai'];
      if (!validProviderTypes.includes(providerType)) {
        return NextResponse.json(
          { error: '无效的代理类型，必须是 claude 或 openai' },
          { status: 400 }
        );
      }
    }

    // 如果设置为默认模型，先将其他默认模型的模型 isDefault 设为 false
    if (isDefault === true && !existingModel.isDefault) {
      await prisma.modelConfig.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    // 构建更新数据
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (providerType !== undefined) updateData.providerType = providerType;
    if (apiBaseUrl !== undefined) updateData.apiBaseUrl = apiBaseUrl;
    if (apiKey !== undefined) updateData.apiKey = apiKey;
    if (models !== undefined) {
      if (!Array.isArray(models)) {
        return NextResponse.json(
          { error: 'models 必须是数组' },
          { status: 400 }
        );
      }
      updateData.models = JSON.stringify(models);
    }
    if (routeType !== undefined) {
      // routeType 仅对 openai 类型有效
      if (providerType === 'openai' || existingModel.providerType === 'openai') {
        updateData.routeType = routeType;
      }
    }
    if (isActive !== undefined) updateData.isActive = isActive;
    if (isDefault !== undefined) updateData.isDefault = isDefault;

    // 更新模型配置
    const model = await prisma.modelConfig.update({
      where: { id },
      data: updateData,
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

    return NextResponse.json({ model: formattedModel });
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

    const { id } = await params;

    // 检查模型是否存在
    const existingModel = await prisma.modelConfig.findUnique({
      where: { id },
    });

    if (!existingModel) {
      return NextResponse.json(
        { error: '模型配置不存在' },
        { status: 404 }
      );
    }

    // 删除模型配置
    await prisma.modelConfig.delete({
      where: { id },
    });

    return NextResponse.json({ message: '模型配置已删除' });
  } catch (error) {
    console.error('删除模型配置错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
