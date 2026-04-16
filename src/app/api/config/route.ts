import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { validateJsonField, validateJsonObject } from '@/lib/validation';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/config - Get all configs for authenticated user
export async function GET(request: Request) {
  try {
    // Authenticate and check permission
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const { payload } = auth;

    // Get configs for user
    const configs = await prisma.opencodeConfig.findMany({
      where: {
        userId: payload.userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({ configs });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '获取配置列表失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}

// POST /api/config - Create a new config
export async function POST(request: Request) {
  try {
    // Authenticate and check permission
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_UPDATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const { payload } = auth;

    const body = await request.json();
    const { name, baseURL, projectUploadDir, taskDescription, description, isActive, mcpServers, keybinds, modelPreferences, progressQuestion, customSystemPrompt, maxConcurrentEvaluations, defaultToolPermissions } = body;

    if (!name) {
      return NextResponse.json({ details: { error: '配置名称是必需的' } }, { status: 400 });
    }

    // Validate URL format if provided
    if (baseURL) {
      try {
        new URL(baseURL);
      } catch {
        return NextResponse.json(
          { details: { error: '无效的 baseURL 格式' } },
          { status: 400 }
        );
      }
    }

    // Validate maxConcurrentEvaluations
    const concurrentLimit = maxConcurrentEvaluations ? parseInt(maxConcurrentEvaluations) : 3;
    if (concurrentLimit < 1 || concurrentLimit > 10) {
      return NextResponse.json(
        { details: { error: '并发限制必须在 1-10 之间' } },
        { status: 400 }
      );
    }

    // Validate JSON object fields
    const jsonObjectFields = [
      { value: mcpServers, name: 'mcpServers' },
      { value: keybinds, name: 'keybinds' },
    ];
    for (const field of jsonObjectFields) {
      const validation = validateJsonObject(field.value, field.name);
      if (!validation.valid) {
        return NextResponse.json({ details: { error: validation.error } }, { status: 400 });
      }
    }

    // Validate JSON string fields
    const jsonStringFields = [
      { value: defaultToolPermissions, name: 'defaultToolPermissions' },
    ];
    for (const field of jsonStringFields) {
      const validation = validateJsonField(field.value, field.name);
      if (!validation.valid) {
        return NextResponse.json({ details: { error: validation.error } }, { status: 400 });
      }
    }

    // Create config
    const config = await prisma.opencodeConfig.create({
      data: {
        id: `config-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId: payload.userId,
        name,
        baseURL: baseURL || 'http://localhost:54321',
        projectUploadDir: projectUploadDir || null,
        taskDescription,
        description,
        isActive: isActive !== undefined ? isActive : true,
        mcpServers: mcpServers ? JSON.stringify(mcpServers) : null,
        keybinds: keybinds ? JSON.stringify(keybinds) : null,
        // modelPreferences 是字符串格式 "providerID/modelID"，直接存储
        modelPreferences: modelPreferences || null,
        customSystemPrompt: customSystemPrompt || null,
        progressQuestion: progressQuestion || null,
        maxConcurrentEvaluations: concurrentLimit,
        defaultToolPermissions: defaultToolPermissions || null,
        updatedAt: new Date(),
      },
    });

    // Record audit log
    await prisma.auditLog.create({
          data: {
            id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            userId: payload.userId,
            action: 'config_create',
            resource: config.id,
            details: JSON.stringify({ name, baseURL }),
          },
        });

    return NextResponse.json({ config }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '创建配置失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
