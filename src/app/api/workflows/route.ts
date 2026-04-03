import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';
import { buildSearchFilter, combineWhereClauses } from '@/lib/query-optimizer';

// 获取当前用户的工作流列表
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
    const search = searchParams.get('search') || undefined;
    const status = searchParams.get('status') || undefined;

    const { skip, take, page: pageNum, limit: pageLimit } = getOffsetPagination({ page, limit });

    // 构建查询条件
    const where = combineWhereClauses(
      { userId: payload.userId },
      status ? { status } : undefined,
      buildSearchFilter(['name', 'description'], search)
    );

    // 并行获取总数和数据
    const [total, workflows] = await Promise.all([
      prisma.workflow.count({ where }),
      prisma.workflow.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          thumbnail: true,
          status: true,
          version: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              executions: true,
            },
          },
        },
        orderBy: {
          updatedAt: 'desc',
        },
        skip,
        take,
      }),
    ]);

    return NextResponse.json(createPaginatedResponse(workflows, total, pageNum, pageLimit));
  } catch (error) {
    console.error('Get workflows error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 创建新工作流
export async function POST(request: Request) {
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
    if (!hasPermission(payload.permissions, PERMISSIONS.WORKFLOW_CREATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 解析请求体
    const body = await request.json();
    const { name, description } = body;

    // 验证必填字段
    if (!name) {
      return NextResponse.json({ error: '工作流名称不能为空' }, { status: 400 });
    }

    // 创建工作流
    const workflow = await prisma.workflow.create({
      data: {
        userId: payload.userId,
        name,
        description: description || undefined,
        status: 'draft',
        version: 1,
      },
      include: {
        nodes: true,
        edges: true,
      },
    });

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'workflow_create',
        resource: workflow.id,
        details: JSON.stringify({
          name,
          description,
        }),
      },
    });

    return NextResponse.json(
      {
        message: '工作流创建成功',
        workflow,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Create workflow error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
