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
          select: { id: true, name: true, userId: true, tenantId: true },
        },
      },
    });

    if (!vulnerability) {
      return NextResponse.json({ error: 'Vulnerability not found' }, { status: 404 });
    }

    const isPrivileged = tenant.isPlatformAdmin || (tenant.isIcsTenant && payload.roles.includes('admin'));

    if (!isPrivileged) {
      // Security: 通过 TaskInstance 或 Project 验证访问权限
      const task = vulnerability.TaskInstance;
      const project = vulnerability.Project;
      const hasTaskAccess = task && (task.userId === payload.userId || task.tenantId === tenant.tenantId);
      const hasProjectAccess = project && (project.userId === payload.userId || project.isPublic || project.tenantId === tenant.tenantId);
      if (!hasTaskAccess && !hasProjectAccess) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const userIds = [vulnerability.confirmedBy, vulnerability.fixedBy, vulnerability.verifiedBy].filter(Boolean) as string[];
    const users = userIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, username: true } })
      : [];
    const userMap = new Map(users.map(u => [u.id, u.name || u.username]));

    const result = {
      ...vulnerability,
      confirmedByName: vulnerability.confirmedBy ? (userMap.get(vulnerability.confirmedBy) || vulnerability.confirmedBy) : null,
      fixedByName: vulnerability.fixedBy ? (userMap.get(vulnerability.fixedBy) || vulnerability.fixedBy) : null,
      verifiedByName: vulnerability.verifiedBy ? (userMap.get(vulnerability.verifiedBy) || vulnerability.verifiedBy) : null,
      rawReport: vulnerability.rawReport
        ? (() => {
            const urls = vulnerability.rawReport.split(';').map(p => p.trim()).filter(p => p.startsWith('http://') || p.startsWith('https://'));
            return { hasRawReport: urls.length > 0, files: urls.map(u => ({ name: u.split('/').pop()?.split('?')[0] || 'raw-report' })) };
          })()
        : { hasRawReport: false, files: [] },
      Project: vulnerability.Project ? { id: vulnerability.Project.id, name: vulnerability.Project.name } : null,
      TaskInstance: vulnerability.TaskInstance ? { id: vulnerability.TaskInstance.id, name: vulnerability.TaskInstance.name } : null,
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
        TaskInstance: { select: { id: true, userId: true, tenantId: true } },
      },
    });

    if (!vulnerability) {
      return NextResponse.json({ error: '漏洞不存在' }, { status: 404 });
    }

    const isPrivileged = tenant.isPlatformAdmin || (tenant.isIcsTenant && payload.roles.includes('admin'));

    if (!isPrivileged) {
      const task = vulnerability.TaskInstance;
      const project = vulnerability.Project;
      const hasTaskAccess = task && (task.userId === payload.userId || task.tenantId === tenant.tenantId);
      const hasProjectAccess = project && (project.userId === payload.userId || project.isPublic || project.tenantId === tenant.tenantId);
      if (!hasTaskAccess && !hasProjectAccess) {
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
        TaskInstance: { select: { id: true, userId: true, tenantId: true } },
      },
    });

    if (!vulnerability) {
      return NextResponse.json({ error: '漏洞不存在' }, { status: 404 });
    }

    const isPrivileged = tenant.isPlatformAdmin || (tenant.isIcsTenant && payload.roles.includes('admin'));

    if (!isPrivileged) {
      const task = vulnerability.TaskInstance;
      const project = vulnerability.Project;
      const hasTaskAccess = task && (task.userId === payload.userId || task.tenantId === tenant.tenantId);
      const hasProjectAccess = project && (project.userId === payload.userId || project.isPublic || project.tenantId === tenant.tenantId);
      if (!hasTaskAccess && !hasProjectAccess) {
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