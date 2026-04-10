// src/app/api/techstack\[id]\route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

/**
 * PATCH /api/techstack/[id]
 * 更新技术栈选项
 */
export async function PATCH(
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
    const { name, category, description, isActive, sortOrder } = body;

    // 检查是否存在
    const existing = await prisma.techStackOption.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: '技术栈选项不存在' }, { status: 404 });
    }

    // 如果是内置选项，只允许修改 isActive 和 sortOrder
    const updateData: any = {};
    if (existing.isBuiltin) {
      if (isActive !== undefined) updateData.isActive = isActive;
      if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    } else {
      if (name !== undefined) {
        // 检查新名称是否已被使用
        const duplicate = await prisma.techStackOption.findFirst({
          where: { name, id: { not: id } },
        });
        if (duplicate) {
          return NextResponse.json({ error: '技术栈名称已存在' }, { status: 400 });
        }
        updateData.name = name;
      }
      if (category !== undefined) updateData.category = category;
      if (description !== undefined) updateData.description = description;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    }

    const option = await prisma.techStackOption.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ option });
  } catch (error) {
    console.error('Update techstack option error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * DELETE /api/techstack/[id]
 * 删除技术栈选项
 */
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

    if (!hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    const { id } = await params;

    // 检查是否存在
    const existing = await prisma.techStackOption.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: '技术栈选项不存在' }, { status: 404 });
    }

    // 内置选项不能删除
    if (existing.isBuiltin) {
      return NextResponse.json({ error: '内置技术栈选项不能删除' }, { status: 400 });
    }

    await prisma.techStackOption.delete({
      where: { id },
    });

    return NextResponse.json({ message: '删除成功' });
  } catch (error) {
    console.error('Delete techstack option error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
