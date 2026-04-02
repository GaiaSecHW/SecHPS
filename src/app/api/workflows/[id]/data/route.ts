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

    // 查询工作流及其节点和边
    const workflow = await prisma.workflow.findFirst({
      where: {
        id,
        OR: [
          { userId: payload.userId },
          { shares: { some: { sharedWith: payload.userId } } },
        ],
      },
      include: {
        nodes: true,
        edges: true,
      },
    });

    if (!workflow) {
      return NextResponse.json({ error: '工作流不存在或无权访问' }, { status: 404 });
    }

    // 转换数据格式为前端期望的格式
    const nodes = workflow.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: {
        x: node.positionX,
        y: node.positionY,
      },
      data: node.data ? JSON.parse(node.data) : {},
    }));

    const edges = workflow.edges.map((edge) => ({
      id: edge.id,
      source: edge.sourceId,
      target: edge.targetId,
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

    // 检查工作流是否存在且属于当前用户
    const existingWorkflow = await prisma.workflow.findFirst({
      where: {
        id,
        userId: payload.userId,
      },
    });

    if (!existingWorkflow) {
      return NextResponse.json({ error: '工作流不存在或无权访问' }, { status: 404 });
    }

    // 解析请求体
    const body = await request.json();
    const { nodes, edges } = body;

    // 验证数据格式
    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      return NextResponse.json(
        { error: 'nodes 和 edges 必须是数组' },
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

      // 创建新的 nodes
      const createdNodes = await Promise.all(
        nodes.map((node: any) =>
          tx.workflowNode.create({
            data: {
              workflowId: id,
              type: node.type,
              positionX: node.position.x,
              positionY: node.position.y,
              data: JSON.stringify(node.data),
            },
          })
        )
      );

      // 创建新的 edges
      const createdEdges = await Promise.all(
        edges.map((edge: any) =>
          tx.workflowEdge.create({
            data: {
              workflowId: id,
              sourceId: edge.source,
              targetId: edge.target,
              label: edge.label || null,
              data: edge.data ? JSON.stringify(edge.data) : null,
            },
          })
        )
      );

      // 更新工作流版本
      const updatedWorkflow = await tx.workflow.update({
        where: { id },
        data: {
          version: existingWorkflow.version + 1,
        },
        include: {
          nodes: true,
          edges: true,
        },
      });

      return { workflow: updatedWorkflow, nodes: createdNodes, edges: createdEdges };
    });

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
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
