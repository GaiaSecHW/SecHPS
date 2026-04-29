import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/config/export — 导出当前用户的活跃配置为 JSON 文件
export async function GET(request: Request) {
  // 使用统一认证中间件（需要 CONFIG_READ 权限）
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_READ });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const { payload } = auth;

  try {

    // 获取活跃配置 + 技术栈选项（并行）
    const [config, techStackOptions] = await Promise.all([
      prisma.opencodeConfig.findFirst({
        where: { isActive: true },
      }),
      prisma.techStackOption.findMany({
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      }),
    ]);

    if (!config) {
      return NextResponse.json({ details: { error: '未找到活跃配置' } }, { status: 404 });
    }

    // 构建导出数据（不含敏感字段：id, userId, createdAt, updatedAt）
    const exportData = {
      _version: '1.1',
      _exportedAt: new Date().toISOString(),
      _source: 'AI4WEB 平台',
      // OpencodeConfig 字段
      name: config.name,
      baseURL: config.baseURL,
      description: config.description,
      projectUploadDir: config.projectUploadDir,
      taskDescription: config.taskDescription,
      workflowConfig: config.workflowConfig,
      customSystemPrompt: config.customSystemPrompt,
      claudemdPath: config.claudemdPath,
      resumeSession: config.resumeSession,
      permissionMode: config.permissionMode,
      settingSources: config.settingSources,
      progressQuestion: config.progressQuestion,
      skillOutputTemplate: config.skillOutputTemplate,
      claudemdTemplate: config.claudemdTemplate,
      keybinds: config.keybinds,
      modelPreferences: config.modelPreferences,
      // 技术栈选项（不含 id/createdAt/updatedAt，导入时重建）
      techStackOptions: techStackOptions.map((o) => ({
        name: o.name,
        category: o.category,
        description: o.description,
        isActive: o.isActive,
        isBuiltin: o.isBuiltin,
        sortOrder: o.sortOrder,
      })),
    };

    const json = JSON.stringify(exportData, null, 2);
    const filename = `ai4web-config-${new Date().toISOString().slice(0, 10)}.json`;

    return new NextResponse(json, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '导出配置失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
