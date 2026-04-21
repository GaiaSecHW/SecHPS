import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse, isAdmin } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { generateId } from '@/lib/id-generator';
import { logger, LOG_MODULES } from '@/lib/logger';

// 获取工作流的分享列表
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token 和权限
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.WORKFLOW_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 检查工作流是否存在且用户有访问权限
    const workflow = await prisma.workflow.findFirst({
      where: {
        id,
        ...(userIsAdmin ? {} : {
          OR: [
            { userId: payload.userId },
            { isPublic: true },
            { WorkflowShare: { some: { sharedWith: payload.userId } } },
          ],
        }),
      },
    });

    if (!workflow) {
      return NextResponse.json({ error: '工作流不存在或无权访问' }, { status: 404 });
    }

    // 获取分享列表
    const shares = await prisma.workflowShare.findMany({
      where: {
        workflowId: id,
      },
      include: {
        User_WorkflowShare_sharedByToUser: {
          select: {
            id: true,
            username: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
        User_WorkflowShare_sharedWithToUser: {
          select: {
            id: true,
            username: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({ shares });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, '获取工作流分享列表错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 分享工作流给其他用户
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 验证 Token 和权限
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.WORKFLOW_SHARE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    // 检查工作流是否存在且属于当前用户（管理员可分享所有）
    const workflow = await prisma.workflow.findFirst({
      where: {
        id,
        ...(userIsAdmin ? {} : { userId: payload.userId }),
      },
    });

    if (!workflow) {
      return NextResponse.json({ error: '工作流不存在或无权访问' }, { status: 404 });
    }

    // 解析请求体
    const body = await request.json();
    const { sharedWith, permission, expiresAt } = body;

    // 验证必填字段
    if (!sharedWith) {
      return NextResponse.json({ error: '缺少必填字段：sharedWith' }, { status: 400 });
    }

    // 验证权限级别
    const validPermissions = ['read', 'execute', 'edit'];
    if (permission && !validPermissions.includes(permission)) {
      return NextResponse.json(
        { error: '无效的权限级别，必须是 read、execute 或 edit' },
        { status: 400 }
      );
    }

    // 不能分享给自己
    if (sharedWith === payload.userId) {
      return NextResponse.json({ error: '不能分享给自己' }, { status: 400 });
    }

    // 验证被分享用户是否存在
    const targetUser = await prisma.user.findUnique({
      where: { id: sharedWith },
    });

    if (!targetUser) {
      return NextResponse.json({ error: '被分享用户不存在' }, { status: 404 });
    }

    // 检查是否已经分享给该用户
    const existingShare = await prisma.workflowShare.findUnique({
      where: {
        workflowId_sharedWith: {
          workflowId: id,
          sharedWith,
        },
      },
    });

    if (existingShare) {
      return NextResponse.json({ error: '该工作流已分享给此用户' }, { status: 409 });
    }

    // 创建分享记录
    const share = await prisma.workflowShare.create({
      data: {
        workflowId: id,
        sharedBy: payload.userId,
        sharedWith,
        permission: permission || 'read',
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
      include: {
        User_WorkflowShare_sharedByToUser: {
          select: {
            id: true,
            username: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
        User_WorkflowShare_sharedWithToUser: {
          select: {
            id: true,
            username: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        id: generateId('audit'),
        userId: payload.userId,
        action: 'workflow_share',
        resource: id,
        details: JSON.stringify({
          sharedWith,
          permission: permission || 'read',
          expiresAt,
        }),
      },
    });

    return NextResponse.json({
      message: '工作流分享成功',
      share,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, '分享工作流错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
