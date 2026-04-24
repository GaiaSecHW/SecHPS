import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
import { AuditLogger } from '@/lib/audit/logger';
import { generateId } from '@/lib/id-generator';

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
    const userIsAdmin = isAdmin(payload);

    // 构建查询条件
    let where: any = { id };
    
    if (!userIsAdmin) {
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
      select: { id: true, userId: true, name: true, workflowType: true, fsmTemplateId: true },
    });

    if (!workflow) {
      return NextResponse.json({ error: '工作流不存在或无权限访问' }, { status: 404 });
    }

    // 获取角色列表
    const roles = await prisma.workflowRole.findMany({
      where: { workflowId: id },
      orderBy: { order: 'asc' },
      include: {
        WorkflowNode: {
          select: { id: true, type: true, data: true, fsmPhase: true },
        },
      },
    });

    // 如果是 FSM 工作流，还需要从 FSMTemplate 获取 P1-P6 节点的角色信息
    if (workflow.workflowType === 'fsm' && workflow.fsmTemplateId) {
      const fsmTemplate = await prisma.fSMTemplate.findUnique({
        where: { id: workflow.fsmTemplateId },
        select: { nodes: true },
      });
      
      if (fsmTemplate) {
        const fsmNodes = JSON.parse(fsmTemplate.nodes);
        
        // 收集 FSM 节点的角色 ID
        const fsmRoleIds = new Set<string>();
        const fsmNodesWithoutRole: any[] = [];
        
        fsmNodes.forEach((node: any) => {
          if (node.roleId) {
            fsmRoleIds.add(node.roleId);
          } else {
            fsmNodesWithoutRole.push(node);
          }
        });
        
        // 对于每个有角色的 FSM 节点，添加到对应角色的 WorkflowNode 列表
        for (const role of roles) {
          const fsmNodesForRole = fsmNodes.filter((n: any) => n.roleId === role.id);
          if (fsmNodesForRole.length > 0) {
            // 确保 role.WorkflowNode 存在
            if (!role.WorkflowNode) role.WorkflowNode = [];
            // 添加 FSM 节点信息
            fsmNodesForRole.forEach((n: any) => {
              const nodeData = n.data ? JSON.parse(n.data) : {};
              const label = nodeData.label || n.id;
              (role.WorkflowNode as any[]).push({ id: n.id, type: 'fsm-phase', label, fsmPhase: n.fsmPhase });
            });
          }
        }
        
        // 如果有未分配角色的 FSM 节点，添加"默认角色"
        if (fsmNodesWithoutRole.length > 0) {
          roles.push({
            id: 'default',
            name: '默认角色',
            description: '未分配角色的 FSM 阶段节点将使用此模型',
            color: '#gray',
            order: 999,
            WorkflowNode: fsmNodesWithoutRole.map((n: any) => {
              const nodeData = n.data ? JSON.parse(n.data) : {};
              const label = nodeData.label || n.id;
              return {
                id: n.id,
                type: 'fsm-phase',
                label,
                fsmPhase: n.fsmPhase,
              };
            }) as any[],
            nodeCount: fsmNodesWithoutRole.length,
          } as any);
        }
      }
    }

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
        id: generateId('wr'),
        workflowId: id,
        name: name.trim(),
        description: description?.trim() || null,
        color: color || null,
        order: newOrder,
        updatedAt: new Date(),
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