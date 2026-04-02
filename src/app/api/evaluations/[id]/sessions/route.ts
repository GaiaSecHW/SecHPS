import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOrCreateServer } from '@/lib/opencode-manager';

// 获取当前项目的会话历史列表
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
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '未找到评估会话' }, { status: 404 });
    }

    // 检查项目是否属于当前用户
    if (evaluation.project.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 获取 OpenCode 客户端
    console.log('[Session History] Getting OpenCode client for evaluation:', evaluation.id);
    const { client } = await getOrCreateServer(evaluation.id);

    // 调用 session.list() 获取会话列表
    console.log('[SDK] Calling session.list() for project');
    const result = await client.session.list();

    // 检查错误
    if (result.error) {
      console.error('[SDK] session.list() error:', result.error);
      return NextResponse.json({ error: '获取会话列表失败', details: result.error }, { status: 500 });
    }

    const sessions = result.data || [];
    console.log('[SDK] session.list() response length:', sessions?.length);

    // 转换会话格式
    const formattedSessions = sessions.map((session: any) => ({
      id: session.id,
      title: session.title || '无标题',
      status: session.status || 'unknown',
      createdAt: session.time?.created ? new Date(session.time.created).toISOString() : null,
      updatedAt: session.time?.updated ? new Date(session.time.updated).toISOString() : null,
    }));

    return NextResponse.json({ sessions: formattedSessions });
  } catch (error) {
    console.error('Get session history error:', (error as Error).message);
    return NextResponse.json({ error: '服务器内部错误', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
