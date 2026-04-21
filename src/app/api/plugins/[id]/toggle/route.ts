import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PluginManager } from '@/services/plugin-manager';
import { PERMISSIONS } from '@/types/permissions';
import type { TogglePluginRequest } from '@/types/plugin';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * POST /api/plugins/[id]/toggle
 * 启用/禁用插件
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 使用统一认证中间件（需要 PLUGIN_TOGGLE 权限）
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.PLUGIN_TOGGLE });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload } = auth;

  try {

    // 解析请求体
    const body: TogglePluginRequest = await request.json();

    // 解析 params (Next.js 15+ 要求 await)
    const { id } = await params;

    // 切换插件状态
    const plugin = await PluginManager.togglePlugin(
      id,
      body.enabled
    );

    logger.update(LOG_MODULES.PLUGIN, payload, `plugin:${plugin.id}:toggle`, { name: plugin.name, enabled: body.enabled });
    return NextResponse.json({
      message: body.enabled ? '插件已启用' : '插件已禁用',
      plugin,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PLUGIN, '切换插件状态失败', error instanceof Error ? error.message : error);
    
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: '切换插件状态失败' },
      { status: 500 }
    );
  }
}
