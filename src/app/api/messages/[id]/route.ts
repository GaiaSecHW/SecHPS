import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';

// 获取单条消息详情
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

    // 获取消息 ID 和会话 ID
    const { id } = await params;
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');
    
    if (!sessionId) {
      return NextResponse.json({ error: '缺少会话 ID' }, { status: 400 });
    }

    // 获取评估会话
    const evaluation = await prisma.evaluationSession.findFirst({
      where: { opencodeSessionId: sessionId },
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

    // 初始化 SDK
    const client = (await import('@opencode-ai/sdk')).createOpencodeClient({ baseUrl: evaluation.project.config!.baseURL });

    // 调用 SDK 获取消息详情 - session.message() 需要 sessionID 和 messageID
    console.log('[SDK] Calling session.message() for session:', sessionId, 'message:', id);
    const result = await client.session.message({
      path: {
        id: sessionId,
        messageID: id,
      },
    });
    
    // 检查错误
    if (result.error) {
      console.error('[SDK] session.message() error:', result.error);
      return NextResponse.json({ error: '获取消息详情失败', details: result.error }, { status: 500 });
    }
    
    const messageDetail = result.data;
    console.log('[SDK] session.message() response:', JSON.stringify(messageDetail, null, 2));

    return NextResponse.json({ message: messageDetail });
  } catch (error) {
    console.error('Get message detail error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
