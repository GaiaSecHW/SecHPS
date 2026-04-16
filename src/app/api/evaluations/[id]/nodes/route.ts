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
        NodeExecution: {
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 返回节点执行状态
    const nodesWithStatus = evaluation.NodeExecution.map(exec => ({
      id: exec.workflowNodeId || exec.id,
      label: exec.nodeLabel,
      type: exec.nodeType,
      status: exec.status,
      startedAt: exec.startedAt,
      completedAt: exec.completedAt,
      order: exec.order,
    }));

    return NextResponse.json({
      nodes: nodesWithStatus,
      executions: evaluation.NodeExecution,
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

    // 查找现有节点执行记录
    const existingExecution = await prisma.nodeExecution.findFirst({
      where: {
        evaluationSessionId: id,
        nodeId: nodeId,
      },
    });

    // 更新或创建节点执行记录
    const execution = existingExecution
      ? await prisma.nodeExecution.update({
          where: { id: existingExecution.id },
          data: {
            status,
            startedAt: status === 'running' ? new Date() : undefined,
            completedAt: status === 'completed' || status === 'failed' ? new Date() : undefined,
            nodeLabel: nodeLabel || undefined,
            nodeType: nodeType || undefined,
            order: order ?? undefined,
            updatedAt: new Date(),
          },
        })
      : await prisma.nodeExecution.create({
          data: {
            id: `nodeexec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            evaluationSessionId: id,
            workflowNodeId: nodeId,
            nodeLabel: nodeLabel || '',
            nodeType: nodeType || 'task',
            status,
            order: order ?? 0,
            startedAt: status === 'running' ? new Date() : null,
            completedAt: status === 'completed' || status === 'failed' ? new Date() : null,
            updatedAt: new Date(),
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
            id: `nodeexec-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
            evaluationSessionId: id,
            workflowNodeId: node.nodeId,
            nodeLabel: node.nodeLabel,
            nodeType: node.nodeType,
            status: 'pending',
            order: node.order ?? index,
            updatedAt: new Date(),
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