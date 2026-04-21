import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/projects/:id/tool-permissions/:permId - 获取单个工具权限规则
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; permId: string }> }
) {
  try {
    const { id: projectId, permId } = await params;
    // 使用统一认证中间件
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    // 验证项目是否存在且属于用户
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId: payload.userId,
      },
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // 获取工具权限规则
    const permission = await prisma.toolPermission.findFirst({
      where: {
        id: permId,
        projectId,
      },
    });

    if (!permission) {
      return NextResponse.json({ error: 'Tool permission not found' }, { status: 404 });
    }

    return NextResponse.json({ permission });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '获取工具权限错误:', { details: { error: String(error) } });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT /api/projects/:id/tool-permissions/:permId - 更新工具权限规则
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; permId: string }> }
) {
  try {
    const { id: projectId, permId } = await params;
    // 使用统一认证中间件
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    // 验证项目是否存在且属于用户
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId: payload.userId,
      },
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // 验证工具权限规则是否存在
    const existingPerm = await prisma.toolPermission.findFirst({
      where: {
        id: permId,
        projectId,
      },
    });

    if (!existingPerm) {
      return NextResponse.json({ error: 'Tool permission not found' }, { status: 404 });
    }

    const body = await request.json();
    const { toolPattern, permission, description } = body;

    // 如果修改了 toolPattern，检查是否与其他规则冲突
    if (toolPattern && toolPattern !== existingPerm.toolPattern) {
      const conflict = await prisma.toolPermission.findUnique({
        where: {
          projectId_toolPattern: {
            projectId,
            toolPattern,
          },
        },
      });

      if (conflict) {
        return NextResponse.json(
          { error: 'Tool permission with this pattern already exists' },
          { status: 400 }
        );
      }
    }

    // 验证 permission 值
    if (permission && !['allow', 'deny', 'ask'].includes(permission)) {
      return NextResponse.json(
        { error: 'Permission must be "allow", "deny", or "ask"' },
        { status: 400 }
      );
    }

    // 更新工具权限规则
    const updatedPerm = await prisma.toolPermission.update({
      where: { id: permId },
      data: {
        toolPattern: toolPattern ?? existingPerm.toolPattern,
        permission: permission ?? existingPerm.permission,
        description: description !== undefined ? description : existingPerm.description,
      },
    });

    return NextResponse.json({ permission: updatedPerm });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '更新工具权限错误:', { details: { error: String(error) } });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/:id/tool-permissions/:permId - 删除工具权限规则
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; permId: string }> }
) {
  try {
    const { id: projectId, permId } = await params;
    // 使用统一认证中间件
    const auth = authenticateRequest(request);
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    // 验证项目是否存在且属于用户
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId: payload.userId,
      },
    });

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // 验证工具权限规则是否存在
    const existingPerm = await prisma.toolPermission.findFirst({
      where: {
        id: permId,
        projectId,
      },
    });

    if (!existingPerm) {
      return NextResponse.json({ error: 'Tool permission not found' }, { status: 404 });
    }

    // 删除工具权限规则
    await prisma.toolPermission.delete({
      where: { id: permId },
    });

    return NextResponse.json({ message: 'Tool permission deleted successfully' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '删除工具权限错误:', { details: { error: String(error) } });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
