// src/app/api/vulnerabilities/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequestEnhanced, authErrorResponse } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';
import { buildDateRangeFilter, buildStatusFilter } from '@/lib/query-optimizer';
import { generateId } from '@/lib/id-generator';

// GET /api/vulnerabilities - 获取漏洞列表
// 数据隔离：基于租户上下文过滤，普通租户用户只能看到同租户项目的漏洞
export async function GET(request: Request) {
  const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.VULNERABILITY_READ });
  if (!auth.success) {
    return authErrorResponse(auth);
  }
  const { payload, tenant } = auth as AuthSuccessResult;

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

    const isPrivileged = tenant.isPlatformAdmin || (tenant.isIcsTenant && payload.roles.includes('admin'));

    const taskInstanceFilter: Record<string, unknown> = {};
    if (!isPrivileged) {
      // Security: 非特权用户只能看自己或同租户的 TaskInstance 产生的漏洞
      taskInstanceFilter.OR = [
        { userId: payload.userId },
        { tenantId: tenant.tenantId },
      ];
    }

    const dateRange = buildDateRangeFilter(startDate, endDate);

    const whereParts: Record<string, unknown>[] = [];

    if (projectId) whereParts.push({ projectId });

    if (!isPrivileged && !projectId) {
      const accessibleTasks = await prisma.taskInstance.findMany({
        where: taskInstanceFilter,
        select: { id: true },
      });
      whereParts.push(accessibleTasks.length > 0
        ? { taskId: { in: accessibleTasks.map(t => t.id) } }
        : { taskId: null, projectId: null }
      );
    }

    if (taskId) whereParts.push({ taskId });
    if (skillFilter) whereParts.push(skillFilter);
    if (buildStatusFilter(status)) whereParts.push(buildStatusFilter(status)!);
    if (severity) whereParts.push({ severity: { in: severity } });
    if (type) whereParts.push({ type });
    if (dateRange) whereParts.push({ createdAt: dateRange });
    if (search) whereParts.push({
      OR: [
        { title: { contains: search } },
        { description: { contains: search } },
        { type: { contains: search } },
      ],
    });
    const where = whereParts.length > 0
      ? whereParts.length === 1 ? whereParts[0] : { AND: whereParts }
      : {};

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