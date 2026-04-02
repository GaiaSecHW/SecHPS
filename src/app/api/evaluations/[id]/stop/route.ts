import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOrCreateServer } from '@/lib/opencode-manager';

// 停止评估会话
export async function POST(
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

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.SESSION_UPDATE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 获取评估会话
    const { id } = await params;
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      include: {
        project: true,
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '未找到评估会话' }, { status: 404 });
    }

    // 检查项目是否属于当前用户
    if (evaluation.project.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 检查会话状态
    if (evaluation.status !== 'running') {
      return NextResponse.json({ error: '只有运行中的会话才能停止' }, { status: 400 });
    }

    // 获取 OpenCode 客户端
    console.log('[Stop API] Getting OpenCode client for evaluation:', evaluation.id);
    const { client, close } = await getOrCreateServer(evaluation.id);

    // 调用 SDK 中止会话
    if (evaluation.opencodeSessionId) {
      try {
        // 调用 SDK 中止会话
        const result = await client.session.abort({ path: { id: evaluation.opencodeSessionId } });
        if (result.error) {
          console.error('Abort opencode session error:', result.error);
        } else {
          console.log('SDK session aborted:', evaluation.opencodeSessionId);
        }
      } catch (error) {
        console.error('Abort opencode session error:', error);
        // 继续更新数据库状态
      }
    }

    // 关闭服务器实例
    close();

    // 更新评估会话状态
    const updatedEvaluation = await prisma.evaluationSession.update({
      where: { id },
      data: {
        status: 'completed',
        completedAt: new Date(),
      },
    });

    // 检查项目是否还有运行中的评估会话
    const runningEvaluations = await prisma.evaluationSession.count({
      where: {
        projectId: evaluation.projectId,
        status: 'running',
      },
    });

    // 如果没有运行中的评估会话，更新项目状态为已完成
    if (runningEvaluations === 0) {
      await prisma.project.update({
        where: { id: evaluation.projectId },
        data: {
          status: 'completed',
        },
      });
    }

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'evaluation_stop',
        resource: evaluation.id,
        details: JSON.stringify({
          projectId: evaluation.projectId,
          opencodeSessionId: evaluation.opencodeSessionId,
        }),
      },
    });

    return NextResponse.json({
      message: '评估会话已停止',
      evaluation: updatedEvaluation,
    });
  } catch (error) {
    console.error('Stop evaluation error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
