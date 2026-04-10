import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// PATCH /api/config/[id] - Update a config
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // Check permission
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { name, baseURL, projectUploadDir, taskDescription, description, isActive, mcpServers, keybinds, modelPreferences, workflowConfig, progressQuestion, customSystemPrompt, skillOutputTemplate } = body;

    // Check if config exists and belongs to user
    const existingConfig = await prisma.opencodeConfig.findUnique({
      where: { id },
    });

    if (!existingConfig) {
      return NextResponse.json({ error: '未找到配置' }, { status: 404 });
    }

    if (existingConfig.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // Validate URL format if provided
    if (baseURL) {
      try {
        new URL(baseURL);
      } catch {
        return NextResponse.json(
          { error: '无效的 baseURL 格式' },
          { status: 400 }
        );
      }
    }

    // Update config
    const config = await prisma.opencodeConfig.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(baseURL !== undefined && { baseURL }),
        ...(projectUploadDir !== undefined && { projectUploadDir }),
        ...(taskDescription !== undefined && { taskDescription }),
        ...(description !== undefined && { description }),
        ...(isActive !== undefined && { isActive }),
        ...(mcpServers !== undefined && { mcpServers: JSON.stringify(mcpServers) }),
        ...(keybinds !== undefined && { keybinds: JSON.stringify(keybinds) }),
        // modelPreferences 是字符串格式 "providerID/modelID"，直接存储
        ...(modelPreferences !== undefined && { modelPreferences }),
        // workflowConfig 是 JSON 字符串，直接存储
        ...(workflowConfig !== undefined && { workflowConfig }),
        // 进展询问消息配置
        ...(progressQuestion !== undefined && { progressQuestion }),
        // 自定义系统提示词
        ...(customSystemPrompt !== undefined && { customSystemPrompt }),
        // Skill 标准输出模板
        ...(skillOutputTemplate !== undefined && { skillOutputTemplate }),
      },
    });

    // Record audit log
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'config_update',
        resource: config.id,
        details: JSON.stringify({ name: config.name, baseURL: config.baseURL }),
      },
    });

    return NextResponse.json({ config });
  } catch (error) {
    console.error('Update config error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/config/[id] - Delete a config
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // Check permission
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_DELETE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;

    // Check if config exists and belongs to user
    const existingConfig = await prisma.opencodeConfig.findUnique({
      where: { id },
    });

    if (!existingConfig) {
      return NextResponse.json({ error: '未找到配置' }, { status: 404 });
    }

    if (existingConfig.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // Check if this is the only config for the user
    const userConfigCount = await prisma.opencodeConfig.count({
      where: { userId: payload.userId },
    });

    if (userConfigCount <= 1) {
      return NextResponse.json(
        { error: '无法删除最后一个配置，您必须至少保留一个配置。' },
        { status: 400 }
      );
    }

    // Delete config
    await prisma.opencodeConfig.delete({
      where: { id },
    });

    // Record audit log
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'config_delete',
        resource: id,
        details: JSON.stringify({ name: existingConfig.name }),
      },
    });

    return NextResponse.json({ message: '配置删除成功' });
  } catch (error) {
    console.error('Delete config error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
