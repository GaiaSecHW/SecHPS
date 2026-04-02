import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOrCreateServer } from '@/lib/opencode-manager';

// 获取所有项目列表
export async function GET(request: Request) {
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

    // 从 URL 参数获取 evaluationId
    const url = new URL(request.url);
    const evaluationId = url.searchParams.get('evaluationId');

    if (!evaluationId) {
      return NextResponse.json({ error: '缺少 evaluationId 参数' }, { status: 400 });
    }

    // 获取评估会话
    const evaluation = await prisma.evaluationSession.findUnique({
      where: { id: evaluationId },
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

    // 获取或创建 OpenCode 服务器
    console.log('[SDK Projects List] Getting or creating server for evaluation:', evaluation.id);
    const server = await getOrCreateServer(evaluation.id);

    // 初始化 SDK
    const client = (await import('@opencode-ai/sdk')).createOpencodeClient({ baseUrl: server.url });

    // 调用 SDK 获取项目列表
    console.log('[SDK] Calling project.list()...');
    const result = await client.project.list();

    if (result.error) {
      console.error('[SDK] project.list() error:', result.error);
      return NextResponse.json({ error: '获取项目列表失败', details: result.error }, { status: 500 });
    }

    const projects = result.data || [];
    console.log('[SDK] project.list() response:', projects.length, 'projects');

    return NextResponse.json({ projects });
  } catch (error) {
    console.error('Get project list error:', error);
    return NextResponse.json({ error: '服务器内部错误', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
