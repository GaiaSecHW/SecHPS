import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
import { AuditLogger } from '@/lib/audit/logger';

// 更新角色
// 只能由工作流所有者或管理员更新
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; roleId: string }> }
) {
  try {
    // 验证 Token 和权限
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.WORKFLOW_UPDATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id, roleId } = await params;

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 检查工作流是否存在
    const workflow = await prisma.workflow.findUnique({
      where: { id },
      select: { id: true, userId: true, name: true },
    });

    if (!workflow) {
      return NextResponse.json({ error: '工作流不存在' }, { status: 404 });
    }

    // 检查权限：只能更新自己的，管理员可以更新所有
    if (!userIsAdmin && workflow.userId !== payload.userId) {
      logger.permissionDenied(LOG_MODULES.WORKFLOW, payload, 'WORKFLOW_UPDATE', id, { workflowName: workflow.name });
      return NextResponse.json({ error: '禁止访问：只能更新自己创建的工作流' }, { status: 403 });
    }

    // 检查角色是否存在且属于该工作流
    const existingRole = await prisma.workflowRole.findFirst({
      where: { id: roleId, workflowId: id },
    });

    if (!existingRole) {
      return NextResponse.json({ error: '角色不存在' }, { status: 404 });
    }

    // 解析请求体
    const body = await request.json();
    const { name, description, color, order } = body;

    // 构建更新数据
    const updateData: any = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim() === '') {
        return NextResponse.json({ error: '角色名称不能为空' }, { status: 400 });
      }
      updateData.name = name.trim();
    }
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (color !== undefined) updateData.color = color || null;
    if (order !== undefined) updateData.order = order;

    // 如果没有要更新的字段
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: '没有提供要更新的字段' }, { status: 400 });
    }

    // 更新角色
    const role = await prisma.workflowRole.update({
      where: { id: roleId },
      data: updateData,
    });

    // 记录审计日志
    await AuditLogger.logFromRequest(request, {
      userId: payload.userId,
      action: 'workflow_update',
      resource: roleId,
      details: { workflowId: id, after: updateData, operation: 'role_update' },
    });

    logger.update(LOG_MODULES.WORKFLOW, payload, roleId, { workflowId: id, name: role.name, type: 'workflow-role' });

    return NextResponse.json({
      message: '角色更新成功',
      role,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, 'Update workflow role error', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 删除角色
// 只能由工作流所有者或管理员删除
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; roleId: string }> }
) {
  try {
    // 验证 Token 和权限
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.WORKFLOW_UPDATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id, roleId } = await params;

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 检查工作流是否存在
    const workflow = await prisma.workflow.findUnique({
      where: { id },
      select: { id: true, userId: true, name: true },
    });

    if (!workflow) {
      return NextResponse.json({ error: '工作流不存在' }, { status: 404 });
    }

    // 检查权限：只能删除自己的，管理员可以删除所有
    if (!userIsAdmin && workflow.userId !== payload.userId) {
      logger.permissionDenied(LOG_MODULES.WORKFLOW, payload, 'WORKFLOW_UPDATE', id, { workflowName: workflow.name });
      return NextResponse.json({ error: '禁止访问：只能更新自己创建的工作流' }, { status: 403 });
    }

    // 检查角色是否存在且属于该工作流
    const existingRole = await prisma.workflowRole.findFirst({
      where: { id: roleId, workflowId: id },
      include: {
        nodes: { select: { id: true } },
      },
    });

    if (!existingRole) {
      return NextResponse.json({ error: '角色不存在' }, { status: 404 });
    }

    // 检查是否有节点关联此角色
    if (existingRole.nodes.length > 0) {
      return NextResponse.json({
        error: `无法删除：有 ${existingRole.nodes.length} 个节点正在使用此角色`,
        nodeCount: existingRole.nodes.length,
      }, { status: 400 });
    }

    // 删除角色
    await prisma.workflowRole.delete({
      where: { id: roleId },
    });

    // 记录审计日志
    await AuditLogger.logFromRequest(request, {
      userId: payload.userId,
      action: 'workflow_update',
      resource: roleId,
      details: { workflowId: id, roleName: existingRole.name, operation: 'role_delete' },
    });

    logger.delete(LOG_MODULES.WORKFLOW, payload, roleId, { workflowId: id, name: existingRole.name, type: 'workflow-role' });

    return NextResponse.json({
      message: '角色删除成功',
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, 'Delete workflow role error', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}