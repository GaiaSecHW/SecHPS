// src/app/api/patterns/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// GET /api/patterns/:id - 获取模式详情
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

    const pattern = await prisma.vulnerabilityPattern.findUnique({
      where: { id },
    });

    if (!pattern) {
      return NextResponse.json({ error: '模式不存在' }, { status: 404 });
    }

    return NextResponse.json({
      pattern: {
        ...pattern,
        patterns: JSON.parse(pattern.patterns),
        languages: JSON.parse(pattern.languages),
      },
    });
  } catch (error) {
    console.error('获取模式详情错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PUT /api/patterns/:id - 更新模式
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

    const pattern = await prisma.vulnerabilityPattern.findUnique({ where: { id } });
    if (!pattern) {
      return NextResponse.json({ error: '模式不存在' }, { status: 404 });
    }

    if (pattern.isBuiltin && Object.keys(body).some(k => k !== 'isActive')) {
      return NextResponse.json(
        { error: '内置模式只能修改启用状态' },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (body.displayName !== undefined) updateData.displayName = body.displayName;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.category !== undefined) updateData.category = body.category;
    if (body.cwe !== undefined) updateData.cwe = body.cwe;
    if (body.cve !== undefined) updateData.cve = body.cve;
    if (body.patterns !== undefined) updateData.patterns = JSON.stringify(body.patterns);
    if (body.languages !== undefined) updateData.languages = JSON.stringify(body.languages);
    if (body.exampleVulnerable !== undefined) updateData.exampleVulnerable = body.exampleVulnerable;
    if (body.exampleFixed !== undefined) updateData.exampleFixed = body.exampleFixed;
    if (body.fixGuidance !== undefined) updateData.fixGuidance = body.fixGuidance;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    const updated = await prisma.vulnerabilityPattern.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      pattern: {
        ...updated,
        patterns: JSON.parse(updated.patterns),
        languages: JSON.parse(updated.languages),
      },
    });
  } catch (error) {
    console.error('更新模式错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/patterns/:id - 删除模式
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

    const pattern = await prisma.vulnerabilityPattern.findUnique({ where: { id } });
    if (!pattern) {
      return NextResponse.json({ error: '模式不存在' }, { status: 404 });
    }

    if (pattern.isBuiltin) {
      return NextResponse.json(
        { error: '内置模式不能删除' },
        { status: 400 }
      );
    }

    await prisma.vulnerabilityPattern.delete({ where: { id } });

    return NextResponse.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除模式错误:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
