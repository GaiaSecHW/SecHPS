import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// 获取评估会话详情
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

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.SESSION_READ)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 获取评估会话
    const { id } = await params;
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      include: {
        project: true,
        messages: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '未找到评估会话' }, { status: 404 });
    }

    // 检查项目是否属于当前用户
    if (evaluation.project.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    return NextResponse.json({ evaluation });
  } catch (error) {
    console.error('Get evaluation error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// 删除评估会话
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

    // 检查权限
    if (!hasPermission(payload.permissions, PERMISSIONS.SESSION_DELETE)) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 获取评估会话
    const { id } = await params;
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      include: {
        project: {
          include: {
            config: true,
          },
        },
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '未找到评估会话' }, { status: 404 });
    }

    // 检查项目是否属于当前用户
    if (evaluation.project.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 检查会话状态 - 运行中的会话不能删除
    if (evaluation.status === 'running') {
      return NextResponse.json({ error: '运行中的会话不能删除，请先停止会话' }, { status: 400 });
    }

    // 调用 SDK 删除会话 - SDK 返回 { data, error, request, response }
    if (evaluation.opencodeSessionId && evaluation.project.config) {
      try {
        const client = (await import('@opencode-ai/sdk')).createOpencodeClient({ baseUrl: evaluation.project.config.baseURL });
        
        // 调用 SDK 删除会话 - 参数格式: { path: { id } }
        const result = await client.session.delete({ path: { id: evaluation.opencodeSessionId } });
        if (result.error) {
          console.error('Delete opencode session error:', result.error);
        } else {
          console.log('SDK session deleted:', evaluation.opencodeSessionId);
        }
      } catch (error) {
        console.error('Delete opencode session error:', error);
        // 即使 SDK 删除失败，也继续删除数据库记录
      }
    }

    // 删除关联的消息
    await prisma.sessionMessage.deleteMany({
      where: { evaluationSessionId: id },
    });

    // 删除评估会话
    await prisma.evaluationSession.delete({
      where: { id },
    });

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId: payload.userId,
        action: 'evaluation_delete',
        resource: evaluation.id,
        details: JSON.stringify({
          projectId: evaluation.projectId,
          opencodeSessionId: evaluation.opencodeSessionId,
        }),
      },
    });

    return NextResponse.json({ message: '评估会话已删除' });
  } catch (error) {
    console.error('Delete evaluation error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
