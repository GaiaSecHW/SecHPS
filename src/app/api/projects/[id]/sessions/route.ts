import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOrCreateProjectServer } from '@/lib/server-manager';

// 获取项目的评估历史（从 OpenCode session.list()）
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

    // 获取项目 ID
    const { id } = await params;

    // 查找项目
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        config: true,
      },
    });

    if (!project) {
      return NextResponse.json({ error: '项目不存在' }, { status: 404 });
    }

    // 检查项目是否属于当前用户
    if (project.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 获取或创建项目级 OpenCode 服务器
    console.log('[Sessions API] Getting or creating project server for project:', id);
    const server = await getOrCreateProjectServer(id);
    console.log('[Sessions API] Server ready:', server.url);

    // 初始化 SDK
    const client = (await import('@opencode-ai/sdk')).createOpencodeClient({ baseUrl: server.url });

    // 调用 session.list() 获取会话列表
    console.log('[SDK] Calling session.list()');
    const result = await client.session.list();

    // 检查错误
    if (result.error) {
      console.error('[SDK] session.list() error:', result.error);
      return NextResponse.json({ error: '获取会话列表失败', details: result.error }, { status: 500 });
    }

    const sessions = result.data || [];
    console.log('[SDK] session.list() response length:', sessions?.length);

    // 过滤出属于当前项目的 session
    const projectSessions = sessions.filter((session: any) => {
      // 检查 session.projectID 是否匹配当前项目 ID
      // 注意：OpenCode SDK 返回的 projectID 是项目在 OpenCode 中的 ID
      // 我们需要通过项目路径或其他方式匹配
      // 这里我们使用项目路径作为匹配条件
      return session.directory === project.projectPath;
    });

    console.log('[API] Filtered', projectSessions.length, 'sessions for project:', id);

    // 格式化会话列表
    const formattedSessions = projectSessions.map((session: any) => ({
      id: session.id,
      title: session.title || '无标题',
      status: session.status || 'unknown',
      createdAt: session.time?.created ? new Date(session.time.created).toISOString() : null,
      updatedAt: session.time?.updated ? new Date(session.time.updated).toISOString() : null,
      summary: session.summary ? {
        additions: session.summary.additions,
        deletions: session.summary.deletions,
        files: session.summary.files,
      } : null,
      isShared: !!session.share,
      shareUrl: session.share?.url || null,
    }));

    console.log('[API] Formatted', formattedSessions.length, 'sessions for project:', id);

    return NextResponse.json({ sessions: formattedSessions });
  } catch (error) {
    console.error('Get sessions error:', error);
    return NextResponse.json({ error: '服务器内部错误', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
