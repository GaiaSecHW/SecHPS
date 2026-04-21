// src/app/api/techstack\[id]\route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * PATCH /api/techstack/[id]
 * 更新技术栈选项
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_UPDATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

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
    logger.errorNoUser(LOG_MODULES.CONFIG, '更新技术栈选项错误:', { details: { error: String(error) } });
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
    const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.CONFIG_UPDATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const payload = auth.payload;

    const { id } = await params;

    // 检查是否存在
    const existing = await prisma.techStackOption.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: '技术栈选项不存在' }, { status: 404 });
    }

    await prisma.techStackOption.delete({
      where: { id },
    });

    return NextResponse.json({ message: '删除成功' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.CONFIG, '删除技术栈选项错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
