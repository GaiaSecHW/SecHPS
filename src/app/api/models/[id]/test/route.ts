// src/app/api/models/[id]/test/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { testModelConnection } from '@/lib/model-client';

/**
 * 测试模型连通性
 * POST /api/models/:id/test
 */
export async function POST(
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

    // 检查访问权限：可以测试自己的模型、公开的模型、系统级模型
    const isAdmin = payload.roles?.includes('admin');
    const canAccess = isAdmin || 
      model.userId === payload.userId || 
      model.isPublic === true || 
      model.userId === null;

    if (!canAccess) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 解析模型列表
    let models: string[];
    try {
      models = JSON.parse(model.models);
    } catch {
      return NextResponse.json(
        { error: '模型配置格式错误', details: 'models 字段不是有效的 JSON' },
        { status: 400 }
      );
    }
    if (!models || models.length === 0) {
      return NextResponse.json(
        { error: '模型配置中没有可用的模型' },
        { status: 400 }
      );
    }

    const modelName = models[0];

    // 构建用户上下文，用于记录 Token 使用
    const context = {
      userId: payload.userId,
      username: payload.username,
      scene: 'model-test' as const,
      description: `测试模型: ${model.name} (${modelName})`,
    };

    // 使用统一的模型连接测试（传入用户上下文以记录 Token）
    const result = await testModelConnection({
      providerType: model.providerType,
      apiKey: model.apiKey,
      apiBaseUrl: model.apiBaseUrl,
      modelName,
    }, context);

    return NextResponse.json({
      ...result,
      modelName,
      providerType: model.providerType,
    }, { status: result.success ? 200 : 200 });
    
  } catch (error) {
    console.error('测试模型连接错误:', error);
    return NextResponse.json(
      { error: '服务器内部错误', details: String(error) },
      { status: 500 }
    );
  }
}
