import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PluginManager } from '@/services/plugin-manager';
import { PluginRunner } from '@/services/plugin-runner';
import { PERMISSIONS } from '@/types/permissions';
import type { PluginExecutionContext } from '@/types/plugin';
import { logger, LOG_MODULES } from '@/lib/logger';

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

/**
 * POST /api/plugins/[id]/execute
 * 执行插件
 */
export async function POST(request: Request, { params }: RouteParams) {
  // 使用统一认证中间件（需要 PLUGIN_UPDATE 权限）
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.PLUGIN_UPDATE });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload } = auth;

  try {
    const { id } = await params;

    // 获取插件
    const plugin = await PluginManager.getPlugin(id);
    if (!plugin) {
      return NextResponse.json(
        { error: '插件不存在' },
        { status: 404 }
      );
    }

    if (!plugin.isEnabled) {
      return NextResponse.json(
        { error: '插件未启用' },
        { status: 400 }
      );
    }

    // 解析执行上下文
    const body = await request.json();
    const context: PluginExecutionContext = {
      userId: payload.userId,
      projectId: body.projectId,
      evaluationId: body.evaluationId,
      config: body.config || plugin.config,
      env: body.env,
    };

    // 执行插件
    const result = await PluginRunner.executePlugin(plugin, context);

    logger.access(LOG_MODULES.PLUGIN, payload, `plugin:${plugin.id}:execute`, { name: plugin.name, success: result.success });
    return NextResponse.json({
      message: result.success ? '插件执行成功' : '插件执行失败',
      result,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PLUGIN, '执行插件失败', error instanceof Error ? error.message : error);
    
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: '执行插件失败' },
      { status: 500 }
    );
  }
}
