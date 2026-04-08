import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/projects/:id/system-prompts/:promptId - 获取单个系统提示词
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; promptId: string }> }
) {
  try {
    const { id: projectId, promptId } = await params;
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

    // 获取系统提示词
    const prompt = await prisma.systemPrompt.findFirst({
      where: {
        id: promptId,
        projectId,
      },
    });

    if (!prompt) {
      return NextResponse.json({ error: 'System prompt not found' }, { status: 404 });
    }

    return NextResponse.json({ prompt });
  } catch (error) {
    console.error('Get system prompt error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT /api/projects/:id/system-prompts/:promptId - 更新系统提示词
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; promptId: string }> }
) {
  try {
    const { id: projectId, promptId } = await params;
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

    // 验证系统提示词是否存在
    const existingPrompt = await prisma.systemPrompt.findFirst({
      where: {
        id: promptId,
        projectId,
      },
    });

    if (!existingPrompt) {
      return NextResponse.json({ error: 'System prompt not found' }, { status: 404 });
    }

    const body = await request.json();
    const { name, type, content, isEnabled, priority } = body;

    // 验证 type 值
    if (type && !['preset', 'custom'].includes(type)) {
      return NextResponse.json(
        { error: 'Type must be "preset" or "custom"' },
        { status: 400 }
      );
    }

    // 更新系统提示词
    const updatedPrompt = await prisma.systemPrompt.update({
      where: { id: promptId },
      data: {
        name: name ?? existingPrompt.name,
        type: type ?? existingPrompt.type,
        content: content ?? existingPrompt.content,
        isEnabled: isEnabled ?? existingPrompt.isEnabled,
        priority: priority ?? existingPrompt.priority,
      },
    });

    return NextResponse.json({ prompt: updatedPrompt });
  } catch (error) {
    console.error('Update system prompt error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/:id/system-prompts/:promptId - 删除系统提示词
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; promptId: string }> }
) {
  try {
    const { id: projectId, promptId } = await params;
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

    // 验证系统提示词是否存在
    const existingPrompt = await prisma.systemPrompt.findFirst({
      where: {
        id: promptId,
        projectId,
      },
    });

    if (!existingPrompt) {
      return NextResponse.json({ error: 'System prompt not found' }, { status: 404 });
    }

    // 删除系统提示词
    await prisma.systemPrompt.delete({
      where: { id: promptId },
    });

    return NextResponse.json({ message: 'System prompt deleted successfully' });
  } catch (error) {
    console.error('Delete system prompt error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
