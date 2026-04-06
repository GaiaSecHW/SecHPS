// src/app/api/evaluations/[id]/nodes/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';

// GET /api/evaluations/[id]/nodes - 获取评估会话的节点执行状态
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

    // 获取评估会话
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      include: {
        workflow: {
          include: {
            nodes: true,
            edges: true,
          },
        },
        nodeExecutions: {
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 如果没有关联工作流，返回空数据
    if (!evaluation.workflow) {
      return NextResponse.json({
        workflow: null,
        nodes: [],
        executions: [],
      });
    }

    // 构建节点执行状态映射
    const executionMap = new Map(
      evaluation.nodeExecutions.map(exec => [exec.workflowNodeId, exec])
    );

    // 合并节点数据和执行状态
    const nodesWithStatus = evaluation.workflow.nodes.map(node => {
      const execution = executionMap.get(node.id);
      return {
        id: node.id,
        type: node.type,
        position: { x: node.positionX, y: node.positionY },
        data: node.data ? JSON.parse(node.data) : {},
        status: execution?.status || 'pending',
        startedAt: execution?.startedAt,
        completedAt: execution?.completedAt,
        order: execution?.order || 0,
      };
    });

    // 获取边
    const edges = evaluation.workflow.edges.map(edge => ({
      id: edge.id,
      source: edge.sourceId,
      target: edge.targetId,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: edge.label,
      data: edge.data ? JSON.parse(edge.data) : undefined,
    }));

    return NextResponse.json({
      workflow: {
        id: evaluation.workflow.id,
        name: evaluation.workflow.name,
        description: evaluation.workflow.description,
      },
      nodes: nodesWithStatus,
      edges,
      executions: evaluation.nodeExecutions,
    });
  } catch (error) {
    console.error('Get evaluation nodes error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/evaluations/[id]/nodes - 更新节点执行状态
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const body = await request.json();

    const { nodeId, nodeLabel, nodeType, status, order } = body;

    if (!nodeId || !status) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 验证评估会话存在
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 更新或创建节点执行记录
    const execution = await prisma.nodeExecution.upsert({
      where: {
        evaluationSessionId_workflowNodeId: {
          evaluationSessionId: id,
          workflowNodeId: nodeId,
        },
      },
      update: {
        status,
        startedAt: status === 'running' ? new Date() : undefined,
        completedAt: status === 'completed' || status === 'failed' ? new Date() : undefined,
        nodeLabel: nodeLabel || undefined,
        nodeType: nodeType || undefined,
        order: order ?? undefined,
      },
      create: {
        evaluationSessionId: id,
        workflowNodeId: nodeId,
        nodeLabel: nodeLabel || '',
        nodeType: nodeType || 'task',
        status,
        order: order ?? 0,
        startedAt: status === 'running' ? new Date() : null,
        completedAt: status === 'completed' || status === 'failed' ? new Date() : null,
      },
    });

    return NextResponse.json({ success: true, execution });
  } catch (error) {
    console.error('Update node execution error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PUT /api/evaluations/[id]/nodes - 批量初始化节点执行记录
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const body = await request.json();

    const { nodes } = body as { nodes: Array<{ nodeId: string; nodeLabel: string; nodeType: string; order: number }> };

    if (!nodes || !Array.isArray(nodes)) {
      return NextResponse.json({ error: '缺少节点数据' }, { status: 400 });
    }

    // 验证评估会话存在
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 批量创建节点执行记录
    const executions = await prisma.$transaction(
      nodes.map((node, index) =>
        prisma.nodeExecution.create({
          data: {
            evaluationSessionId: id,
            workflowNodeId: node.nodeId,
            nodeLabel: node.nodeLabel,
            nodeType: node.nodeType,
            status: 'pending',
            order: node.order ?? index,
          },
        })
      )
    );

    return NextResponse.json({ success: true, count: executions.length });
  } catch (error) {
    console.error('Initialize node executions error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
