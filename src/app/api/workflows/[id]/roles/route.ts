import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { AuditLogger } from '@/lib/audit/logger';

// 获取工作流的角色列表
// 普通用户：可以查看自己的 + 公开的 + 被分享的
// 管理员：可以查看所有
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token 和权限
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.WORKFLOW_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    // 检查是否是管理员
    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');

    // 构建查询条件
    let where: any = { id };
    
    if (!isAdmin) {
      // 普通用户：可以查看自己的 + 公开的 + 被分享的
      where.OR = [
        { userId: payload.userId },
        { isPublic: true },
        {
          WorkflowShare: {
            some: {
              sharedWith: payload.userId,
            },
          },
        },
      ];
    }

    // 检查工作流是否存在且有权限访问
    const workflow = await prisma.workflow.findFirst({
      where,
      select: { id: true, userId: true, name: true },
    });

    if (!workflow) {
      return NextResponse.json({ error: '工作流不存在或无权限访问' }, { status: 404 });
    }

    // 获取角色列表
    const roles = await prisma.workflowRole.findMany({
      where: { workflowId: id },
      orderBy: { order: 'asc' },
      include: {
        nodes: {
          select: { id: true, type: true },
        },
      },
    });

    logger.read(LOG_MODULES.WORKFLOW, payload, 'workflow-roles', id, { count: roles.length });

    return NextResponse.json({ roles });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, 'Get workflow roles error', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 创建新角色
// 只能由工作流所有者或管理员创建
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token 和权限
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.WORKFLOW_UPDATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    // 检查是否是管理员
    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');

    // 检查工作流是否存在
    const workflow = await prisma.workflow.findUnique({
      where: { id },
      select: { id: true, userId: true, name: true },
    });

    if (!workflow) {
      return NextResponse.json({ error: '工作流不存在' }, { status: 404 });
    }

    // 检查权限：只能更新自己的，管理员可以更新所有
    if (!isAdmin && workflow.userId !== payload.userId) {
      logger.permissionDenied(LOG_MODULES.WORKFLOW, payload, 'WORKFLOW_UPDATE', id, { workflowName: workflow.name });
      return NextResponse.json({ error: '禁止访问：只能更新自己创建的工作流' }, { status: 403 });
    }

    // 解析请求体
    const body = await request.json();
    const { name, description, color, order } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json({ error: '角色名称不能为空' }, { status: 400 });
    }

    // 获取当前最大 order 值
    const maxOrderRole = await prisma.workflowRole.findFirst({
      where: { workflowId: id },
      orderBy: { order: 'desc' },
      select: { order: true },
    });

    const newOrder = order !== undefined ? order : (maxOrderRole?.order ?? 0) + 1;

    // 创建角色
    const role = await prisma.workflowRole.create({
      data: {
        workflowId: id,
        name: name.trim(),
        description: description?.trim() || null,
        color: color || null,
        order: newOrder,
      },
    });

    // 记录审计日志
    await AuditLogger.logFromRequest(request, {
      userId: payload.userId,
      action: 'workflow_update',
      resource: role.id,
      details: { workflowId: id, roleName: role.name, operation: 'role_create' },
    });

    logger.create(LOG_MODULES.WORKFLOW, payload, role.id, { workflowId: id, name: role.name, type: 'workflow-role' });

    return NextResponse.json({
      message: '角色创建成功',
      role,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, 'Create workflow role error', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}