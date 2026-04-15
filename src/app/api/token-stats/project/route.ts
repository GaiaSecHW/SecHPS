import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOffsetPagination, createPaginatedResponse } from '@/lib/pagination';

// 获取项目 Token 使用明细
export async function GET(request: Request) {
  try {
    // 验证 Token
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 检查权限 - 管理员直接允许，或检查 TOKEN_DETAIL 权限
    const isAdmin = payload.roles?.includes('admin');
    if (!isAdmin && !hasPermission(payload.permissions, PERMISSIONS.TOKEN_DETAIL)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
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
      return NextResponse.json({ error: '缺少项目ID' }, { status: 400 });
    }

    // 检查用户是否有权限访问该项目（管理员可以访问任何项目）
    const project = await prisma.project.findFirst({
      where: isAdmin
        ? { id: projectId }
        : {
            id: projectId,
            userId: payload.userId,
          },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在或无权访问' }, { status: 404 });
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
    console.error('Get project token stats error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}