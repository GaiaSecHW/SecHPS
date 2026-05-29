import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

// GET /api/vulnerabilities/:id - 获取单个漏洞详情
// 数据隔离：通过项目归属验证租户访问权限
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.VULNERABILITY_READ });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload, tenant } = auth as AuthSuccessResult;

  try {
    const { id } = await params;

    const vulnerability = await prisma.vulnerability.findUnique({
      where: { id },
      include: {
        Project: {
          select: { id: true, name: true, tenantId: true, userId: true, isPublic: true },
        },
        TaskInstance: {
          select: { id: true, name: true },
        },
      },
    });

    if (!vulnerability) {
      return NextResponse.json({ error: 'Vulnerability not found' }, { status: 404 });
    }

    // 验证项目访问权限（基于租户上下文）
    const project = vulnerability.Project;
    const isPrivileged = tenant.isPlatformAdmin || (tenant.isIcsTenant && payload.roles.includes('admin'));

    if (!isPrivileged) {
      if (!project) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const hasProjectAccess = project.userId === payload.userId || project.isPublic || project.tenantId === tenant.tenantId;
      if (!hasProjectAccess) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // 脱离内部嵌套字段
    const result = {
      ...vulnerability,
      Project: project ? { id: project.id, name: project.name } : null,
      TaskInstance: vulnerability.TaskInstance,
    };

    return NextResponse.json({ vulnerability: result });
  } catch (error) {
    logger.error(LOG_MODULES.VULNERABILITY, 'Error', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ error: 'Failed to fetch vulnerability' }, { status: 500 });
  }
}

// PATCH /api/vulnerabilities/:id - 更新漏洞
// 数据隔离：基于租户上下文验证项目归属
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.VULNERABILITY_UPDATE });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload, tenant } = auth as AuthSuccessResult;

  try {
    const { id } = await params;
    const body = await request.json();

    // 查找漏洞并验证项目归属
    const vulnerability = await prisma.vulnerability.findUnique({
      where: { id },
      include: {
        Project: { select: { id: true, userId: true, tenantId: true, isPublic: true } },
      },
    });

    if (!vulnerability) {
      return NextResponse.json({ error: '漏洞不存在' }, { status: 404 });
    }

    const isPrivileged = tenant.isPlatformAdmin || (tenant.isIcsTenant && payload.roles.includes('admin'));

    if (!isPrivileged) {
      if (!vulnerability.Project) {
        return NextResponse.json({ error: '禁止访问' }, { status: 403 });
      }
      const hasProjectAccess = vulnerability.Project.userId === payload.userId || vulnerability.Project.isPublic || vulnerability.Project.tenantId === tenant.tenantId;
      if (!hasProjectAccess) {
        return NextResponse.json({ error: '禁止访问' }, { status: 403 });
      }
    }

    const updated = await prisma.vulnerability.update({
      where: { id },
      data: {
        ...body,
        updatedAt: new Date(),
      },
    });

    logger.update(LOG_MODULES.VULNERABILITY, payload, id, { action: 'update', fields: Object.keys(body) });

    return NextResponse.json({ vulnerability: updated });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.VULNERABILITY, '更新漏洞错误', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/vulnerabilities/:id - 删除漏洞
// 数据隔离：只有平台管理员或项目所有者可以删除
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.VULNERABILITY_DELETE });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload, tenant } = auth as AuthSuccessResult;

  try {
    const { id } = await params;

    const vulnerability = await prisma.vulnerability.findUnique({
      where: { id },
      include: {
        Project: { select: { id: true, userId: true, tenantId: true, isPublic: true } },
      },
    });

    if (!vulnerability) {
      return NextResponse.json({ error: '漏洞不存在' }, { status: 404 });
    }

    const isPrivileged = tenant.isPlatformAdmin || (tenant.isIcsTenant && payload.roles.includes('admin'));

    if (!isPrivileged) {
      if (!vulnerability.Project || vulnerability.Project.userId !== payload.userId) {
        return NextResponse.json({ error: '禁止访问' }, { status: 403 });
      }
    }

    await prisma.vulnerability.delete({ where: { id } });

    logger.delete(LOG_MODULES.VULNERABILITY, payload, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.VULNERABILITY, '删除漏洞错误', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}