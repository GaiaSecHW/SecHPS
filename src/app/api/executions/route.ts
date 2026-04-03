import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';
import { combineWhereClauses, buildDateRangeFilter, buildStatusFilter } from '@/lib/query-optimizer';

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
    const limit = parseInt(searchParams.get('limit') || searchParams.get('pageSize') || '20');
    const status = searchParams.get('status')?.split(',') || undefined;
    const workflowId = searchParams.get('workflowId') || undefined;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;

    const { skip, take, page: pageNum, limit: pageLimit } = getOffsetPagination({ page, limit });

    // 构建查询条件
    const where = combineWhereClauses(
      { userId: payload.userId },
      workflowId ? { workflowId } : undefined,
      buildStatusFilter(status),
      { startedAt: buildDateRangeFilter(startDate, endDate) }
    );

    // 并行获取总数和数据
    const [total, executions] = await Promise.all([
      prisma.workflowExecution.count({ where }),
      prisma.workflowExecution.findMany({
        where,
        select: {
          id: true,
          workflowId: true,
          userId: true,
          status: true,
          startedAt: true,
          completedAt: true,
          error: true,
          createdAt: true,
          updatedAt: true,
          workflow: {
            select: {
              id: true,
              name: true,
              status: true,
            },
          },
          steps: {
            select: {
              id: true,
              nodeId: true,
              status: true,
              startedAt: true,
              completedAt: true,
              error: true,
            },
            orderBy: {
              createdAt: 'asc' as const,
            },
          },
        },
        orderBy: {
          startedAt: 'desc' as const,
        },
        skip,
        take,
      }),
    ]);

    return NextResponse.json(createPaginatedResponse(executions, total, pageNum, pageLimit));
  } catch (error) {
    console.error('Get executions error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
