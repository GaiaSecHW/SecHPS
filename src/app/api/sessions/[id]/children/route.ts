import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOrCreateServer } from '@/lib/server-manager';

// 获取会话的子会话列表
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

    // 如果没有 opencodeSessionId，返回空列表
    if (!evaluation.opencodeSessionId) {
      return NextResponse.json({ children: [] });
    }

    // 获取或创建 OpenCode 服务器
    console.log('[Children API] Getting or creating server for evaluation:', evaluation.id);
    const server = await getOrCreateServer(evaluation.id);
    console.log('[Children API] Server ready:', server.url);

    // 初始化 OpenCode SDK
    const client = (await import('@opencode-ai/sdk')).createOpencodeClient({ baseUrl: server.url });

    // 从 OpenCode 服务器获取子会话
    console.log('[SDK] Calling session.children() for session:', evaluation.opencodeSessionId);

    const result = await client.session.children({
      path: {
        id: evaluation.opencodeSessionId,
      },
    });

    // 检查错误
    if (result.error) {
      console.error('[SDK] session.children() error:', result.error);
      return NextResponse.json({ error: '获取子会话失败', details: result.error }, { status: 500 });
    }

    const children = result.data || [];
    console.log('[SDK] session.children() response length:', children?.length);

    // 转换子会话格式
    const formattedChildren = children.map((child: any) => ({
      id: child.id,
      title: child.title || '无标题',
      status: child.status || 'unknown',
      createdAt: child.time?.created ? new Date(child.time.created).toISOString() : null,
      updatedAt: child.time?.updated ? new Date(child.time.updated).toISOString() : null,
    }));

    return NextResponse.json({ children: formattedChildren });
  } catch (error) {
    console.error('Get session children error:', error);
    return NextResponse.json({ error: '服务器内部错误', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
