import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PluginManager } from '@/services/plugin-manager';
import { PERMISSIONS } from '@/types/permissions';
import * as fs from 'fs';
import * as path from 'path';
import type { PluginManifest, InstallPluginFromUrlRequest } from '@/types/plugin';
import { logger, LOG_MODULES } from '@/lib/logger';

// turbopackIgnore 防止 Turbopack 追踪整个项目
const PLUGINS_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), 'plugins');

/**
 * POST /api/plugins/install
 * 从 URL 安装插件
 */
export async function POST(request: Request) {
  // 使用统一认证中间件（需要 PLUGIN_CREATE 权限）
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.PLUGIN_CREATE });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload } = auth;

  try {

    // 解析请求体
    const body: InstallPluginFromUrlRequest = await request.json();

    if (!body.url) {
      return NextResponse.json(
        { error: '请提供插件 URL' },
        { status: 400 }
      );
    }

    // 获取 manifest.json
    let manifest: PluginManifest;
    let pluginDir: string;

    if (body.url.endsWith('.json')) {
      // 直接获取 manifest.json
      const response = await fetch(body.url);
      if (!response.ok) {
        throw new Error('无法获取 manifest.json');
      }
      manifest = await response.json();
      pluginDir = path.join(PLUGINS_DIR, manifest.name);
    } else {
      // 假设是压缩包 URL（暂不支持）
      return NextResponse.json(
        { error: '暂不支持从压缩包安装，请提供 manifest.json 的 URL' },
        { status: 400 }
      );
    }

    // 验证 manifest
    if (!manifest.name || !manifest.displayName) {
      return NextResponse.json(
        { error: 'manifest.json 缺少必要字段（name, displayName）' },
        { status: 400 }
      );
    }

    // 创建插件目录
    if (!fs.existsSync(pluginDir)) {
      fs.mkdirSync(pluginDir, { recursive: true });
    }

    // 保存 manifest.json
    fs.writeFileSync(
      path.join(pluginDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );

    // 安装插件到数据库
    const plugin = await PluginManager.installPlugin(manifest, pluginDir);

    logger.create(LOG_MODULES.PLUGIN, payload, `plugin:${plugin.id}`, { name: manifest.name, url: body.url });
    return NextResponse.json({
      message: '插件安装成功',
      plugin,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PLUGIN, '从 URL 安装插件失败', error instanceof Error ? error.message : error);
    
    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: '从 URL 安装插件失败' },
      { status: 500 }
    );
  }
}
