import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/projects/:id/system-prompts - 获取项目的系统提示词列表
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

    // 获取项目的系统提示词
    const prompts = await prisma.systemPrompt.findMany({
      where: { projectId },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    return NextResponse.json({ prompts });
  } catch (error) {
    console.error('Get system prompts error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/projects/:id/system-prompts - 创建系统提示词
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
    const { name, type, content, isEnabled, priority } = body;

    if (!name || !type || !content) {
      return NextResponse.json(
        { error: 'Name, type, and content are required' },
        { status: 400 }
      );
    }

    if (!['preset', 'custom'].includes(type)) {
      return NextResponse.json(
        { error: 'Type must be "preset" or "custom"' },
        { status: 400 }
      );
    }

    // 创建系统提示词
    const systemPrompt = await prisma.systemPrompt.create({
      data: {
        projectId,
        name,
        type,
        content,
        isEnabled: isEnabled ?? true,
        priority: priority ?? 0,
      },
    });

    return NextResponse.json({ prompt: systemPrompt }, { status: 201 });
  } catch (error) {
    console.error('Create system prompt error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
