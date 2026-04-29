import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { validateJsonField, validateJsonObject } from '@/lib/validation';
import { PERMISSIONS } from '@/types/permissions';
import { generateId } from '@/lib/id-generator';
import { logger, LOG_MODULES } from '@/lib/logger';

// PATCH /api/config/[id] - Update a config
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_UPDATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const { payload } = auth;

    const { id } = await params;
    
    const existingConfig = await prisma.opencodeConfig.findUnique({
      where: { id },
    });

    if (!existingConfig) {
      return NextResponse.json({ error: '未找到配置' }, { status: 404 });
    }

    const body = await request.json();
    const { name, baseURL, projectUploadDir, taskDescription, description, isActive, keybinds, modelPreferences, workflowConfig, progressQuestion, customSystemPrompt, skillOutputTemplate, claudemdTemplate, maxConcurrentEvaluations, defaultToolPermissions } = body;

    // Validate URL format if provided
    if (baseURL) {
      try {
        new URL(baseURL);
      } catch {
        return NextResponse.json({ error: '无效的 baseURL 格式' }, { status: 400 });
      }
    }

    // Validate maxConcurrentEvaluations if provided
    if (maxConcurrentEvaluations !== undefined) {
      const concurrentLimit = parseInt(maxConcurrentEvaluations);
      if (concurrentLimit < 1 || concurrentLimit > 10) {
        return NextResponse.json({ error: '并发限制必须在 1-10 之间' }, { status: 400 });
      }
    }

    // Validate JSON object fields
    const jsonObjectFields = [
      { value: keybinds, name: 'keybinds' },
    ];
    for (const field of jsonObjectFields) {
      if (field.value !== undefined) {
        const validation = validateJsonObject(field.value, field.name);
        if (!validation.valid) {
          return NextResponse.json({ error: validation.error }, { status: 400 });
        }
      }
    }

    // Validate JSON string fields
    const jsonStringFields = [
      { value: workflowConfig, name: 'workflowConfig' },
      { value: defaultToolPermissions, name: 'defaultToolPermissions' },
    ];
    for (const field of jsonStringFields) {
      if (field.value !== undefined) {
        const validation = validateJsonField(field.value, field.name);
        if (!validation.valid) {
          return NextResponse.json({ error: validation.error }, { status: 400 });
        }
      }
    }

    // Update config
    const config = await prisma.opencodeConfig.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(baseURL !== undefined && { baseURL }),
        ...(projectUploadDir !== undefined && { projectUploadDir: projectUploadDir || null }),
        ...(taskDescription !== undefined && { taskDescription }),
        ...(description !== undefined && { description }),
        ...(isActive !== undefined && { isActive }),
        ...(keybinds !== undefined && { keybinds: JSON.stringify(keybinds) }),
        ...(modelPreferences !== undefined && { modelPreferences }),
        ...(workflowConfig !== undefined && { workflowConfig }),
        ...(progressQuestion !== undefined && { progressQuestion }),
        ...(customSystemPrompt !== undefined && { customSystemPrompt }),
        ...(skillOutputTemplate !== undefined && { skillOutputTemplate }),
        ...(claudemdTemplate !== undefined && { claudemdTemplate }),
        ...(maxConcurrentEvaluations !== undefined && { maxConcurrentEvaluations: parseInt(maxConcurrentEvaluations) }),
        ...(defaultToolPermissions !== undefined && { defaultToolPermissions }),
      },
    });

    logger.debug(LOG_MODULES.CONFIG, '更新配置:', { 
      details: { id: config.id, progressQuestion: config.progressQuestion ? `${config.progressQuestion.substring(0, 30)}...` : null } 
    });

    await prisma.auditLog.create({
      data: {
        id: generateId('audit'),
        userId: payload.userId,
        action: 'config_update',
        resource: config.id,
        details: JSON.stringify({ name: config.name, baseURL: config.baseURL }),
      },
    });

    return NextResponse.json({ config });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '更新配置错误:', { details: error });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/config/[id] - Delete a config
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_DELETE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const { payload } = auth;

    const { id } = await params;

    const existingConfig = await prisma.opencodeConfig.findUnique({
      where: { id },
    });

    if (!existingConfig) {
      return NextResponse.json({ error: '未找到配置' }, { status: 404 });
    }

    const activeConfigCount = await prisma.opencodeConfig.count({
      where: { isActive: true },
    });

    if (activeConfigCount <= 1 && existingConfig.isActive) {
      return NextResponse.json({ error: '无法删除最后一个活跃配置，您必须至少保留一个活跃配置。' }, { status: 400 });
    }

    await prisma.opencodeConfig.delete({
      where: { id },
    });

    await prisma.auditLog.create({
      data: {
        id: generateId('audit'),
        userId: payload.userId,
        action: 'config_delete',
        resource: id,
        details: JSON.stringify({ name: existingConfig.name }),
      },
    });

    return NextResponse.json({ message: '配置删除成功' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '删除配置错误:', { details: error });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}