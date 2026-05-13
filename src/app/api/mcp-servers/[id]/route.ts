// src/app/api/mcp-servers/[id]/route.ts
// MCP 服务器配置 API（支持所有权检查 + 多租户）

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { logger, LOG_MODULES } from '@/lib/logger';
import { buildTenantFilter } from '@/lib/tenant-filter';

// 检查用户是否有权限操作此 MCP
function canManageMcp(
  userId: string,
  isAdmin: boolean,
  isIcsTenant: boolean,
  mcp: { userId: string; tenantId: string | null; isPublic: boolean }
): boolean {
  // 平台管理员和 ICSL 租户可以操作所有
  if (isAdmin || isIcsTenant) return true;
  // 所有者可以操作
  if (mcp.userId === userId) return true;
  // public 资源不能被普通租户修改/删除
  return false;
}

// 检查用户是否有权限查看此 MCP
function canViewMcp(
  userId: string,
  tenantId: string | null,
  isAdmin: boolean,
  isIcsTenant: boolean,
  mcp: { userId: string; tenantId: string | null; isPublic: boolean }
): boolean {
  if (isAdmin || isIcsTenant) return true;
  if (mcp.userId === userId) return true;
  if (mcp.isPublic) return true;
  // 同租户可以查看
  if (tenantId && mcp.tenantId === tenantId) return true;
  return false;
}

// GET /api/mcp-servers/[id] - 获取单个 MCP 配置
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload, tenant } = auth as AuthSuccessResult;

  try {
    const { id } = await params;

    const mcpServer = await prisma.mcpServerConfig.findFirst({
      where: {
        id,
        projectId: null,
      },
      include: {
        User: {
          select: { id: true, username: true, name: true },
        },
      },
    });

    if (!mcpServer) {
      return NextResponse.json({ error: 'MCP 服务器配置不存在' }, { status: 404 });
    }

    // 检查查看权限（多租户）
    if (!canViewMcp(payload.userId, tenant.tenantId, tenant.isPlatformAdmin, tenant.isIcsTenant, mcpServer)) {
      return NextResponse.json({ error: '无权限访问此 MCP' }, { status: 403 });
    }

    logger.access(LOG_MODULES.MCP, payload, `mcp:${mcpServer.id}`, { name: mcpServer.name });
    return NextResponse.json({ mcpServer });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MCP, '获取 MCP 服务器详情失败', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PATCH /api/mcp-servers/[id] - 更新 MCP 配置
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload, tenant } = auth as AuthSuccessResult;

  try {
    const { id } = await params;
    const body = await request.json();

    // 检查是否存在
    const existing = await prisma.mcpServerConfig.findFirst({
      where: {
        id,
        projectId: null,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'MCP 服务器配置不存在' }, { status: 404 });
    }

    // 检查管理权限（多租户）
    if (!canManageMcp(payload.userId, tenant.isPlatformAdmin, tenant.isIcsTenant, existing)) {
      return NextResponse.json({ error: '无权限修改此 MCP' }, { status: 403 });
    }

    // ICSL/Admin 可以设置 isPublic，普通用户不能
    const isPublic = body.isPublic ?? existing.isPublic;
    if (isPublic && !tenant.isIcsTenant && !tenant.isPlatformAdmin) {
      return NextResponse.json({ error: '只有 ICSL 租户可以创建公共资源' }, { status: 403 });
    }

    // 更新配置
    const updated = await prisma.mcpServerConfig.update({
      where: { id },
      data: {
        name: body.name ?? existing.name,
        type: body.type ?? existing.type,
        command: body.command ?? existing.command,
        args: body.args ?? existing.args,
        url: body.url ?? existing.url,
        env: body.env ?? existing.env,
        tools: body.tools ?? existing.tools,
        isEnabled: body.isEnabled ?? existing.isEnabled,
        autoStart: body.autoStart ?? existing.autoStart,
        isPublic: isPublic,
        updatedAt: new Date(),
      },
    });

    logger.update(LOG_MODULES.MCP, payload, id, { name: updated.name });
    return NextResponse.json({ mcpServer: updated });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MCP, '更新 MCP 服务器配置失败', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/mcp-servers/[id] - 删除 MCP 配置
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request);
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload, tenant } = auth as AuthSuccessResult;

  try {
    const { id } = await params;

    // 检查是否存在
    const existing = await prisma.mcpServerConfig.findFirst({
      where: {
        id,
        projectId: null,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'MCP 服务器配置不存在' }, { status: 404 });
    }

    // 检查管理权限（多租户）- public 资源不能被普通租户删除
    if (!canManageMcp(payload.userId, tenant.isPlatformAdmin, tenant.isIcsTenant, existing)) {
      return NextResponse.json({ error: '无权限删除此 MCP' }, { status: 403 });
    }

    // 删除配置
    await prisma.mcpServerConfig.delete({
      where: { id },
    });

    logger.delete(LOG_MODULES.MCP, payload, id, { name: existing.name });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MCP, '删除 MCP 服务器配置失败', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}