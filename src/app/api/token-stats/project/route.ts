import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested, isAdmin } from '@/lib/api-auth';
import { hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';
import { logger, LOG_MODULES } from '@/lib/logger';

// 获取项目 Token 使用明细
export async function GET(request: Request) {
  // 使用统一认证中间件（无权限要求，只需登录）
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const { payload } = auth;

  try {
    // 检查权限 - 管理员直接允许，或检查 TOKEN_DETAIL 权限
    const userIsAdmin = isAdmin(payload);
    if (!userIsAdmin && !hasPermission(payload.permissions, PERMISSIONS.TOKEN_DETAIL)) {
      return NextResponse.json({ details: { error: '禁止访问' } }, { status: 403 });
    }

    // 获取查询参数
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const evaluationId = searchParams.get('evaluationId');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!projectId) {
      return NextResponse.json({ details: { error: '缺少项目ID' } }, { status: 400 });
    }

    // 检查用户是否有权限访问该项目（管理员可以访问任何项目）
    const project = await prisma.project.findFirst({
      where: userIsAdmin
        ? { id: projectId }
        : {
            id: projectId,
            userId: payload.userId,
          },
    });

    if (!project) {
      return NextResponse.json({ details: { error: '项目不存在或无权访问' } }, { status: 404 });
    }

    const { skip, take, page: pageNum, limit: pageLimit } = getOffsetPagination({ page, limit });

    // 构建查询条件
    const whereClause: any = { projectId };
    
    if (evaluationId) {
      whereClause.evaluationId = evaluationId;
    }
    
    if (startDate) {
      whereClause.createdAt = { ...whereClause.createdAt, gte: new Date(startDate) };
    }
    
    if (endDate) {
      whereClause.createdAt = { ...whereClause.createdAt, lte: new Date(endDate) };
    }

    // 获取 token 使用记录
    const [total, tokenUsages] = await Promise.all([
      prisma.tokenUsage.count({ where: whereClause }),
      prisma.tokenUsage.findMany({
        where: whereClause,
        select: {
          id: true,
          evaluationId: true,
          apiProvider: true,
          modelName: true,
          callType: true,
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
          cachedTokens: true,
          requestPreview: true,
          responsePreview: true,
          requestStartedAt: true,
          requestCompletedAt: true,
          durationMs: true,
          estimatedCost: true,
          status: true,
          errorMessage: true,
          createdAt: true,
          evaluation: {
            select: {
              id: true,
              title: true,
              status: true,
              startedAt: true,
              completedAt: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take,
      }),
    ]);

    // 获取项目汇总统计
    const projectSummary = await prisma.evaluationSession.aggregate({
      where: { projectId },
      _sum: {
        totalInputTokens: true,
        totalOutputTokens: true,
        totalTokens: true,
        estimatedCost: true,
      },
      _count: {
        id: true,
      },
    });

    // 获取评估列表（带 token 统计）
    const evaluations = await prisma.evaluationSession.findMany({
      where: { projectId },
      select: {
        id: true,
        title: true,
        status: true,
        startedAt: true,
        completedAt: true,
        modelName: true,
        providerType: true,
        totalInputTokens: true,
        totalOutputTokens: true,
        totalTokens: true,
        estimatedCost: true,
        messageCount: true,
      },
      orderBy: {
        startedAt: 'desc',
      },
      take: 50,
    });

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
      },
      summary: {
        totalInputTokens: projectSummary._sum.totalInputTokens || 0,
        totalOutputTokens: projectSummary._sum.totalOutputTokens || 0,
        totalTokens: projectSummary._sum.totalTokens || 0,
        estimatedCost: projectSummary._sum.estimatedCost || 0,
        evaluationCount: projectSummary._count.id || 0,
      },
      evaluations: evaluations.map(e => ({
        ...e,
        duration: e.completedAt && e.startedAt 
          ? Math.round((new Date(e.completedAt).getTime() - new Date(e.startedAt).getTime()) / 1000)
          : null,
      })),
      tokenUsages: createPaginatedResponse(tokenUsages, total, pageNum, pageLimit),
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.TOKEN, '获取项目 Token 统计失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json({ details: { error: '服务器内部错误' } }, { status: 500 });
  }
}