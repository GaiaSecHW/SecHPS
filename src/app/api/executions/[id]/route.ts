import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// 获取执行详情
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

    const { id: executionId } = await params;

    // 查询执行记录
    const execution = await prisma.workflowExecution.findUnique({
      where: { id: executionId },
      include: {
        workflow: {
          include: {
            nodes: true,
            edges: true,
          },
        },
        steps: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!execution) {
      return NextResponse.json({ error: '执行记录不存在' }, { status: 404 });
    }

    // 检查执行记录是否属于当前用户
    if (execution.userId !== payload.userId) {
      return NextResponse.json({ error: '无权访问此执行记录' }, { status: 403 });
    }

    return NextResponse.json({ execution });
  } catch (error) {
    console.error('Get execution error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 删除执行记录
export async function DELETE(
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
    if (!hasPermission(payload.permissions, PERMISSIONS.WORKFLOW_DELETE)) {
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
      return NextResponse.json({ error: '无权删除此执行记录' }, { status: 403 });
    }

    // 删除执行记录（级联删除所有步骤）
    await prisma.workflowExecution.delete({
      where: { id: executionId },
    });

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'execution_delete',
        resource: executionId,
        details: JSON.stringify({
          workflowId: execution.workflowId,
          status: execution.status,
        }),
      },
    });

    return NextResponse.json({ message: '执行记录删除成功' });
  } catch (error) {
    console.error('Delete execution error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
