import { NextResponse } from 'next/server';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PluginManager } from '@/services/plugin-manager';
import { PERMISSIONS } from '@/types/permissions';
import type { TogglePluginRequest } from '@/types/plugin';

/**
 * POST /api/plugins/[id]/toggle
 * 启用/禁用插件
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
    if (!hasPermission(payload.permissions, PERMISSIONS.PLUGIN_TOGGLE)) {
      return NextResponse.json(
        { error: '没有切换插件状态的权限' },
        { status: 403 }
      );
    }

    // 解析请求体
    const body: TogglePluginRequest = await request.json();

    // 解析 params (Next.js 15+ 要求 await)
    const { id } = await params;

    // 切换插件状态
    const plugin = await PluginManager.togglePlugin(
      id,
      body.enabled
    );

    return NextResponse.json({
      message: body.enabled ? '插件已启用' : '插件已禁用',
      plugin,
    });
  } catch (error) {
    console.error('切换插件状态失败:', error);
    
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
