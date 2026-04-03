// src/app/api/skills/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/skills/:id - 获取 Skill 详情
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id } = await params;

    const skill = await prisma.skill.findUnique({
      where: { id },
      include: {
        executions: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        evolutions: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!skill) {
      return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 });
    }

    return NextResponse.json({
      skill: {
        ...skill,
        tools: JSON.parse(skill.tools),
        parameters: JSON.parse(skill.parameters),
        executions: skill.executions.map(e => ({
          ...e,
          input: JSON.parse(e.input),
          output: e.output ? JSON.parse(e.output) : null,
        })),
        evolutions: skill.evolutions.map(ev => ({
          ...ev,
          beforeData: JSON.parse(ev.beforeData),
          afterData: JSON.parse(ev.afterData),
        })),
      },
    });
  } catch (error) {
    console.error('获取 Skill 详情错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PUT /api/skills/:id - 更新 Skill
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    const skill = await prisma.skill.findUnique({ where: { id } });
    if (!skill) {
      return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 });
    }

    // 内置 Skill 只能修改 isActive
    if (skill.isBuiltin && Object.keys(body).some(k => k !== 'isActive')) {
      return NextResponse.json(
        { error: '内置 Skill 只能修改启用状态' },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (body.displayName !== undefined) updateData.displayName = body.displayName;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.category !== undefined) updateData.category = body.category;
    if (body.cwe !== undefined) updateData.cwe = body.cwe;
    if (body.severity !== undefined) updateData.severity = body.severity;
    if (body.systemPrompt !== undefined) updateData.systemPrompt = body.systemPrompt;
    if (body.userPrompt !== undefined) updateData.userPrompt = body.userPrompt;
    if (body.tools !== undefined) updateData.tools = JSON.stringify(body.tools);
    if (body.parameters !== undefined) updateData.parameters = JSON.stringify(body.parameters);
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    const updated = await prisma.skill.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      skill: {
        ...updated,
        tools: JSON.parse(updated.tools),
        parameters: JSON.parse(updated.parameters),
      },
    });
  } catch (error) {
    console.error('更新 Skill 错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/skills/:id - 删除 Skill
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_DELETE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;

    const skill = await prisma.skill.findUnique({ where: { id } });
    if (!skill) {
      return NextResponse.json({ error: 'Skill 不存在' }, { status: 404 });
    }

    if (skill.isBuiltin) {
      return NextResponse.json(
        { error: '内置 Skill 不能删除' },
        { status: 400 }
      );
    }

    await prisma.skill.delete({ where: { id } });

    return NextResponse.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除 Skill 错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
