// src/app/api/evaluations/[id]/iterations/route.ts
//
// Ralph Loop Agent 迭代历史查询接口
//

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * GET /api/evaluations/[id]/iterations
 *
 * 查询评估会话的迭代历史
 *
 * 查询参数：
 * - page: 页码（默认 1）
 * - pageSize: 每页条数（默认 20，最大 100）
 * - status: 状态过滤（pending | running | completed | failed）
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. 验证授权
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    // 2. 权限检查
    if (!hasPermission(payload.permissions, PERMISSIONS.EVALUATION_READ)) {
      return NextResponse.json({ error: '无权限查看迭代记录' }, { status: 403 });
    }

    // 3. 获取评估会话 ID
    const { id } = await params;

    // 4. 解析查询参数
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)));
    const statusFilter = searchParams.get('status') || undefined;

    // 5. 验证评估会话存在并检查归属
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      select: { id: true, projectId: true, status: true, Project: { select: { userId: true } } },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 6. 归属校验
    if (evaluation.Project.userId !== payload.userId) {
      return NextResponse.json({ error: '无权查看此评估' }, { status: 403 });
    }

    // 7. 构建查询条件
    const where: { evaluationSessionId: string; status?: string } = {
      evaluationSessionId: id,
    };
    if (statusFilter) {
      where.status = statusFilter;
    }

    // 8. 查询迭代记录（分页）
    const [iterations, total] = await Promise.all([
      prisma.evaluationIteration.findMany({
        where,
        orderBy: { iterationNumber: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          iterationNumber: true,
          status: true,
          startedAt: true,
          completedAt: true,
          duration: true,
          responseText: true,
          inputTokens: true,
          outputTokens: true,
          toolCallCount: true,
          verificationComplete: true,
          verificationReason: true,
          errorMessage: true,
          createdAt: true,
        },
      }),
      prisma.evaluationIteration.count({ where }),
    ]);

    // 9. 计算汇总统计
    const allIterations = await prisma.evaluationIteration.findMany({
      where: { evaluationSessionId: id },
      select: {
        inputTokens: true,
        outputTokens: true,
        duration: true,
        status: true,
        verificationComplete: true,
      },
    });

    const summary = {
      total: allIterations.length,
      completed: allIterations.filter((i) => i.status === 'completed').length,
      failed: allIterations.filter((i) => i.status === 'failed').length,
      totalInputTokens: allIterations.reduce((sum, i) => sum + (i.inputTokens || 0), 0),
      totalOutputTokens: allIterations.reduce((sum, i) => sum + (i.outputTokens || 0), 0),
      totalDuration: allIterations.reduce((sum, i) => sum + (i.duration || 0), 0),
      verifiedCount: allIterations.filter((i) => i.verificationComplete === true).length,
    };

    return NextResponse.json({
      iterations,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
      summary,
      evaluationStatus: evaluation.status,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.EVALUATION, '迭代历史查询错误:', { details: { error: error instanceof Error ? error.message : String(error) } });
    return NextResponse.json(
      {
        error: '服务器内部错误',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
