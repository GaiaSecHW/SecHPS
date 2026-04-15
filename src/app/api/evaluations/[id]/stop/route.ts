// src/app/api/evaluations/[id]/stop/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { abortAgent } from '@/lib/agent-registry';

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
    });

    if (!evaluation) {
      return NextResponse.json({ error: '评估会话不存在' }, { status: 404 });
    }

    if (evaluation.status !== 'running') {
      return NextResponse.json({ error: '评估会话不在运行中' }, { status: 400 });
    }

    // 尝试中止运行中的 Agent
    const aborted = abortAgent(id);
    if (aborted) {
      console.log(`[Stop Evaluation] 成功中止 Agent: ${id}`);
    } else {
      console.log(`[Stop Evaluation] Agent 不在运行中或已结束: ${id}`);
      // 即使 agent 不在注册表中，也需要检查数据库状态
    }

    // 更新状态为已取消（确保在任何情况下都更新）
    const updatedEvaluation = await prisma.evaluationSession.update({
      where: { id },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
        errorMessage: '用户手动中止',
      },
    });
    console.log(`[Stop Evaluation] 评估状态已更新为 cancelled: ${id}`);

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
          userId: payload.userId,
          action: 'evaluation_stop',
          resource: id,
          details: JSON.stringify({
            projectId: evaluation.projectId,
            reason: '用户手动中止',
          }),
        },
      });
      console.log(`[Stop Evaluation] 记录审计日志成功: ${id}`);
    } catch (auditError) {
      console.error('[Stop Evaluation] 记录审计日志失败:', auditError);
    }

    // 处理队列 - 中止后释放了并发名额，启动下一个排队评估
    try {
      const { processQueue } = await import('@/services/evaluation-queue');
      processQueue().catch(err => console.error('[Stop Evaluation] 处理队列失败:', err));
      console.log(`[Stop Evaluation] 触发队列处理`);
    } catch (queueError) {
      console.error('[Stop Evaluation] 导入队列服务失败:', queueError);
    }

    return NextResponse.json({
      message: '评估会话已停止',
      evaluation: updatedEvaluation,
    });
  } catch (error) {
    console.error('Stop evaluation error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
