import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/projects/:id/tool-permissions - 获取项目的工具权限规则
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const authHeader = request.headers.get('authorization');

    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

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
    console.error('Get tool permissions error:', error);
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
    const authHeader = request.headers.get('authorization');

    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

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
        id: `toolperm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        projectId,
        toolPattern,
        permission,
        description: description || null,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ permission: toolPermission }, { status: 201 });
  } catch (error) {
    console.error('Create tool permission error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
