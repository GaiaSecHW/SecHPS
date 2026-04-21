// src/app/api/models/[id]/test/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
import { testModelConnection } from '@/lib/model-client';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * 测试模型连通性
 * POST /api/models/:id/test
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 使用统一认证中间件（无权限要求，只需登录）
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload } = auth;

  try {
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
    const userIsAdmin = isAdmin(payload);
    const canAccess = userIsAdmin || 
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
    logger.errorNoUser(LOG_MODULES.MODEL, '测试模型连接错误:', { details: { error: String(error) } });
    return NextResponse.json(
      { error: '服务器内部错误', details: String(error) },
      { status: 500 }
    );
  }
}
