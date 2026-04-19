import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { validateWorkflow } from '@/lib/workflow-validator';

// 获取工作流数据（nodes 和 edges）
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.WORKFLOW_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;

    // 检查是否是管理员
    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');

    // 构建查询条件：管理员可访问所有，普通用户可访问自己的 + 公开的 + 被分享的
    let where: any = { id };
    
    if (!isAdmin) {
      where.OR = [
        { userId: payload.userId },
        { isPublic: true },
        { WorkflowShare: { some: { sharedWith: payload.userId } } },
      ];
    }

    // 查询工作流及其节点和边
    const workflow = await prisma.workflow.findFirst({
      where,
      include: {
        WorkflowNode: true,
        WorkflowEdge: true,
      },
    });

    if (!workflow) {
      return NextResponse.json({ error: '工作流不存在或无权访问' }, { status: 404 });
    }

    // 转换数据格式为前端期望的格式
    const nodes = workflow.WorkflowNode.map((node) => ({
      id: node.id,
      type: node.type,
      roleId: node.roleId,  // 添加 roleId 字段
      position: {
        x: node.positionX,
        y: node.positionY,
      },
      data: node.data ? JSON.parse(node.data) : {},
    }));

    const edges = workflow.WorkflowEdge.map((edge) => ({
      id: edge.id,
      source: edge.sourceId,
      target: edge.targetId,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: edge.label,
      data: edge.data ? JSON.parse(edge.data) : undefined,
    }));

    return NextResponse.json({
      nodes,
      edges,
      version: workflow.version,
    });
  } catch (error) {
    console.error('Get workflow data error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 保存工作流数据（nodes 和 edges）
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.WORKFLOW_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;

    // 检查是否是管理员
    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');

    // 检查工作流是否存在且用户有编辑权限（管理员可编辑所有）
    const existingWorkflow = await prisma.workflow.findFirst({
      where: {
        id,
        ...(isAdmin ? {} : { userId: payload.userId }),
      },
    });

    if (!existingWorkflow) {
      return NextResponse.json({ error: '工作流不存在或无权访问' }, { status: 404 });
    }

    // 解析请求体
    const body = await request.json();
    const { nodes, edges, thumbnail } = body;

    // 验证数据格式
    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      return NextResponse.json(
        { error: 'nodes 和 edges 必须是数组' },
        { status: 400 }
      );
    }

    // 验证工作流结构（始终使用严格验证）
    const validation = validateWorkflow(nodes, edges, true);
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: '工作流验证失败',
          details: validation.errors,
          warnings: validation.warnings,
        },
        { status: 400 }
      );
    }

    // 使用事务更新工作流数据
    const result = await prisma.$transaction(async (tx) => {
      // 删除旧的 nodes 和 edges
      await tx.workflowNode.deleteMany({
        where: { workflowId: id },
      });

      await tx.workflowEdge.deleteMany({
        where: { workflowId: id },
      });

      // 创建节点 ID 映射（前端 ID -> 数据库 ID）
      const nodeIdMap = new Map<string, string>();

      // 创建新的 nodes
      const createdNodes = await Promise.all(
        nodes.map((node: any) =>
          tx.workflowNode.create({
            data: {
              workflowId: id,
              type: node.type,
              roleId: node.data?.roleId || node.roleId || null,  // 保存角色关联
              positionX: node.position.x,
              positionY: node.position.y,
              data: JSON.stringify(node.data),
              vulnerabilityCategories: Array.isArray(node.data.vulnerabilityCategories)
                ? JSON.stringify(node.data.vulnerabilityCategories)
                : null,
              skills: typeof node.data.skills === 'string'
                ? node.data.skills
                : (node.data.skills ? JSON.stringify(node.data.skills) : null),
            },
          }).then((createdNode) => {
            // 保存 ID 映射
            nodeIdMap.set(node.id, createdNode.id);
            return createdNode;
          })
        )
      );

      // 创建新的 edges（使用映射后的节点 ID）
      const createdEdges = await Promise.all(
        edges.map((edge: any) => {
          const sourceId = nodeIdMap.get(edge.source);
          const targetId = nodeIdMap.get(edge.target);

          if (!sourceId || !targetId) {
            throw new Error(`Invalid edge: source or target node not found (${edge.source} -> ${edge.target})`);
          }

          return tx.workflowEdge.create({
            data: {
              workflowId: id,
              sourceId,
              targetId,
              sourceHandle: edge.sourceHandle || null,
              targetHandle: edge.targetHandle || null,
              label: edge.label || null,
              data: edge.data ? JSON.stringify(edge.data) : null,
            },
          });
        })
      );

      // 更新工作流版本和缩略图
      const updatedWorkflow = await tx.workflow.update({
        where: { id },
        data: {
          version: existingWorkflow.version + 1,
          ...(thumbnail && { thumbnail }), // 如果有缩略图则更新
        },
        include: {
          WorkflowNode: true,
          WorkflowEdge: true,
        },
      });

      return { workflow: updatedWorkflow, nodes: createdNodes, edges: createdEdges };
    });

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        userId: payload.userId,
        action: 'workflow_data_update',
        resource: id,
        details: JSON.stringify({
          nodeCount: nodes.length,
          edgeCount: edges.length,
          version: result.workflow.version,
        }),
      },
    });

    return NextResponse.json({
      message: '工作流数据保存成功',
      workflow: result.workflow,
    });
  } catch (error) {
    console.error('Save workflow data error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
