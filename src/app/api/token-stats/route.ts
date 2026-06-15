import { NextResponse } from 'next/server';
import { prisma, Prisma } from '@/lib/prisma';
import { authenticateRequest, authErrorResponseNested, isAdmin } from '@/lib/api-auth';
import { hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { SYSTEM_USER_ID } from '@/lib/system-token-tracker';
import { getBeijingPeriodStart, getBeijingNow } from '@/lib/beijing-time';
import { logger, LOG_MODULES } from '@/lib/logger';

// 获取 Token 统计汇总数据
export async function GET(request: Request) {
  // 使用统一认证中间件
  const auth = authenticateRequest(request);
  if (!auth.success) {
    return authErrorResponseNested(auth);
  }
  const payload = auth.payload;

  try {
    // 检查权限 - 所有登录用户都可以访问，但只能查看自己的数据
    // 管理员可以查看所有数据
    const userIsAdmin = isAdmin(payload);
    // TOKEN_DETAIL 权限可以查看用户级别的统计（仅管理员可见部分）
    const hasTokenDetail = hasPermission(payload.permissions, PERMISSIONS.TOKEN_DETAIL);

    // 获取查询参数
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'day'; // day, week, month, year

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

    // 权限过滤：管理员看全部，普通用户只看自己的数据
    if (!userIsAdmin) {
      const userProjects = await prisma.project.findMany({
        where: { userId: payload.userId },
        select: { id: true },
      });
      const projectIds = userProjects.map(p => p.id);

      if (projectIds.length > 0) {
        evalWhereClause.projectId = { in: projectIds };
      } else {
        evalWhereClause.projectId = 'no-projects';
      }

      tokenWhereClause.userId = payload.userId;
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
    // 查询 TokenUsage 汇总（提前查询，用于 fallback 判断和明细统计）
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

    let summaryInputTokens = evaluationStats._sum.totalInputTokens || 0;
    let summaryOutputTokens = evaluationStats._sum.totalOutputTokens || 0;
    let summaryTotalTokens = evaluationStats._sum.totalTokens || 0;
    let summaryCost = evaluationStats._sum.estimatedCost || 0;
    
    // 当 EvaluationSession 没数据或汇总为0，但 TokenUsage 有数据时，从 TokenUsage 计算
    if (evaluationStats._count.id === 0 || (summaryTotalTokens === 0 && tokenUsageStats._count.id > 0)) {
      const fallbackTokens = await prisma.tokenUsage.findMany({
        where: tokenWhereClause,
        select: {
          inputTokens: true,
          outputTokens: true,
          estimatedCost: true,
          evaluationId: true,
        },
      });
      
      const evalMap = new Map<string, { lastInput: number; totalOutput: number; cost: number }>();
      
      for (const token of fallbackTokens) {
        const evalId = token.evaluationId || 'system';
        const existing = evalMap.get(evalId) || { lastInput: 0, totalOutput: 0, cost: 0 };
        existing.lastInput = Math.max(existing.lastInput, token.inputTokens);
        existing.totalOutput += token.outputTokens;
        existing.cost += token.estimatedCost || 0;
        evalMap.set(evalId, existing);
      }
      
      summaryInputTokens = 0;
      summaryOutputTokens = 0;
      summaryCost = 0;
      for (const [, data] of evalMap) {
        summaryInputTokens += data.lastInput;
        summaryOutputTokens += data.totalOutput;
        summaryCost += data.cost;
      }
      summaryTotalTokens = summaryInputTokens + summaryOutputTokens;
    }

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

    // 查询趋势数据（按日期分组）
    const trendData = await getTrendData(tokenWhereClause, period);

    // 用户统计（仅管理员可见）
    let userStats: any[] = [];
    if (userIsAdmin) {
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

      // EvaluationSession 无数据时，从 TokenUsage 按 userId 聚合
      if (userTokenMap.size === 0) {
        const tokenUserStats = await prisma.tokenUsage.groupBy({
          by: ['userId'],
          where: tokenWhereClause,
          _sum: {
            outputTokens: true,
            estimatedCost: true,
          },
          _max: {
            inputTokens: true,
          },
          _count: {
            id: true,
          },
        });

        for (const stat of tokenUserStats) {
          const uid = stat.userId || SYSTEM_USER_ID;
          userTokenMap.set(uid, {
            inputTokens: stat._max.inputTokens || 0,
            outputTokens: stat._sum.outputTokens || 0,
            cost: stat._sum.estimatedCost || 0,
            count: stat._count.id,
          });
        }
      }
      
      // 构建用户统计数组
      const allUserIds = Array.from(userTokenMap.keys());
      const allUsers = allUserIds.length > 0 ? await prisma.user.findMany({
        where: { id: { in: allUserIds } },
        select: { id: true, username: true, name: true },
      }) : [];
      userStats = Array.from(userTokenMap.entries()).map(([userId, data]) => {
        const user = allUsers.find(u => u.id === userId);
        return {
          userId,
          username: userId === SYSTEM_USER_ID ? '系统' : (user?.username || user?.name || '未知用户'),
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
      trendData,
      userStats, // 仅管理员可见
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.errorNoUser(LOG_MODULES.TOKEN, '获取 Token 统计失败', { details: { error: errMsg } });
    return NextResponse.json({ details: { error: errMsg } }, { status: 500 });
  }
}

// 获取趋势数据（按日期分组，DB 侧聚合）
async function getTrendData(tokenWhereClause: any, period: string) {
  const now = new Date();
  let truncUnit: string;
  let daysBack: number;

  switch (period) {
    case 'day':
      daysBack = 1;
      truncUnit = 'hour';
      break;
    case 'week':
      daysBack = 7;
      truncUnit = 'day';
      break;
    case 'month':
      daysBack = 30;
      truncUnit = 'day';
      break;
    case 'year':
      daysBack = 365;
      truncUnit = 'month';
      break;
    default:
      daysBack = 7;
      truncUnit = 'day';
  }

  const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);

  const conditions: Prisma.Sql[] = [Prisma.sql`"createdAt" >= ${startDate}`];

  if (tokenWhereClause.userId) {
    conditions.push(Prisma.sql`"userId" = ${tokenWhereClause.userId}`);
  }

  const whereClause = Prisma.join(conditions, ' AND ');

  type TrendRow = { bucket: Date; inputTokens: bigint; outputTokens: bigint; estimatedCost: number; callCount: bigint };
  // inputTokens 含历史上下文，取 MAX；outputTokens 是新增输出，取 SUM
  const rows = await prisma.$queryRaw<TrendRow[]>`
    SELECT
      date_trunc(${truncUnit}, "createdAt") AS bucket,
      MAX("inputTokens")::bigint AS "inputTokens",
      SUM("outputTokens")::bigint AS "outputTokens",
      SUM("estimatedCost") AS "estimatedCost",
      COUNT(*)::bigint AS "callCount"
    FROM "TokenUsage"
    WHERE ${whereClause}
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  return rows.map(row => {
    const date = new Date(row.bucket);
    let key: string;
    switch (truncUnit) {
      case 'hour':
        key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours()}`;
        break;
      case 'month':
        key = `${date.getFullYear()}-${date.getMonth() + 1}`;
        break;
      default:
        key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    }
    const inputTokens = Number(row.inputTokens);
    const outputTokens = Number(row.outputTokens);
    return {
      date: key,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCost: Number(row.estimatedCost),
      callCount: Number(row.callCount),
    };
  });
}