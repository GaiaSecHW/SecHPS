import { NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { generateId } from '@/lib/id-generator';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/projects/:id/tool-permissions - 获取项目的工具权限规则
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
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

    // 获取项目的工具权限规则
    const permissions = await prisma.toolPermission.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ permissions });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '获取工具权限列表错误:', { details: { error: String(error) } });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/projects/:id/tool-permissions - 创建工具权限规则
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
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

    const body = await request.json();
    const { toolPattern, permission, description } = body;

    if (!toolPattern || !permission) {
      return NextResponse.json(
        { error: 'Tool pattern and permission are required' },
        { status: 400 }
      );
    }

    if (!['allow', 'deny', 'ask'].includes(permission)) {
      return NextResponse.json(
        { error: 'Permission must be "allow", "deny", or "ask"' },
        { status: 400 }
      );
    }

    // 检查是否已存在相同的规则
    const existing = await prisma.toolPermission.findUnique({
      where: {
        projectId_toolPattern: {
          projectId,
          toolPattern,
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: 'Tool permission with this pattern already exists' },
        { status: 400 }
      );
    }

    // 创建工具权限规则
    const toolPermission = await prisma.toolPermission.create({
      data: {
        id: generateId('toolperm'),
        projectId,
        toolPattern,
        permission,
        description: description || null,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ permission: toolPermission }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '创建工具权限错误:', { details: { error: String(error) } });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
