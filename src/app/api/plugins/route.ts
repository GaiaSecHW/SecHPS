import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PluginManager } from '@/services/plugin-manager';
import { PERMISSIONS } from '@/types/permissions';
import type { InstallPluginRequest } from '@/types/plugin';
import { getOffsetPagination } from '@/lib/pagination';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * GET /api/plugins
 * 获取所有插件列表
 */
export async function GET(request: Request) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: '未授权访问' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json(
        { error: '无效的 Token' },
        { status: 401 }
      );
    }

// 检查权限
    logger.debug(LOG_MODULES.PLUGIN, '检查插件读取权限', {
      userId: payload.userId,
      roles: payload.roles,
      details: { hasPluginRead: payload.permissions?.includes(PERMISSIONS.PLUGIN_READ) },
    });
    
    if (!hasPermission(payload.permissions, PERMISSIONS.PLUGIN_READ)) {
      logger.warn(LOG_MODULES.PLUGIN, '插件读取权限不足', {
        userId: payload.userId,
        details: { required: PERMISSIONS.PLUGIN_READ, userPermissions: payload.permissions },
      });
      return NextResponse.json(
        { error: '没有查看插件的权限' },
        { status: 403 }
      );
    }

    // 解析分页参数
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const search = searchParams.get('search') || undefined;

    // 获取分页配置
    const { skip, take } = getOffsetPagination({ page, limit });

    // 获取插件列表
    let allPlugins = await PluginManager.getPlugins();
    
    // 搜索过滤
    if (search) {
      const searchLower = search.toLowerCase();
      allPlugins = allPlugins.filter(plugin => 
        plugin.name.toLowerCase().includes(searchLower) ||
        plugin.displayName?.toLowerCase().includes(searchLower) ||
        plugin.description?.toLowerCase().includes(searchLower)
      );
    }
    
    const total = allPlugins.length;
    const plugins = allPlugins.slice(skip, skip + take);
    const totalPages = Math.ceil(total / take);

    return NextResponse.json({
      plugins,
      pagination: {
        total,
        page,
        limit: take,
        totalPages,
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PLUGIN, '获取插件列表失败', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: '获取插件列表失败' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/plugins
 * 安装新插件
 */
export async function POST(request: Request) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: '未授权访问' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json(
        { error: '无效的 Token' },
        { status: 401 }
      );
    }

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.PLUGIN_CREATE)) {
      return NextResponse.json(
        { error: '没有安装插件的权限' },
        { status: 403 }
      );
    }

    // 解析请求体
    const body: InstallPluginRequest = await request.json();

    // 验证必要字段
    if (!body.manifest || !body.manifest.name || !body.manifest.displayName) {
      return NextResponse.json(
        { error: '插件清单缺少必要字段' },
        { status: 400 }
      );
    }

    // 安装插件
    const plugin = await PluginManager.installPlugin(
      body.manifest,
      body.pluginPath
    );

    logger.create(LOG_MODULES.PLUGIN, payload, `plugin:${plugin.id}`, { name: plugin.name });
    return NextResponse.json({
      message: '插件安装成功',
      plugin,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PLUGIN, '安装插件失败', error instanceof Error ? error.message : error);
    
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: '安装插件失败' },
      { status: 500 }
    );
  }
}
