import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// 格式化工作流数据
function formatWorkflow(workflow: any) {
  return {
    ...workflow,
    techStack: workflow.techStack ? JSON.parse(workflow.techStack) : null,
    userName: workflow.user?.name || workflow.user?.username || null,
    userUsername: workflow.user?.username || null,
  };
}

// 获取单个工作流详情
// 普通用户：可以查看自己的 + 公开的 + 被分享的
// 管理员：可以查看所有
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

    // 检查是否是管理员
    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');

    // 构建查询条件
    let where: any = { id };
    
    if (!isAdmin) {
      // 普通用户：可以查看自己的 + 公开的 + 被分享的
      where.OR = [
        { userId: payload.userId },
        { isPublic: true },
        {
          shares: {
            some: {
              sharedWith: payload.userId,
            },
          },
        },
      ];
    }

    // 获取工作流详情
    const workflow = await prisma.workflow.findFirst({
      where,
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
            username: true,
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

    return NextResponse.json({ workflow: formatWorkflow(workflow) });
  } catch (error) {
    console.error('Get workflow error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 更新工作流基本信息
// 只能更新自己创建的，管理员可以更新所有
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

    // 检查是否是管理员
    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');

    // 检查工作流是否存在
    const existingWorkflow = await prisma.workflow.findUnique({
      where: { id },
    });

    if (!existingWorkflow) {
      return NextResponse.json({ error: '工作流不存在' }, { status: 404 });
    }

    // 检查权限：只能更新自己的，管理员可以更新所有
    if (!isAdmin && existingWorkflow.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问：只能更新自己创建的工作流' }, { status: 403 });
    }

    // 解析请求体
    const body = await request.json();
    const { name, description, status, thumbnail, techStack, isActive, isPublic } = body;

    // 构建更新数据
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (status !== undefined) updateData.status = status;
    if (thumbnail !== undefined) updateData.thumbnail = thumbnail;
    if (techStack !== undefined) {
      // 处理技术栈数据
      if (techStack && Array.isArray(techStack) && techStack.length > 0) {
        updateData.techStack = JSON.stringify(techStack);
      } else {
        updateData.techStack = null;
      }
    }
    if (isActive !== undefined) updateData.isActive = isActive;
    if (isPublic !== undefined) updateData.isPublic = isPublic;

    // 更新工作流
    const workflow = await prisma.workflow.update({
      where: { id },
      data: updateData,
      include: {
        nodes: true,
        edges: true,
        user: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
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
      workflow: formatWorkflow(workflow),
    });
  } catch (error) {
    console.error('Update workflow error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 删除工作流
// 只能删除自己的，管理员可以删除所有
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

    // 检查是否是管理员
    const isAdmin = Array.isArray(payload.roles) && payload.roles.includes('admin');

    // 检查工作流是否存在
    const existingWorkflow = await prisma.workflow.findUnique({
      where: { id },
    });

    if (!existingWorkflow) {
      return NextResponse.json({ error: '工作流不存在' }, { status: 404 });
    }

    // 检查权限：只能删除自己的，管理员可以删除所有
    if (!isAdmin && existingWorkflow.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问：只能删除自己创建的工作流' }, { status: 403 });
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
