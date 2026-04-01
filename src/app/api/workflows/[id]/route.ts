import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// 获取单个工作流详情
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

    const { id } = await params;

    // 获取工作流详情
    const workflow = await prisma.workflow.findFirst({
      where: {
        id,
        OR: [
          { userId: payload.userId }, // 自己创建的工作流
          {
            shares: {
              some: {
                sharedWith: payload.userId,
              },
            },
          }, // 被分享的工作流
        ],
      },
      include: {
        nodes: {
          orderBy: {
            createdAt: 'asc',
          },
        },
        edges: {
          orderBy: {
            createdAt: 'asc',
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
        executions: {
          orderBy: {
            startedAt: 'desc',
          },
          take: 10,
        },
      },
    });

    if (!workflow) {
      return NextResponse.json({ error: '工作流不存在' }, { status: 404 });
    }

    return NextResponse.json({ workflow });
  } catch (error) {
    console.error('Get workflow error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 更新工作流基本信息
export async function PATCH(
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
    if (!hasPermission(payload.permissions, PERMISSIONS.WORKFLOW_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;

    // 检查工作流是否存在且属于当前用户
    const existingWorkflow = await prisma.workflow.findFirst({
      where: {
        id,
        userId: payload.userId,
      },
    });

    if (!existingWorkflow) {
      return NextResponse.json({ error: '工作流不存在或无权访问' }, { status: 404 });
    }

    // 解析请求体
    const body = await request.json();
    const { name, description, status, thumbnail } = body;

    // 构建更新数据
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (status !== undefined) updateData.status = status;
    if (thumbnail !== undefined) updateData.thumbnail = thumbnail;

    // 更新工作流
    const workflow = await prisma.workflow.update({
      where: { id },
      data: updateData,
      include: {
        nodes: true,
        edges: true,
      },
    });

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'workflow_update',
        resource: workflow.id,
        details: JSON.stringify(updateData),
      },
    });

    return NextResponse.json({
      message: '工作流更新成功',
      workflow,
    });
  } catch (error) {
    console.error('Update workflow error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 删除工作流
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

    const { id } = await params;

    // 检查工作流是否存在且属于当前用户
    const existingWorkflow = await prisma.workflow.findFirst({
      where: {
        id,
        userId: payload.userId,
      },
    });

    if (!existingWorkflow) {
      return NextResponse.json({ error: '工作流不存在或无权访问' }, { status: 404 });
    }

    // 删除工作流（级联删除 nodes 和 edges）
    await prisma.workflow.delete({
      where: { id },
    });

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'workflow_delete',
        resource: id,
        details: JSON.stringify({
          name: existingWorkflow.name,
        }),
      },
    });

    return NextResponse.json({
      message: '工作流删除成功',
    });
  } catch (error) {
    console.error('Delete workflow error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
