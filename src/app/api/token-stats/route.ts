import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getBeijingPeriodStart, getBeijingNow } from '@/lib/beijing-time';

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

    // 检查权限 - 所有登录用户都可以访问，但只能查看自己的数据
    // 管理员可以查看所有数据
    const isAdmin = payload.roles?.includes('admin');
    // TOKEN_DETAIL 权限可以查看用户级别的统计（仅管理员可见部分）
    const hasTokenDetail = hasPermission(payload.permissions, PERMISSIONS.TOKEN_DETAIL);

    // 获取查询参数
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'day'; // day, week, month, year
    const projectId = searchParams.get('projectId');

    // 使用北京时间计算起始时间
    const startDate = getBeijingPeriodStart(period as 'day' | 'week' | 'month' | 'year');
    const now = getBeijingNow();

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
      // 系统项目（所有人可见）
      const SYSTEM_PROJECT_ID = 'system-00000000-0000-0000-0000-000000000001';
      
      if (isAdmin) {
        // 管理员：查询所有项目（包括所有用户的）
        const allProjects = await prisma.project.findMany({
          select: { id: true },
        });
        const projectIds = [...allProjects.map(p => p.id), SYSTEM_PROJECT_ID];
        
        evalWhereClause.projectId = { in: projectIds };
        tokenWhereClause.projectId = { in: projectIds };
      } else {
        // 普通用户：只查询自己的项目 + 系统项目
        const userProjects = await prisma.project.findMany({
          where: { userId: payload.userId },
          select: { id: true },
        });
        const projectIds = [...userProjects.map(p => p.id), SYSTEM_PROJECT_ID];
        
        evalWhereClause.projectId = { in: projectIds };
        tokenWhereClause.projectId = { in: projectIds };
      }
    }

    // 查询评估会话的 token 汇总（用于跨时段统计）
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

    // 对于"今日"统计，优先使用 TokenUsage（实时数据）
    // 因为当天的评估可能还没完成，EvaluationSession 还没更新
    let summaryInputTokens = evaluationStats._sum.totalInputTokens || 0;
    let summaryOutputTokens = evaluationStats._sum.totalOutputTokens || 0;
    let summaryTotalTokens = evaluationStats._sum.totalTokens || 0;
    let summaryCost = evaluationStats._sum.estimatedCost || 0;
    
    // 如果是"今日"且 EvaluationSession 为空，从 TokenUsage 计算
    if (period === 'day' && evaluationStats._count.id === 0) {
      // 查询今日所有 TokenUsage
      const todayTokens = await prisma.tokenUsage.findMany({
        where: tokenWhereClause,
        select: {
          inputTokens: true,
          outputTokens: true,
          estimatedCost: true,
          evaluationId: true,
        },
      });
      
      // 按 evaluationId 分组，每个评估取最后一次的 input + 累计 output
      const evalMap = new Map<string, { lastInput: number; totalOutput: number; cost: number }>();
      
      for (const token of todayTokens) {
        const evalId = token.evaluationId || 'system';
        const existing = evalMap.get(evalId) || { lastInput: 0, totalOutput: 0, cost: 0 };
        existing.lastInput = Math.max(existing.lastInput, token.inputTokens);
        existing.totalOutput += token.outputTokens;
        existing.cost += token.estimatedCost || 0;
        evalMap.set(evalId, existing);
      }
      
      // 累计所有评估的数据
      for (const [, data] of evalMap) {
        summaryInputTokens += data.lastInput;
        summaryOutputTokens += data.totalOutput;
        summaryCost += data.cost;
      }
      summaryTotalTokens = summaryInputTokens + summaryOutputTokens;
    }

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

    // 查询每个模型的统计（不累加 input，只累加 output）
    // 注意：TokenUsage 的 input 包含历史上下文，累加会重复计算
    // 正确做法：input 取最后一次调用的值，output 累加
    // 这里简化处理：只显示 output 的累加值，input 用平均值估算
    const modelStatsRaw = await prisma.tokenUsage.groupBy({
      by: ['modelName', 'apiProvider'],
      where: tokenWhereClause,
      _sum: {
        outputTokens: true,
        estimatedCost: true,
      },
      _count: {
        id: true,
      },
      _max: {
        inputTokens: true,  // 取最大的 input（最后一次调用的上下文大小）
      },
    });
    
    // 计算模型统计（input 用最大值代表上下文大小，output 累加）
    const modelStats = modelStatsRaw.map(stat => {
      const maxInput = stat._max.inputTokens || 0;
      const totalOutput = stat._sum.outputTokens || 0;
      return {
        modelName: stat.modelName || '未知模型',
        apiProvider: stat.apiProvider,
        inputTokens: maxInput,  // 上下文大小（最大值）
        outputTokens: totalOutput,  // 累计输出
        totalTokens: maxInput + totalOutput,
        estimatedCost: stat._sum.estimatedCost || 0,
        callCount: stat._count.id || 0,
      };
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

    // 用户统计（仅管理员可见）
    let userStats: any[] = [];
    if (isAdmin) {
      // 查询每个用户的 token 使用量
      const userProjects = await prisma.project.findMany({
        select: {
          id: true,
          userId: true,
          name: true,
        },
      });
      
      // 获取用户信息
      const userIds = [...new Set(userProjects.map(p => p.userId))];
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, name: true },
      });
      
      // 查询每个项目的 token 使用量
      const projectTokenStats = await prisma.evaluationSession.groupBy({
        where: evalWhereClause,
        by: ['projectId'],
        _sum: {
          totalInputTokens: true,
          totalOutputTokens: true,
          estimatedCost: true,
        },
        _count: {
          id: true,
        },
      });
      
      // 汇总每个用户的 token 使用量
      const userTokenMap = new Map<string, { inputTokens: number; outputTokens: number; cost: number; count: number }>();
      
      for (const stat of projectTokenStats) {
        const project = userProjects.find(p => p.id === stat.projectId);
        if (project) {
          const existing = userTokenMap.get(project.userId) || { inputTokens: 0, outputTokens: 0, cost: 0, count: 0 };
          existing.inputTokens += stat._sum.totalInputTokens || 0;
          existing.outputTokens += stat._sum.totalOutputTokens || 0;
          existing.cost += stat._sum.estimatedCost || 0;
          existing.count += stat._count.id || 0;
          userTokenMap.set(project.userId, existing);
        }
      }
      
      // 构建用户统计数组
      userStats = Array.from(userTokenMap.entries()).map(([userId, data]) => {
        const user = users.find(u => u.id === userId);
        return {
          userId,
          username: user?.username || user?.name || '未知用户',
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          totalTokens: data.inputTokens + data.outputTokens,
          estimatedCost: data.cost,
          evaluationCount: data.count,
        };
      }).sort((a, b) => b.totalTokens - a.totalTokens);
    }

    return NextResponse.json({
      period,
      startDate,
      endDate: now,
      summary: {
        totalInputTokens: summaryInputTokens,
        totalOutputTokens: summaryOutputTokens,
        totalTokens: summaryTotalTokens,
        estimatedCost: summaryCost,
        evaluationCount: evaluationStats._count.id || 0,
        callCount: tokenUsageStats._count.id || 0,
      },
      modelStats,
      projectStats,
      trendData,
      userStats, // 仅管理员可见
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