import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// 获取 Token 统计汇总数据
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

    // 检查权限 - 管理员直接允许，或检查 TOKEN_READ 权限
    const isAdmin = payload.roles?.includes('admin');
    if (!isAdmin && !hasPermission(payload.permissions, PERMISSIONS.TOKEN_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 获取查询参数
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'day'; // day, week, month, year
    const projectId = searchParams.get('projectId');

    // 计算时间范围
    const now = new Date();
    let startDate: Date;
    
    switch (period) {
      case 'day':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    // 构建查询条件（EvaluationSession 使用 startedAt）
    const evalWhereClause: any = {
      startedAt: {
        gte: startDate,
      },
    };

    // TokenUsage 使用 createdAt
    const tokenWhereClause: any = {
      createdAt: {
        gte: startDate,
      },
    };

    // 如果指定了项目，添加项目过滤
    if (projectId) {
      evalWhereClause.projectId = projectId;
      tokenWhereClause.projectId = projectId;
    } else {
      // 只查询用户有权限的项目
      const userProjects = await prisma.project.findMany({
        where: { userId: payload.userId },
        select: { id: true },
      });
      const projectIds = userProjects.map(p => p.id);
      evalWhereClause.projectId = { in: projectIds };
      tokenWhereClause.projectId = { in: projectIds };
    }

    // 查询评估会话的 token 汇总
    const evaluationStats = await prisma.evaluationSession.aggregate({
      where: evalWhereClause,
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

    // 查询详细的 token 使用记录
    const tokenUsageStats = await prisma.tokenUsage.aggregate({
      where: tokenWhereClause,
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        estimatedCost: true,
      },
      _count: {
        id: true,
      },
    });

    // 查询每个模型的统计
    const modelStats = await prisma.tokenUsage.groupBy({
      by: ['modelName', 'apiProvider'],
      where: tokenWhereClause,
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        estimatedCost: true,
      },
      _count: {
        id: true,
      },
    });

    // 查询每个项目的统计（仅当没有指定项目时）
    let projectStats: any[] = [];
    if (!projectId) {
      const evaluations = await prisma.evaluationSession.findMany({
        where: evalWhereClause,
        select: {
          projectId: true,
          totalInputTokens: true,
          totalOutputTokens: true,
          totalTokens: true,
          estimatedCost: true,
        },
      });

      // 按项目聚合
      const projectMap = new Map<string, any>();
      for (const evaluation of evaluations) {
        const existing = projectMap.get(evaluation.projectId) || {
          projectId: evaluation.projectId,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          estimatedCost: 0,
          evaluationCount: 0,
        };
        existing.totalInputTokens += evaluation.totalInputTokens || 0;
        existing.totalOutputTokens += evaluation.totalOutputTokens || 0;
        existing.totalTokens += evaluation.totalTokens || 0;
        existing.estimatedCost += evaluation.estimatedCost || 0;
        existing.evaluationCount += 1;
        projectMap.set(evaluation.projectId, existing);
      }

      // 获取项目名称
      const projectIds = Array.from(projectMap.keys());
      const projects = await prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true },
      });

      projectStats = Array.from(projectMap.values()).map(stat => {
        const project = projects.find(p => p.id === stat.projectId);
        return {
          ...stat,
          projectName: project?.name || '未知项目',
        };
      });
    }

    // 查询趋势数据（按日期分组）
    const trendData = await getTrendData(tokenWhereClause, period);

    return NextResponse.json({
      period,
      startDate,
      endDate: now,
      summary: {
        totalInputTokens: evaluationStats._sum.totalInputTokens || 0,
        totalOutputTokens: evaluationStats._sum.totalOutputTokens || 0,
        totalTokens: evaluationStats._sum.totalTokens || 0,
        estimatedCost: evaluationStats._sum.estimatedCost || 0,
        evaluationCount: evaluationStats._count.id || 0,
        callCount: tokenUsageStats._count.id || 0,
      },
      modelStats: modelStats.map(stat => ({
        modelName: stat.modelName || '未知模型',
        apiProvider: stat.apiProvider,
        inputTokens: stat._sum.inputTokens || 0,
        outputTokens: stat._sum.outputTokens || 0,
        totalTokens: stat._sum.totalTokens || 0,
        estimatedCost: stat._sum.estimatedCost || 0,
        callCount: stat._count.id || 0,
      })),
      projectStats,
      trendData,
    });
  } catch (error) {
    console.error('Get token stats error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 获取趋势数据（按日期分组）
async function getTrendData(tokenWhereClause: any, period: string) {
  const now = new Date();
  let groupByFormat: string;
  let daysBack: number;

  switch (period) {
    case 'day':
      // 按小时分组，过去24小时
      daysBack = 1;
      groupByFormat = 'hour';
      break;
    case 'week':
      // 按天分组，过去7天
      daysBack = 7;
      groupByFormat = 'day';
      break;
    case 'month':
      // 按天分组，过去30天
      daysBack = 30;
      groupByFormat = 'day';
      break;
    case 'year':
      // 按月分组，过去12个月
      daysBack = 365;
      groupByFormat = 'month';
      break;
    default:
      daysBack = 7;
      groupByFormat = 'day';
  }

  // SQLite 不支持复杂的日期分组，使用原始查询
  const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  
  // 调整时间范围（TokenUsage 使用 createdAt）
  const adjustedWhereClause = {
    ...tokenWhereClause,
    createdAt: {
      gte: startDate,
    },
  };

  // 获取所有 token 使用记录
  const tokenUsages = await prisma.tokenUsage.findMany({
    where: adjustedWhereClause,
    select: {
      createdAt: true,
      inputTokens: true,
      outputTokens: true,
      totalTokens: true,
      estimatedCost: true,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  // 手动分组
  const groups = new Map<string, any>();
  
  for (const usage of tokenUsages) {
    let key: string;
    const date = new Date(usage.createdAt);
    
    switch (groupByFormat) {
      case 'hour':
        key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours()}`;
        break;
      case 'day':
        key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
        break;
      case 'month':
        key = `${date.getFullYear()}-${date.getMonth() + 1}`;
        break;
      default:
        key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    }

    const existing = groups.get(key) || {
      date: key,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
      callCount: 0,
    };
    
    existing.inputTokens += usage.inputTokens || 0;
    existing.outputTokens += usage.outputTokens || 0;
    existing.totalTokens += usage.totalTokens || 0;
    existing.estimatedCost += usage.estimatedCost || 0;
    existing.callCount += 1;
    
    groups.set(key, existing);
  }

  return Array.from(groups.values()).sort((a, b) => a.date.localeCompare(b.date));
}