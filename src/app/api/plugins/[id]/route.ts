import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PluginManager } from '@/services/plugin-manager';
import { PERMISSIONS } from '@/types/permissions';
import type { UpdatePluginConfigRequest } from '@/types/plugin';

interface RouteParams {
  params: {
    id: string;
  };
}

/**
 * GET /api/plugins/[id]
 * 获取单个插件详情
 */
export async function GET(request: Request, { params }: RouteParams) {
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
    if (!hasPermission(payload.permissions, PERMISSIONS.PLUGIN_READ)) {
      return NextResponse.json(
        { error: '没有查看插件的权限' },
        { status: 403 }
      );
    }

    // 获取插件详情
    const plugin = await PluginManager.getPlugin(params.id);

    if (!plugin) {
      return NextResponse.json(
        { error: '插件不存在' },
        { status: 404 }
      );
    }

    return NextResponse.json({ plugin });
  } catch (error) {
    console.error('获取插件详情失败:', error);
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
    if (!hasPermission(payload.permissions, PERMISSIONS.PLUGIN_UPDATE)) {
      return NextResponse.json(
        { error: '没有更新插件的权限' },
        { status: 403 }
      );
    }

    // 解析请求体
    const body: UpdatePluginConfigRequest = await request.json();

    // 更新插件配置
    const plugin = await PluginManager.updatePluginConfig(
      params.id,
      body.config
    );

    return NextResponse.json({
      message: '插件配置更新成功',
      plugin,
    });
  } catch (error) {
    console.error('更新插件配置失败:', error);
    
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
    if (!hasPermission(payload.permissions, PERMISSIONS.PLUGIN_DELETE)) {
      return NextResponse.json(
        { error: '没有卸载插件的权限' },
        { status: 403 }
      );
    }

    // 卸载插件
    await PluginManager.uninstallPlugin(params.id);

    return NextResponse.json({
      message: '插件卸载成功',
    });
  } catch (error) {
    console.error('卸载插件失败:', error);
    
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
