import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// 获取当前用户的执行记录列表
export async function GET(request: Request) {
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

    // 获取查询参数
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const status = searchParams.get('status');
    const workflowId = searchParams.get('workflowId');

    // 构建查询条件
    const where: any = {
      userId: payload.userId,
    };

    if (status) {
      where.status = status;
    }

    if (workflowId) {
      where.workflowId = workflowId;
    }

    // 获取总数
    const total = await prisma.workflowExecution.count({ where });

    // 获取执行记录列表
    const executions = await prisma.workflowExecution.findMany({
      where,
      include: {
        workflow: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
        steps: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
      orderBy: {
        startedAt: 'desc',
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return NextResponse.json({
      executions,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error('Get executions error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
