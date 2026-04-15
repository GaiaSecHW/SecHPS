// src/app/api/config/default-tool-permissions/route.ts
// 全局默认工具权限配置 API

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

/**
 * GET /api/config/default-tool-permissions
 * 获取全局默认工具权限配置
 */
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

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
        console.error('[DefaultToolPermissions] 解析失败');
        permissions = [];
      }
    }

    return NextResponse.json({
      configId: globalConfig.id,
      permissions,
    });
  } catch (error) {
    console.error('[DefaultToolPermissions GET] Error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * PUT /api/config/default-tool-permissions
 * 更新全局默认工具权限配置
 */
export async function PUT(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 检查管理员权限
    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问 - 需要管理员权限' }, { status: 403 });
    }

    const body = await request.json();
    const { configId, permissions } = body;

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

    console.log('[DefaultToolPermissions] 已更新:', permissions.length, '条规则');

    return NextResponse.json({
      message: '默认工具权限已更新',
      configId: updatedConfig.id,
      permissions,
    });
  } catch (error) {
    console.error('[DefaultToolPermissions PUT] Error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}