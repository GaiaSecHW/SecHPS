// src/app/api/vulnerabilities/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';
import { combineWhereClauses, buildDateRangeFilter, buildStatusFilter } from '@/lib/query-optimizer';
import { generateId } from '@/lib/id-generator';

// GET /api/vulnerabilities - 获取漏洞列表
// 数据隔离：基于租户上下文过滤，普通租户用户只能看到同租户项目的漏洞
export async function GET(request: Request) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.VULNERABILITY_READ });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload, tenant, withTenantFilter: applyTenantFilter } = auth as AuthSuccessResult;

  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId') || undefined;
    const taskId = searchParams.get('taskId') || undefined;
    const skillId = searchParams.get('skillId') || undefined;
    const status = searchParams.get('status')?.split(',') || undefined;
    const severity = searchParams.get('severity')?.split(',') || undefined;
    const type = searchParams.get('type') || undefined;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const search = searchParams.get('search') || undefined;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || searchParams.get('pageSize') || '20');

    const { skip, take, page: pageNum, limit: pageLimit } = getOffsetPagination({ page, limit });

    // 如果有 skillId，获取 skill 名称用于过滤
    let skillFilter: Record<string, unknown> | undefined = undefined;
    if (skillId) {
      const skill = await prisma.skill.findUnique({
        where: { id: skillId },
        select: { name: true },
      });
      if (skill) {
        skillFilter = { skill: skill.name };
      }
    }

    // 数据隔离：基于租户上下文过滤项目（替代旧的 userId/isAdmin 逻辑）
    const projectWhere: Record<string, unknown> = applyTenantFilter({});
    // 非管理员/非ICSL特权：进一步限定为用户自己的项目
    if (!tenant.isPlatformAdmin && !(tenant.isIcsTenant && payload.roles.includes('admin'))) {
      projectWhere.userId = payload.userId;
    }

    const userProjects = await prisma.project.findMany({
      where: projectWhere,
      select: { id: true },
    });

    let projectFilter: Record<string, unknown> | undefined;

    if (projectId) {
      if (!userProjects.some(p => p.id === projectId)) {
        return NextResponse.json({ error: '项目不存在或无权限访问' }, { status: 404 });
      }
      projectFilter = { projectId };
    } else {
      projectFilter = userProjects.length > 0
        ? { projectId: { in: userProjects.map(p => p.id) } }
        : { projectId: 'none' };
    }

    const dateRange = buildDateRangeFilter(startDate, endDate);

    const where = combineWhereClauses(
      projectFilter,
      taskId ? { taskId } : undefined,
      skillFilter,
      buildStatusFilter(status),
      severity ? { severity: { in: severity } } : undefined,
      type ? { type } : undefined,
      dateRange ? { createdAt: dateRange } : undefined,
      search ? {
        OR: [
          { title: { contains: search } },
          { description: { contains: search } },
          { type: { contains: search } },
        ],
      } : undefined
    );

    const [vulnerabilities, total] = await Promise.all([
      prisma.vulnerability.findMany({
        where,
        select: {
          id: true,
          taskId: true,
          projectId: true,
          title: true,
          description: true,
          type: true,
          cwe: true,
          severity: true,
          location: true,
          POC: true,
          vulnerable: true,
          fixSuggestion: true,
          skill: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          Project: {
            select: { id: true, name: true },
          },
          TaskInstance: {
            select: { id: true, name: true },
          },
        },
        orderBy: { createdAt: 'desc' as const },
        skip,
        take,
      }),
      prisma.vulnerability.count({ where }),
    ]);

    return NextResponse.json(createPaginatedResponse(vulnerabilities, total, pageNum, pageLimit));
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.VULNERABILITY, '获取漏洞列表错误', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/vulnerabilities - 创建漏洞（内部使用）
// 数据隔离：基于租户上下文验证项目归属
export async function POST(request: Request) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.VULNERABILITY_CREATE });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload, tenant, tenantAccessFilter } = auth as AuthSuccessResult;

  try {
    const body = await request.json();
    const {
      projectId,
      skillExecutionId,
      title,
      description,
      type,
      cwe,
      severity,
      location,
      POC,
      vulnerable,
      fixSuggestion,
    } = body;

    if (!projectId || !title || !description || !type || !severity) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    // 数据隔离：验证项目归属（使用租户过滤而非旧 isAdmin 逻辑）
    const project = await prisma.project.findFirst({
      where: { id: projectId, ...tenantAccessFilter },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在或无权限访问' }, { status: 404 });
    }

    const vulnerability = await prisma.vulnerability.create({
      data: {
        id: generateId('vuln'),
        projectId,
        skillExecutionId,
        title,
        description,
        type,
        cwe,
        severity,
        location,
        POC,
        vulnerable: vulnerable ?? true,
        fixSuggestion,
        status: 'new',
        updatedAt: new Date(),
      },
    });

    // 记录审计日志
    prisma.auditLog.create({
      data: {
        id: generateId('audit'),
        userId: payload.userId,
        action: 'vulnerability_create',
        resource: vulnerability.id,
        details: JSON.stringify({ title: vulnerability.title, type, severity, projectId }),
      },
    }).catch(err => logger.errorWithUser(LOG_MODULES.VULNERABILITY, payload, '记录审计日志失败', vulnerability.id, { details: { error: String(err) } }));

    logger.create(LOG_MODULES.VULNERABILITY, payload, vulnerability.id, { title: vulnerability.title, type, severity, projectId });

    return NextResponse.json({ vulnerability }, { status: 201 });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.VULNERABILITY, '创建漏洞错误', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}