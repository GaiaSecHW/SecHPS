// src/app/api/config/default-tool-permissions/route.ts
// 全局默认工具权限配置 API

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * GET /api/config/default-tool-permissions
 * 获取全局默认工具权限配置
 */
export async function GET(request: Request) {
  // 使用统一认证中间件（无权限要求，只需登录）
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload } = auth;

  try {

    // 获取激活的全局配置
    const globalConfig = await prisma.opencodeConfig.findFirst({
      where: { isActive: true },
      select: {
        id: true,
        defaultToolPermissions: true,
      },
    });

    if (!globalConfig) {
      return NextResponse.json({ 
        configId: null,
        permissions: [],
      });
    }

    // 解析权限配置
    let permissions: Array<{ toolPattern: string; permission: string }> = [];
    if (globalConfig.defaultToolPermissions) {
      try {
        permissions = JSON.parse(globalConfig.defaultToolPermissions);
      } catch {
        logger.errorNoUser(LOG_MODULES.CONFIG, '解析默认工具权限失败', { details: 'JSON parse error' });
        permissions = [];
      }
    }

    return NextResponse.json({
      configId: globalConfig.id,
      permissions,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '获取默认工具权限失败', { details: String(error) });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * PUT /api/config/default-tool-permissions
 * 更新全局默认工具权限配置
 */
export async function PUT(request: Request) {
  let configId: string | undefined;
  
  // 使用统一认证中间件（需要 CONFIG_UPDATE 权限）
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_UPDATE });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload } = auth;
  
  try {

    const body = await request.json();
    configId = body.configId;
    const permissions = body.permissions;

    if (!configId) {
      return NextResponse.json({ error: '缺少配置ID' }, { status: 400 });
    }

    // 验证权限数据格式
    if (!Array.isArray(permissions)) {
      return NextResponse.json({ error: '权限数据必须是数组' }, { status: 400 });
    }

    // 验证每个权限项
    for (const perm of permissions) {
      if (!perm.toolPattern || !perm.permission) {
        return NextResponse.json({ error: '每个权限项必须包含 toolPattern 和 permission' }, { status: 400 });
      }
      if (!['allow', 'deny', 'ask'].includes(perm.permission)) {
        return NextResponse.json({ error: 'permission 必须是 allow, deny 或 ask' }, { status: 400 });
      }
    }

    // 更新配置
    const updatedConfig = await prisma.opencodeConfig.update({
      where: { id: configId },
      data: {
        defaultToolPermissions: JSON.stringify(permissions),
      },
    });

    logger.update(LOG_MODULES.CONFIG, payload, configId, { permissionsCount: permissions.length });

    return NextResponse.json({
      message: '默认工具权限已更新',
      configId: updatedConfig.id,
      permissions,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '更新默认工具权限失败', { details: String(error), configId });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}