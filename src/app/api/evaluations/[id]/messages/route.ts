import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, hasPermission } from '@/lib/auth';
import { PERMISSIONS } from '@/types/permissions';
import { getOrCreateServer } from '@/lib/opencode-manager';

// 获取评估会话消息列表
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
    
    // 尝试通过 id 查找（可能是数据库 ID 或 OpenCode session ID）
    let evaluation = await prisma.evaluationSession.findUnique({
      where: { id },
      include: {
        project: {
          include: {
            config: true,
          },
        },
      },
    });
    
    // 如果没找到，尝试通过 opencodeSessionId 查找
    if (!evaluation) {
      evaluation = await prisma.evaluationSession.findFirst({
        where: { opencodeSessionId: id },
        include: {
          project: {
            include: {
              config: true,
            },
          },
        },
      });
    }

    if (!evaluation) {
      return NextResponse.json({ error: '未找到评估会话' }, { status: 404 });
    }

    // 检查项目是否属于当前用户
    if (evaluation.project.userId !== payload.userId) {
      return NextResponse.json({ error: '禁止访问' }, { status: 403 });
    }

    // 如果没有 opencodeSessionId，返回本地缓存的消息
    if (!evaluation.opencodeSessionId) {
      const messages = await prisma.sessionMessage.findMany({
        where: {
          evaluationSessionId: evaluation.id,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });
      return NextResponse.json({ messages });
    }

    // 获取 OpenCode 客户端
    console.log('[Messages API] Getting OpenCode client for evaluation:', evaluation.id);
    const { client } = await getOrCreateServer(evaluation.id);

    // 从 OpenCode 服务器获取消息
    console.log('[SDK] Calling session.messages() for session:', evaluation.opencodeSessionId);

    const result = await client.session.messages({
      path: {
        id: evaluation.opencodeSessionId,
      },
      query: {
        limit: 50,
      },
    });

    // 检查错误
    if (result.error) {
      console.error('[SDK] session.messages() error:', result.error);
      return NextResponse.json({ error: '获取消息失败', details: result.error }, { status: 500 });
    }

    const messages = result.data || [];
    console.log('[SDK] session.messages() response length:', messages?.length);

    // 转换消息格式为前端期望的格式
    const formattedMessages = messages.map((item: any) => ({
      id: item.info.id,
      role: item.info.role,
      content: item.parts,
      createdAt: item.info.time?.created ? new Date(item.info.time.created).toISOString() : new Date().toISOString(),
      metadata: {
        sessionID: item.info.sessionID,
        time: item.info.time,
      },
    }));

    console.log('[API] Formatted', formattedMessages.length, 'messages for frontend');

    // 缓存消息到本地数据库
    for (const item of messages) {
      const messageInfo = item.info;
      console.log('[SDK] Processing message:', messageInfo.id, 'role:', messageInfo.role, 'parts count:', item.parts?.length);

      await prisma.sessionMessage.upsert({
        where: {
          id: messageInfo.id,
        },
        update: {
          role: messageInfo.role,
          content: JSON.stringify(item.parts),
          metadata: JSON.stringify({}),
        },
        create: {
          id: messageInfo.id,
          evaluationSessionId: evaluation.id,
          role: messageInfo.role,
          content: JSON.stringify(item.parts),
          metadata: JSON.stringify({}),
        },
      });
    }

    console.log('[DB] Cached', messages.length, 'messages to database');
    return NextResponse.json({ messages: formattedMessages });
  } catch (error) {
    console.error('Get messages error:', error);
    return NextResponse.json({ error: '服务器内部错误', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
