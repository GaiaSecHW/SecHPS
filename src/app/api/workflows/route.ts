import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';
import { buildSearchFilter, combineWhereClauses } from '@/lib/query-optimizer';
import { logger, LOG_MODULES } from '@/lib/logger';

// 格式化工作流数据
function formatWorkflow(workflow: any) {
  return {
    id: workflow.id,
    userId: workflow.userId,
    userName: workflow.user?.name || workflow.user?.username || null,
    userUsername: workflow.user?.username || null,
    name: workflow.name,
    description: workflow.description,
    thumbnail: workflow.thumbnail,
    techStack: workflow.techStack ? JSON.parse(workflow.techStack) : null,
    status: workflow.status,
    version: workflow.version,
    isActive: workflow.isActive,
    isPublic: workflow.isPublic,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    _count: workflow._count,
  };
}

// 获取工作流列表
// 普通用户：只能看到自己创建的 + 公开的
// 管理员：可以看到所有工作流 + 创建者信息
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
    const forEvaluation = searchParams.get('forEvaluation') === 'true';

    // 检查是否是管理员
    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');

    const { skip, take, page: pageNum, limit: pageLimit } = getOffsetPagination({ page, limit });

    // 构建查询条件
    let baseWhere: any = {};
    
    if (forEvaluation) {
      // 用于评估时：用户可以看到自己的 + 公开的
      baseWhere.OR = [
        { userId: payload.userId },
        { isPublic: true },
      ];
    } else if (isAdmin) {
      // 管理员可以看到所有
      // 不添加用户过滤
    } else {
      // 普通用户管理页面：只看到自己创建的
      baseWhere.userId = payload.userId;
    }

    const where = combineWhereClauses(
      baseWhere,
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
          userId: true,
          name: true,
          description: true,
          thumbnail: true,
          techStack: true,
          status: true,
          version: true,
          isActive: true,
          isPublic: true,
          createdAt: true,
          updatedAt: true,
          user: isAdmin ? {
            select: {
              id: true,
              name: true,
              username: true,
            },
          } : false,
          _count: {
            select: {
              nodes: true,
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

    // 格式化返回数据
    const formattedWorkflows = workflows.map(formatWorkflow);

    return NextResponse.json(createPaginatedResponse(formattedWorkflows, total, pageNum, pageLimit));
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, `获取工作流列表错误: ${error}`);
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
    const { name, description, techStack, isPublic } = body;

    // 验证必填字段
    if (!name || !name.trim()) {
      return NextResponse.json({ error: '工作流名称不能为空' }, { status: 400 });
    }

    const trimmedName = name.trim();

    // 验证名称长度
    if (trimmedName.length < 2) {
      return NextResponse.json({ error: '工作流名称至少需要2个字符' }, { status: 400 });
    }

    if (trimmedName.length > 100) {
      return NextResponse.json({ error: '工作流名称不能超过100个字符' }, { status: 400 });
    }

    // 处理技术栈数据
    let techStackJson: string | null = null;
    if (techStack && Array.isArray(techStack) && techStack.length > 0) {
      techStackJson = JSON.stringify(techStack);
    }

    // 创建工作流
    const workflow = await prisma.workflow.create({
      data: {
        userId: payload.userId,
        name: trimmedName,
        description: description?.trim() || undefined,
        techStack: techStackJson,
        status: 'draft',
        version: 1,
        isPublic: isPublic || false,
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
          isPublic,
        }),
      },
    });

    // 记录创建成功日志
    logger.create(LOG_MODULES.WORKFLOW, payload, workflow.id, { name, isPublic });

    return NextResponse.json(
      {
        message: '工作流创建成功',
        workflow: formatWorkflow(workflow),
      },
      { status: 201 }
    );
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, `创建工作流错误: ${error}`);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
