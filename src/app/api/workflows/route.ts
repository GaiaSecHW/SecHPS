import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS } from '@/types/permissions';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';
import { buildSearchFilter, combineWhereClauses } from '@/lib/query-optimizer';
import { logger, LOG_MODULES } from '@/lib/logger';
import { authenticateRequestEnhanced, authErrorResponse, isAdmin } from '@/lib/api-auth';
import type { AuthSuccessResult } from '@/lib/api-auth';
import { buildTenantFilter, getTenantIdForCreate, getVisibility } from '@/lib/tenant-filter';
import { AuditLogger } from '@/lib/audit/logger';
import { generateId } from '@/lib/id-generator';

// 格式化工作流数据
function formatWorkflow(workflow: any) {
  return {
    id: workflow.id,
    userId: workflow.userId,
    userName: workflow.user?.name || workflow.user?.username || null,
    userUsername: workflow.user?.username || null,
    tenantId: workflow.tenantId,
    visibility: workflow.visibility,
    name: workflow.name,
    description: workflow.description,
    thumbnail: workflow.thumbnail,
    techStack: workflow.techStack ? JSON.parse(workflow.techStack) : null,
    status: workflow.status,
    version: workflow.version,
    isActive: workflow.isActive,
    isPublic: workflow.isPublic,
    workflowType: workflow.workflowType || 'dag',
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    _count: workflow._count,
  };
}

// 获取工作流列表
// 平台管理员/ICSL：可以看到所有
// 普通用户：只能看到自己创建的 + 公开的 + 同租户的
export async function GET(request: Request) {
  try {
    // 验证 Token 和权限
    const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.WORKFLOW_READ });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const { payload, tenant } = auth as AuthSuccessResult;

    // 获取查询参数
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || searchParams.get('pageSize') || '20');
    const search = searchParams.get('search') || undefined;
    const status = searchParams.get('status') || undefined;
    const forEvaluation = searchParams.get('forEvaluation') === 'true';

    // 检查是否是管理员
    const userIsAdmin = isAdmin(payload);

    const { skip, take, page: pageNum, limit: pageLimit } = getOffsetPagination({ page, limit });

    // 构建查询条件
    let baseWhere: any = {};

    if (forEvaluation) {
      // 用于评估时：用户可以看到自己的 + 公开的
      baseWhere.OR = [
        { userId: payload.userId },
        { visibility: 'public' },
      ];
    } else if (userIsAdmin || tenant.isIcsTenant) {
      // 管理员/ICSL 可以看到所有
      // 不添加用户过滤
    } else {
      // 普通用户管理页面：可以看到自己的 + 公开共享的 + 同租户的
      const tenantFilter = buildTenantFilter(tenant, {
        tenantField: 'tenantId',
        visibilityField: 'visibility',
      });
      baseWhere.OR = [
        { userId: payload.userId },
        { ...tenantFilter },
      ];
    }

    const where = combineWhereClauses(
      baseWhere,
      status ? { status } : undefined,
      buildSearchFilter(['name', 'description'], search)
    );

    // 并行获取总数和数据
    const [total, workflows] = await Promise.all([
      prisma.workflow.count({ where }),
      prisma.workflow.findMany({
        where,
        select: {
          id: true,
          userId: true,
          name: true,
          description: true,
          thumbnail: true,
          techStack: true,
          status: true,
          version: true,
          isActive: true,
          isPublic: true,
          visibility: true,
          tenantId: true,
          workflowType: true,
          createdAt: true,
          updatedAt: true,
          User: {
            select: {
              id: true,
              name: true,
              username: true,
            },
          },
          _count: {
            select: {
              WorkflowNode: true,
              WorkflowExecution: true,
            },
          },
        },
        orderBy: {
          updatedAt: 'desc',
        },
        skip,
        take,
      }),
    ]);

    // 格式化返回数据
    const formattedWorkflows = workflows.map(formatWorkflow);

    // 记录列表查询日志
    logger.list(LOG_MODULES.WORKFLOW, payload, 'workflows', { search, status, forEvaluation, isAdmin }, formattedWorkflows.length);

    return NextResponse.json(createPaginatedResponse(formattedWorkflows, total, pageNum, pageLimit));
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, `获取工作流列表错误: ${error}`);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 创建新工作流
export async function POST(request: Request) {
  try {
    // 验证 Token 和权限
    const auth = authenticateRequestEnhanced(request, { requiredPermission: PERMISSIONS.WORKFLOW_CREATE });
    if (!auth.success) {
      return authErrorResponse(auth);
    }
    const { payload, tenant } = auth as AuthSuccessResult;

    // 解析请求体
    const body = await request.json();
    const { name, description, techStack, isPublic, workflowType } = body;

    // 验证必填字段
    if (!name || !name.trim()) {
      return NextResponse.json({ error: '工作流名称不能为空' }, { status: 400 });
    }

    const trimmedName = name.trim();

    // 验证名称长度
    if (trimmedName.length < 2) {
      return NextResponse.json({ error: '工作流名称至少需要2个字符' }, { status: 400 });
    }

    if (trimmedName.length > 100) {
      return NextResponse.json({ error: '工作流名称不能超过100个字符' }, { status: 400 });
    }

    // 验证：只有 ICSL 或平台管理员可创建 public
    const visibility = getVisibility(isPublic);
    if (isPublic && !tenant.isIcsTenant && !tenant.isPlatformAdmin) {
      return NextResponse.json({ error: '只有 ICSL 租户可以创建公共资源' }, { status: 403 });
    }

    const tenantId = getTenantIdForCreate(tenant, isPublic);

    // FSM 工作流使用默认的 threat-modeling 模板
    let fsmTemplateId: string | undefined;
    let fsmTemplateData: any = null;
    if (workflowType === 'fsm') {
      const defaultTemplate = await prisma.fSMTemplate.findFirst({
        where: { name: 'threat-modeling' },
      });
      if (!defaultTemplate) {
        return NextResponse.json({ error: 'FSM 模板不存在，请先运行 db:seed' }, { status: 400 });
      }
      fsmTemplateId = defaultTemplate.id;
      fsmTemplateData = defaultTemplate;
    }

    // 处理技术栈数据
    let techStackJson: string | null = null;
    if (techStack && Array.isArray(techStack) && techStack.length > 0) {
      techStackJson = JSON.stringify(techStack);
    }

    // 创建工作流
    const workflow = await prisma.workflow.create({
      data: {
        id: generateId('wf'),
        userId: payload.userId,
        tenantId,
        visibility,
        name: trimmedName,
        description: description?.trim() || undefined,
        techStack: techStackJson,
        status: 'draft',
        version: 1,
        isPublic: isPublic || false,
        workflowType: workflowType || 'dag',
        fsmTemplateId: workflowType === 'fsm' ? fsmTemplateId : undefined,
        updatedAt: new Date(),
      },
      include: {
        WorkflowNode: true,
        WorkflowEdge: true,
      },
    });

    // 记录审计日志
    await AuditLogger.logFromRequest(request, {
      userId: payload.userId,
      action: 'workflow_create',
      resource: workflow.id,
      details: { after: { name, description, isPublic, workflowType } },
    });

    // 记录创建成功日志
    logger.create(LOG_MODULES.WORKFLOW, payload, workflow.id, { name, isPublic, workflowType });

    return NextResponse.json(
      {
        message: '工作流创建成功',
        workflow: formatWorkflow(workflow),
      },
      { status: 201 }
    );
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.WORKFLOW, `创建工作流错误: ${error}`);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
