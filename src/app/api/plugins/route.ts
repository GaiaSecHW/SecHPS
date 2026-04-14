import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PluginManager } from '@/services/plugin-manager';
import { PERMISSIONS } from '@/types/permissions';
import type { InstallPluginRequest } from '@/types/plugin';
import { getOffsetPagination } from '@/lib/pagination';

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
    console.log('[Plugins API] User payload:', {
      userId: payload.userId,
      roles: payload.roles,
      permissionsCount: payload.permissions?.length,
      hasPluginRead: payload.permissions?.includes(PERMISSIONS.PLUGIN_READ),
    });
    
    if (!hasPermission(payload.permissions, PERMISSIONS.PLUGIN_READ)) {
      console.log('[Plugins API] Permission denied. Required:', PERMISSIONS.PLUGIN_READ);
      console.log('[Plugins API] User permissions:', payload.permissions);
      return NextResponse.json(
        { error: '没有查看插件的权限' },
        { status: 403 }
      );
    }

    // 解析分页参数
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    // 获取分页配置
    const { skip, take } = getOffsetPagination({ page, limit });

    // 获取插件列表
    const allPlugins = await PluginManager.getPlugins();
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
    console.error('获取插件列表失败:', error);
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

    return NextResponse.json({
      message: '插件安装成功',
      plugin,
    });
  } catch (error) {
    console.error('安装插件失败:', error);
    
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
