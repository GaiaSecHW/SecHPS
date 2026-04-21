import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/lib/auth';
import { logger, LOG_MODULES } from '@/lib/logger';

/**
 * GET /api/skills/predict-tasks/[id]
 * 获取单个任务详情
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

    // 查询任务
    const task = await prisma.skillPredictionTask.findFirst({
      where: {
        id,
        userId: payload.userId,
      },
    });

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    // 格式化返回数据
    const formattedTask = {
      id: task.id,
      taskName: task.taskName,
      taskDescription: task.taskDescription,
      nodeId: task.nodeId,
      topK: task.topK,
      status: task.status,
      progress: task.progress,
      errorMessage: task.errorMessage,
      matches: task.matches ? JSON.parse(task.matches) : null,
      method: task.method,
      matchCount: task.matchCount,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      duration: task.duration,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };

    return NextResponse.json({ task: formattedTask });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '查询预测任务失败:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

/**
 * DELETE /api/skills/predict-tasks/[id]
 * 取消任务
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

    // 检查任务是否存在且属于当前用户
    const task = await prisma.skillPredictionTask.findFirst({
      where: {
        id,
        userId: payload.userId,
      },
    });

    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    // 只有 pending 或 running 状态的任务可以取消
    if (task.status !== 'pending' && task.status !== 'running') {
      return NextResponse.json(
        { error: '任务已完成或已取消，无法取消' },
        { status: 400 }
      );
    }

    // 更新任务状态为已取消
    await prisma.skillPredictionTask.update({
      where: { id },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
      },
    });

    return NextResponse.json({ message: '任务已取消' });
  } catch (error) {
    logger.errorNoUser(LOG_MODULES.SKILL, '取消预测任务失败:', { details: { error: String(error) } });
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
