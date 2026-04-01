import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

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
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status');

    // 构建查询条件
    const where: any = {
      userId: payload.userId,
    };

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
      ];
    }

    if (status) {
      where.status = status;
    }

    // 获取总数
    const total = await prisma.workflow.count({ where });

    // 获取工作流列表
    const workflows = await prisma.workflow.findMany({
      where,
      include: {
        nodes: true,
        edges: true,
        _count: {
          select: {
            executions: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return NextResponse.json({
      workflows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
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
