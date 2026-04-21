// src/app/api/evaluations/[id]/stop/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { abortAgent } from '@/lib/agent-registry';
import { completeAllPendingSkillExecutions } from '@/services/skill-execution-tracker';
import { generateId } from '@/lib/id-generator';
import { logger, LOG_MODULES } from '@/lib/logger';

// POST /api/evaluations/[id]/stop - 停止评估会话
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: '无效的令牌' }, { status: 401 });
    }

    const { id } = await params;

    // 检查评估会话是否存在
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      include: { Project: { select: { userId: true } } },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    // 权限检查：管理员 或 项目所有者 可以停止评估
    const isAdmin = hasPermission(payload.permissions, PERMISSIONS.CONFIG_UPDATE);
    const isProjectOwner = evaluation.Project.userId === payload.userId;
    
    if (!isAdmin && !isProjectOwner) {
      return NextResponse.json({ error: '无权操作此评估' }, { status: 403 });
    }

    if (evaluation.status !== 'running') {
      return NextResponse.json({ error: '评估会话不在运行中' }, { status: 400 });
    }

    // 尝试中止运行中的 Agent
    const aborted = abortAgent(id);
    if (aborted) {
      logger.debug(LOG_MODULES.EVALUATION, '成功中止 Agent:', { details: { id } });
    } else {
      logger.debug(LOG_MODULES.EVALUATION, 'Agent 不在运行中或已结束:', { details: { id } });
      // 即使 agent 不在注册表中，也需要检查数据库状态
    }

    // 获取当前已累加的 Token（实时累加通过 onUsage 回调）
    const currentTokens = await prisma.evaluationSession.findUnique({
      where: { id },
      select: {
        totalInputTokens: true,
        totalOutputTokens: true,
        totalTokens: true,
        estimatedCost: true,
      },
    });

    // 更新状态为已取消，同时保留已累加的 Token
    const updatedEvaluation = await prisma.evaluationSession.update({
      where: { id },
      data: {
        status: 'cancelled',
        endReason: 'stopped',
        endMessage: '用户手动中止评估',
        completedAt: new Date(),
        errorMessage: '用户手动中止',
        // 保留已累加的 Token（确保不为 null）
        totalInputTokens: currentTokens?.totalInputTokens ?? 0,
        totalOutputTokens: currentTokens?.totalOutputTokens ?? 0,
        totalTokens: currentTokens?.totalTokens ?? 0,
        estimatedCost: currentTokens?.estimatedCost ?? 0,
      },
    });
    logger.debug(LOG_MODULES.EVALUATION, '评估状态已更新为 cancelled:', { details: { id, tokens: { input: currentTokens?.totalInputTokens, output: currentTokens?.totalOutputTokens } } });

    // 更新项目状态（如果有正在运行的评估）
    await prisma.project.updateMany({
      where: {
        id: evaluation.projectId,
        status: 'running',
      },
      data: {
        status: 'idle',
      },
    });

    // 记录审计日志
    try {
      await prisma.auditLog.create({
            data: {
              id: generateId('audit'),
              userId: payload.userId,
              action: 'evaluation_stop',
              resource: id,
              details: JSON.stringify({
                projectId: evaluation.projectId,
                reason: '用户手动中止',
              }),
            },
          });
      logger.debug(LOG_MODULES.EVALUATION, '记录审计日志成功:', { details: { id } });
    } catch (auditError) {
      logger.errorNoUser(LOG_MODULES.EVALUATION, '记录审计日志失败:', { details: { error: String(auditError) } });
    }

    // 处理队列 - 中止后释放了并发名额，启动下一个排队评估
    try {
      const { processQueue } = await import('@/services/evaluation-queue');
      processQueue().catch(err => logger.errorNoUser(LOG_MODULES.EVALUATION, '处理队列失败:', { details: { error: String(err) } }));
      logger.debug(LOG_MODULES.EVALUATION, '触发队列处理');
    } catch (queueError) {
      logger.errorNoUser(LOG_MODULES.EVALUATION, '导入队列服务失败:', { details: { error: String(queueError) } });
    }

    return NextResponse.json({
      message: '评估会话已停止',
      evaluation: updatedEvaluation,
    });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.EVALUATION, '停止评估错误:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
