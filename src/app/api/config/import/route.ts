import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

// POST /api/config/import — 导入配置，覆盖当前用户的活跃配置
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const body = await request.json();

    // 基本格式校验
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: '无效的配置文件格式' }, { status: 400 });
    }
    if (body._source !== 'AI4WEB 平台') {
      return NextResponse.json(
        { error: '配置文件来源不匹配，请确认文件由本平台导出' },
        { status: 400 }
      );
    }

    // 找到当前活跃配置
    const activeConfig = await prisma.opencodeConfig.findFirst({
      where: { userId: payload.userId, isActive: true },
    });

    if (!activeConfig) {
      return NextResponse.json({ error: '未找到活跃配置，无法导入' }, { status: 404 });
    }

    // 1. 更新 OpencodeConfig（只更新允许导入的字段）
    const updated = await prisma.opencodeConfig.update({
      where: { id: activeConfig.id },
      data: {
        ...(body.name !== undefined && { name: String(body.name) }),
        ...(body.baseURL !== undefined && { baseURL: String(body.baseURL) }),
        ...(body.description !== undefined && { description: body.description ? String(body.description) : null }),
        ...(body.projectUploadDir !== undefined && { projectUploadDir: body.projectUploadDir ? String(body.projectUploadDir) : null }),
        ...(body.taskDescription !== undefined && { taskDescription: body.taskDescription ? String(body.taskDescription) : null }),
        ...(body.workflowConfig !== undefined && { workflowConfig: body.workflowConfig ? String(body.workflowConfig) : null }),
        ...(body.customSystemPrompt !== undefined && { customSystemPrompt: body.customSystemPrompt ? String(body.customSystemPrompt) : null }),
        ...(body.claudemdPath !== undefined && { claudemdPath: body.claudemdPath ? String(body.claudemdPath) : null }),
        ...(body.resumeSession !== undefined && { resumeSession: Boolean(body.resumeSession) }),
        ...(body.permissionMode !== undefined && { permissionMode: body.permissionMode ? String(body.permissionMode) : null }),
        ...(body.settingSources !== undefined && { settingSources: body.settingSources ? String(body.settingSources) : null }),
        ...(body.progressQuestion !== undefined && { progressQuestion: body.progressQuestion ? String(body.progressQuestion) : null }),
        ...(body.skillOutputTemplate !== undefined && { skillOutputTemplate: body.skillOutputTemplate ? String(body.skillOutputTemplate) : null }),
        ...(body.claudemdTemplate !== undefined && { claudemdTemplate: body.claudemdTemplate ? String(body.claudemdTemplate) : null }),
        ...(body.mcpServers !== undefined && { mcpServers: body.mcpServers ? String(body.mcpServers) : null }),
        ...(body.keybinds !== undefined && { keybinds: body.keybinds ? String(body.keybinds) : null }),
        ...(body.modelPreferences !== undefined && { modelPreferences: body.modelPreferences ? String(body.modelPreferences) : null }),
      },
    });

    // 2. 导入技术栈选项（upsert by name）
    let techStackImported = 0;
    if (Array.isArray(body.techStackOptions) && body.techStackOptions.length > 0) {
      for (const opt of body.techStackOptions) {
        if (!opt.name || !opt.category) continue;
        await prisma.techStackOption.upsert({
          where: { name: String(opt.name) },
          update: {
            category: String(opt.category),
            description: opt.description ? String(opt.description) : null,
            isActive: opt.isActive !== undefined ? Boolean(opt.isActive) : true,
            // isBuiltin 不覆盖已有值，只在创建时设置
            sortOrder: opt.sortOrder !== undefined ? Number(opt.sortOrder) : 0,
          },
          create: {
            id: `techstack-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: String(opt.name),
            category: String(opt.category),
            description: opt.description ? String(opt.description) : null,
            isActive: opt.isActive !== undefined ? Boolean(opt.isActive) : true,
            isBuiltin: false, // 导入的不算内置
            sortOrder: opt.sortOrder !== undefined ? Number(opt.sortOrder) : 0,
            updatedAt: new Date(),
          },
        });
        techStackImported++;
      }
    }

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        userId: payload.userId,
        action: 'config_import',
        resource: updated.id,
        details: JSON.stringify({ name: updated.name, techStackImported, importedAt: new Date().toISOString() }),
      },
    });

    return NextResponse.json({
      success: true,
      message: `配置导入成功${techStackImported > 0 ? `，已同步 ${techStackImported} 个技术栈选项` : ''}`,
      config: { id: updated.id, name: updated.name },
      techStackImported,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '导入配置失败', { details: String(error) });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
