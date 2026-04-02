import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOrCreateServer } from '@/lib/opencode-manager';

// 获取会话的 TODO 列表
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

    // 获取会话 ID
    const { id } = await params;

    // 查找对应的评估会话
    const evaluation = await prisma.evaluationSession.findFirst({
      where: { opencodeSessionId: id },
      include: {
        project: {
          include: {
            config: true,
          },
        },
      },
    });

    if (!evaluation) {
      return NextResponse.json({ error: '未找到会话' }, { status: 404 });
    }

    // 检查项目是否属于当前用户
    if (evaluation.project.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 获取或创建 OpenCode 服务器（自动重启如果需要）
    console.log('[TODO API] Getting or creating server for evaluation:', evaluation.id);
    const server = await getOrCreateServer(evaluation.id);
    console.log('[TODO API] Server ready:', server.url);

    // 初始化 SDK
    const client = (await import('@opencode-ai/sdk')).createOpencodeClient({ baseUrl: server.url });
    
    // 调用 SDK 获取 TODO 列表
    console.log('[SDK] Calling session.todo() for session:', id);
    const result = await client.session.todo({
      path: { id },
      query: {
        directory: evaluation.project.projectPath || undefined,
      },
    });
    
    // 检查错误
    if (result.error) {
      console.error('[SDK] session.todo() error:', result.error);
      return NextResponse.json({ error: '获取 TODO 列表失败', details: result.error }, { status: 500 });
    }
    
    const todos = result.data || [];
    console.log('[SDK] session.todo() response count:', todos.length);

    return NextResponse.json({ todos });
  } catch (error) {
    console.error('Get session todo error:', error);
    return NextResponse.json({ error: '服务器内部错误', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
