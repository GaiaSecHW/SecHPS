import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/config/export — 导出当前用户的活跃配置为 JSON 文件
export async function GET(request: Request) {
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

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 获取用户的活跃配置 + 技术栈选项（并行）
    const [config, techStackOptions] = await Promise.all([
      prisma.opencodeConfig.findFirst({
        where: { userId: payload.userId, isActive: true },
      }),
      prisma.techStackOption.findMany({
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      }),
    ]);

    if (!config) {
      return NextResponse.json({ error: '未找到活跃配置' }, { status: 404 });
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
      mcpServers: config.mcpServers,
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
    console.error('Export config error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
