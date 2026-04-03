// src/app/api/workflows/[id]/execute/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { WorkflowExecutionService } from '@/lib/workflow-execution-service';

// 执行工作流
export async function POST(
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
    if (!hasPermission(payload.permissions, PERMISSIONS.WORKFLOW_EXECUTE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id: workflowId } = await params;

    // 查询工作流
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId },
      include: {
        nodes: true,
        edges: true,
      },
    });

    if (!workflow) {
      return NextResponse.json({ error: '工作流不存在' }, { status: 404 });
    }

    // 检查工作流是否属于当前用户或有执行权限
    if (workflow.userId !== payload.userId) {
      const share = await prisma.workflowShare.findFirst({
        where: {
          workflowId,
          sharedWith: payload.userId,
          permission: { in: ['execute', 'edit'] },
        },
      });

      if (!share) {
        return NextResponse.json({ error: '无权执行此工作流' }, { status: 403 });
      }
    }

    // 检查工作流状态
    if (workflow.status !== 'published') {
      return NextResponse.json(
        { error: '只能执行已发布的工作流' },
        { status: 400 }
      );
    }

    // 检查工作流是否有效
    const startNode = workflow.nodes.find((node) => node.type === 'start');
    const endNode = workflow.nodes.find((node) => node.type === 'end');

    if (!startNode || !endNode) {
      return NextResponse.json(
        { error: '工作流缺少开始或结束节点' },
        { status: 400 }
      );
    }

    // 解析节点和边数据
    const nodes = workflow.nodes.map((node) => ({
      id: node.id,
      type: node.type as 'start' | 'end' | 'task' | 'subtask',
      position: node.position as { x: number; y: number },
      data: node.data as { label: string; config?: Record<string, unknown> },
    }));

    const edges = workflow.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: edge.label,
      data: edge.data as Record<string, unknown> | undefined,
    }));

    // 创建执行记录
    const execution = await prisma.workflowExecution.create({
      data: {
        workflowId,
        userId: payload.userId,
        status: 'pending',
      },
    });

    // 为每个节点创建执行步骤记录
    await Promise.all(
      workflow.nodes.map((node) =>
        prisma.workflowExecutionStep.create({
          data: {
            executionId: execution.id,
            nodeId: node.id,
            status: 'pending',
          },
        })
      )
    );

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'workflow_execute',
        resource: execution.id,
        details: JSON.stringify({
          workflowId,
          workflowName: workflow.name,
          nodeCount: workflow.nodes.length,
        }),
      },
    });

    // 异步执行工作流
    const executionService = new WorkflowExecutionService({
      executionId: execution.id,
      workflowId,
      userId: payload.userId,
    });

    // 在后台执行（不阻塞响应）
    executionService.execute(nodes, edges).catch((error) => {
      console.error('[Workflow Execution Error]:', error);
    });

    return NextResponse.json(
      {
        message: '工作流执行已启动',
        execution: {
          id: execution.id,
          workflowId: execution.workflowId,
          status: execution.status,
          startedAt: execution.startedAt,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Execute workflow error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
