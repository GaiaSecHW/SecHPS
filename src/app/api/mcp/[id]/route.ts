import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { hasPermission } from '@/lib/auth';
import { logger, LOG_MODULES } from '@/lib/logger';
import { generateId } from '@/lib/id-generator';
import { buildTenantFilter } from '@/lib/tenant-filter';

// 检查用户是否有权限查看 MCP（多租户）
function canViewMcp(
  userId: string,
  tenantId: string | null,
  isPlatformAdmin: boolean,
  isIcsTenant: boolean,
  mcp: { userId: string; tenantId: string | null; isPublic: boolean }
): boolean {
  if (isPlatformAdmin || isIcsTenant) return true;
  if (mcp.userId === userId) return true;
  if (mcp.isPublic) return true;
  if (tenantId && mcp.tenantId === tenantId) return true;
  return false;
}

// 检查用户是否有权限管理 MCP（多租户）
function canManageMcp(
  userId: string,
  isPlatformAdmin: boolean,
  isIcsTenant: boolean,
  mcp: { userId: string; tenantId: string | null; isPublic: boolean }
): boolean {
  if (isPlatformAdmin || isIcsTenant) return true;
  if (mcp.userId === userId && !mcp.isPublic) return true;
  return false;
}

// GET /api/mcp/[id] - 获取单个 MCP 服务器详情
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

    const mcpServer = await prisma.mcpServerConfig.findUnique({
      where: { id },
    });

    if (!mcpServer) {
      return NextResponse.json({ error: 'MCP 服务器不存在' }, { status: 404 });
    }

    // 检查权限（多租户）
    if (!canViewMcp(payload.userId, tenant.tenantId, tenant.isPlatformAdmin, tenant.isIcsTenant, mcpServer)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    logger.read(LOG_MODULES.MCP, payload, 'mcp', id, { name: mcpServer.name });

    return NextResponse.json({
      mcpServer: {
        id: mcpServer.id,
        name: mcpServer.name,
        type: mcpServer.type,
        command: mcpServer.command,
        args: mcpServer.args,
        url: mcpServer.url,
        env: mcpServer.env,
        tools: mcpServer.tools ? JSON.parse(mcpServer.tools) : null,
        isEnabled: mcpServer.isEnabled,
        autoStart: mcpServer.autoStart,
        isPublic: mcpServer.isPublic,
        projectId: mcpServer.projectId,
        userId: mcpServer.userId,
        lastTestedAt: mcpServer.lastTestedAt,
        createdAt: mcpServer.createdAt,
        updatedAt: mcpServer.updatedAt,
        isOwner: mcpServer.userId === payload.userId,
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MCP, '获取 MCP 服务器详情失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PATCH /api/mcp/[id] - 更新 MCP 服务器
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

    const existingServer = await prisma.mcpServerConfig.findUnique({
      where: { id },
    });

    if (!existingServer) {
      return NextResponse.json({ error: 'MCP 服务器不存在' }, { status: 404 });
    }

    // 检查管理权限（多租户）
    if (!canManageMcp(payload.userId, tenant.isPlatformAdmin, tenant.isIcsTenant, existingServer)) {
      return NextResponse.json({ error: '禁止访问：只能修改自己创建的 MCP' }, { status: 403 });
    }

    const body = await request.json();
    const { name, type, command, args, url, env, isEnabled, autoStart, isPublic } = body;

    // ICSL/Admin 可以设置 isPublic
    const newIsPublic = isPublic ?? existingServer.isPublic;
    if (newIsPublic !== existingServer.isPublic && !tenant.isIcsTenant && !tenant.isPlatformAdmin) {
      return NextResponse.json({ error: '只有 ICSL 租户可以创建公共资源' }, { status: 403 });
    }

    // 更新服务器
    const updatedServer = await prisma.mcpServerConfig.update({
      where: { id },
      data: {
        name: name ?? existingServer.name,
        type: type ?? existingServer.type,
        command: command ?? existingServer.command,
        args: args ?? existingServer.args,
        url: url ?? existingServer.url,
        env: env ?? existingServer.env,
        isEnabled: isEnabled ?? existingServer.isEnabled,
        autoStart: autoStart ?? existingServer.autoStart,
        isPublic: newIsPublic,
        updatedAt: new Date(),
      },
    });

    logger.update(LOG_MODULES.MCP, payload, 'mcp', id, { name: updatedServer.name });

    return NextResponse.json({
      mcpServer: {
        id: updatedServer.id,
        name: updatedServer.name,
        type: updatedServer.type,
        command: updatedServer.command,
        args: updatedServer.args,
        url: updatedServer.url,
        env: updatedServer.env,
        isEnabled: updatedServer.isEnabled,
        autoStart: updatedServer.autoStart,
        isPublic: updatedServer.isPublic,
        projectId: updatedServer.projectId,
        userId: updatedServer.userId,
        createdAt: updatedServer.createdAt,
        updatedAt: updatedServer.updatedAt,
        isOwner: updatedServer.userId === payload.userId,
      },
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MCP, '更新 MCP 服务器失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/mcp/[id] - 删除 MCP 服务器
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

    const existingServer = await prisma.mcpServerConfig.findUnique({
      where: { id },
    });

    if (!existingServer) {
      return NextResponse.json({ error: 'MCP 服务器不存在' }, { status: 404 });
    }

    // 检查管理权限（多租户）- public 资源不能被普通租户删除
    if (!canManageMcp(payload.userId, tenant.isPlatformAdmin, tenant.isIcsTenant, existingServer)) {
      return NextResponse.json({ error: '禁止访问：只能删除自己创建的 MCP' }, { status: 403 });
    }

    // 删除服务器
    await prisma.mcpServerConfig.delete({
      where: { id },
    });

    logger.delete(LOG_MODULES.MCP, payload, 'mcp', id, { name: existingServer.name });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.MCP, '删除 MCP 服务器失败', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}