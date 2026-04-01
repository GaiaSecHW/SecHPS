import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// 取消正在执行的流程
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

    const { id: executionId } = await params;

    // 查询执行记录
    const execution = await prisma.workflowExecution.findUnique({
      where: { id: executionId },
    });

    if (!execution) {
      return NextResponse.json({ error: '执行记录不存在' }, { status: 404 });
    }

    // 检查执行记录是否属于当前用户
    if (execution.userId !== payload.userId) {
      return NextResponse.json({ error: '无权取消此执行' }, { status: 403 });
    }

    // 检查执行状态
    if (execution.status === 'completed') {
      return NextResponse.json(
        { error: '执行已完成，无法取消' },
        { status: 400 }
      );
    }

    if (execution.status === 'failed') {
      return NextResponse.json(
        { error: '执行已失败，无法取消' },
        { status: 400 }
      );
    }

    if (execution.status === 'cancelled') {
      return NextResponse.json(
        { error: '执行已取消' },
        { status: 400 }
      );
    }

    // TODO: Phase 4 实现完整的工作流执行引擎
    // 当前仅更新状态，实际取消逻辑在后续阶段实现

    // 更新执行状态为已取消
    const updatedExecution = await prisma.workflowExecution.update({
      where: { id: executionId },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
      },
    });

    // 取消所有正在运行的步骤
    await prisma.workflowExecutionStep.updateMany({
      where: {
        executionId,
        status: { in: ['pending', 'running'] },
      },
      data: {
        status: 'skipped',
      },
    });

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'execution_cancel',
        resource: executionId,
        details: JSON.stringify({
          workflowId: execution.workflowId,
          previousStatus: execution.status,
        }),
      },
    });

    return NextResponse.json({
      message: '执行已取消',
      execution: updatedExecution,
    });
  } catch (error) {
    console.error('Cancel execution error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
