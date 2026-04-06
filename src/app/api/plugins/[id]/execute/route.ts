import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PluginManager } from '@/services/plugin-manager';
import { PluginRunner } from '@/services/plugin-runner';
import { PERMISSIONS } from '@/types/permissions';
import type { PluginExecutionContext } from '@/types/plugin';

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
  try {
    const { id } = await params;
    
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

    // 检查权限 - 可以定义一个新的权限 PLUGIN_EXECUTE
    if (!hasPermission(payload.permissions, PERMISSIONS.PLUGIN_UPDATE)) {
      return NextResponse.json(
        { error: '没有执行插件的权限' },
        { status: 403 }
      );
    }

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

    return NextResponse.json({
      message: result.success ? '插件执行成功' : '插件执行失败',
      result,
    });
  } catch (error) {
    console.error('执行插件失败:', error);
    
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
