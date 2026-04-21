import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { generateId } from '@/lib/id-generator';

// 获取所有权限
export async function GET(request: Request) {
  // 使用统一认证中间件
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.PERMISSION_READ });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    // 获取所有权限
    const permissions = await prisma.permission.findMany({
      include: {
        Role: true,
      },
    });

    logger.access(LOG_MODULES.PERMISSION, payload, 'all');
    return NextResponse.json({ permissions });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PERMISSION, '获取权限列表失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}

// 创建权限
export async function POST(request: Request) {
  // 使用统一认证中间件
  const auth = authenticateRequest(request, { requiredPermission: PERMISSIONS.PERMISSION_CREATE });
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    const body = await request.json();
    const { name, module, action, resource, description } = body;

    if (!name || !module || !action) {
      return NextResponse.json(
        { details: { error: '缺少必填字段' } },
        { status: 400 }
      );
    }

    // 检查权限是否已存在
    const existingPermission = await prisma.permission.findFirst({
      where: {
        module,
        action,
        resource: resource || null,
      },
    });

    if (existingPermission) {
      return NextResponse.json({ details: { error: '权限已存在' } }, { status: 400 });
    }

    // 创建权限
    const permission = await prisma.permission.create({
      data: {
        id: generateId('perm'),
        name,
        module,
        action,
        resource,
        description,
        updatedAt: new Date(),
      },
    });

    // 记录审计日志
    prisma.auditLog.create({
      data: {
        id: generateId('audit'),
        userId: payload.userId,
        action: 'permission_create',
        resource: permission.id,
        details: JSON.stringify({ name: permission.name, module, action }),
      },
    }).catch(err => logger.errorWithUser(LOG_MODULES.PERMISSION, payload, '记录审计日志失败', permission.id, { details: { error: String(err) } }));

    logger.create(LOG_MODULES.PERMISSION, payload, permission.id, { name: permission.name, module, action });
    return NextResponse.json({ permission }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.PERMISSION, '创建权限失败', { details: { error: String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}
