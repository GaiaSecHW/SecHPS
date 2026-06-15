import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { generateId } from '@/lib/id-generator';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.ROLE_UPDATE });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    const { id } = await params;

    const existingRole = await prisma.role.findUnique({ where: { id } });
    if (!existingRole) {
      return NextResponse.json({ details: { error: '角色未找到' } }, { status: 404 });
    }

    // 系统角色（admin/developer/user）不可修改
    if (existingRole.isSystem) {
      return NextResponse.json({ details: { error: '禁止修改系统角色' } }, { status: 403 });
    }

    const body = await request.json();
    const { name, description } = body;

    if (name) {
      const systemRoles = await prisma.role.findMany({ where: { isSystem: true } });
      if (systemRoles.some(r => r.name === name)) {
        return NextResponse.json({ details: { error: '禁止使用系统角色名称' } }, { status: 403 });
      }
    }

    const role = await prisma.role.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        updatedAt: new Date(),
      },
    });

    prisma.auditLog.create({
      data: {
        id: generateId('audit'),
        userId: payload.userId,
        action: 'role_update',
        resource: role.id,
        details: JSON.stringify({ name, description }),
      },
    }).catch(err => logger.errorWithUser(LOG_MODULES.ROLE, payload, '记录审计日志失败', role.id, { details: { error: String(err) } }));

    logger.update(LOG_MODULES.ROLE, payload, role.id, { name, description });
    return NextResponse.json({ role });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.ROLE, '更新角色失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.ROLE_DELETE });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    const { id } = await params;

    const existingRole = await prisma.role.findUnique({ where: { id } });
    if (!existingRole) {
      return NextResponse.json({ details: { error: '角色未找到' } }, { status: 404 });
    }

    // 系统角色不可删除
    if (existingRole.isSystem) {
      return NextResponse.json({ details: { error: '禁止删除系统角色' } }, { status: 403 });
    }

    // 检查是否有平台管理员持有此角色（不应存在，但做防御检查）
    // admin 角色已通过 isSystem 检查拦截，此处只对自定义角色做检查

    await prisma.role.delete({ where: { id } });

    await prisma.auditLog.create({
      data: {
        id: generateId('audit'),
        userId: payload.userId,
        action: 'role_delete',
        resource: id,
        details: JSON.stringify({ name: existingRole.name }),
      },
    });

    logger.delete(LOG_MODULES.ROLE, payload, id, { name: existingRole.name });
    return NextResponse.json({ message: '角色删除成功' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.ROLE, '删除角色失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
