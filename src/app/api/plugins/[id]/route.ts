import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PluginManager } from '@/services/plugin-manager';
import { PERMISSIONS } from '@/types/permissions';
import type { UpdatePluginConfigRequest } from '@/types/plugin';
import { logger, LOG_MODULES } from '@/lib/logger';

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

/**
 * GET /api/plugins/[id]
 * 获取单个插件详情
 */
export async function GET(request: Request, { params }: RouteParams) {
  // 使用统一认证中间件（需要 PLUGIN_READ 权限）
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.PLUGIN_READ });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload } = auth;

  try {
    const { id } = await params;

    // 获取插件详情
    const plugin = await PluginManager.getPlugin(id);

    if (!plugin) {
      return NextResponse.json(
        { error: '插件不存在' },
        { status: 404 }
      );
    }

    logger.access(LOG_MODULES.PLUGIN, payload, `plugin:${plugin.id}`, { name: plugin.name });
    return NextResponse.json({ plugin });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PLUGIN, '获取插件详情失败', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: '获取插件详情失败' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/plugins/[id]
 * 更新插件配置
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  // 使用统一认证中间件（需要 PLUGIN_UPDATE 权限）
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.PLUGIN_UPDATE });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload } = auth;

  try {
    const { id } = await params;

    // 解析请求体
    const body: UpdatePluginConfigRequest = await request.json();

    // 更新插件配置
    const plugin = await PluginManager.updatePluginConfig(
      id,
      body.config
    );

    logger.update(LOG_MODULES.PLUGIN, payload, `plugin:${plugin.id}`, { name: plugin.name });
    return NextResponse.json({
      message: '插件配置更新成功',
      plugin,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PLUGIN, '更新插件配置失败', error instanceof Error ? error.message : error);
    
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: '更新插件配置失败' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/plugins/[id]
 * 卸载插件
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  // 使用统一认证中间件（需要 PLUGIN_DELETE 权限）
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.PLUGIN_DELETE });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload } = auth;

  try {
    const { id } = await params;

    // 卸载插件
    await PluginManager.uninstallPlugin(id);

    logger.delete(LOG_MODULES.PLUGIN, payload, `plugin:${id}`);
    return NextResponse.json({
      message: '插件卸载成功',
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PLUGIN, '卸载插件失败', error instanceof Error ? error.message : error);
    
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: '卸载插件失败' },
      { status: 500 }
    );
  }
}
